import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CreateAssignmentInputSchema,
  FINAL_SIMILARITY_THRESHOLD,
  commentSimilarity,
  findSimilarFinalComments,
  type AssignmentFile,
  type Student,
  type WorkFile,
  type WorkStatus
} from '@essay-grader/core'
import {
  auditAssignment,
  closeDatabase,
  countFinalReuse,
  createAssignment,
  createClass,
  loadAssignment,
  openDatabase,
  saveClass,
  saveWork
} from './repository'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const now = (): string => new Date().toISOString()
const pad = (value: number): string => String(value).padStart(2, '0')

const BASE =
  '本篇文章取材自家庭經驗，敘寫具體，轉折自然，結尾收束完整，整體表現穩定；建議多留意標點與段落之間的銜接。'
/** 改一個詞（之間→間），相似度約 0.93，應列為近似。 */
const NEAR_A = BASE.replace('段落之間', '段落間')
/** 改一個詞（銜接→連接），相似度約 0.91，應列為近似。 */
const NEAR_B = BASE.replace('銜接', '連接')
const UNRELATED = '圖書館的安靜午後被寫得很有畫面，段落銜接流暢。'
const SHORT_BASE = '文章結構完整，論點清楚，建議多加舉例說明。'
/** 只多一個「再」，相似度約 0.84，低於門檻，不列為近似。 */
const SHORT_NEAR = SHORT_BASE.replace('建議多加', '建議再多加')

const SCORE_ITEMS = { content: 32, structure: 24, language: 25 }

function makeWork(
  classId: string,
  assignmentId: string,
  seat: string,
  status: WorkStatus,
  finalText: string
): WorkFile {
  return {
    schema_version: 1,
    class_id: classId,
    assignment_id: assignmentId,
    seat,
    name: `學生${seat}`,
    status,
    pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
    annotations: [],
    scores: {
      items: { ...SCORE_ITEMS },
      deduction: { typo: 0, punct: 0, override: null },
      total: 81,
      grade: 'A'
    },
    final_comment: { text: finalText },
    updated_at: now()
  }
}

/** 隱藏視窗：批閱畫面輸入近似總評，驗證「相近」百分比、API matches 與紅色阻擋警告。 */
async function runUiSmoke(
  classId: string,
  assignmentId: string,
  nearPercent: number,
  addSecondBase: () => Promise<void>
): Promise<{ ok: boolean; detail: string }> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (expression: string, timeoutMs: number): Promise<boolean> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const ok = (await win.webContents.executeJavaScript(`Boolean(${expression})`)) as boolean
      if (ok) return true
      await delay(120)
    }
    return false
  }
  const setTextarea = async (selector: string, value: string): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const area = document.querySelector(${JSON.stringify(selector)})
        if (!area) return false
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        ).set
        setter.call(area, ${JSON.stringify(value)})
        area.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`
    )) as boolean
  const bodyIncludes = (needle: string): string =>
    `document.body.innerText.includes(${JSON.stringify(needle)})`

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))

    let text = ''
    for (let i = 0; i < 30; i++) {
      await delay(100)
      text = (await win.webContents.executeJavaScript('document.body.innerText')) as string
      if (text.includes('作文批閱') && !text.includes('載入中')) break
    }
    if (!text.includes('作文批閱')) return { ok: false, detail: '主畫面未渲染' }

    const assignmentReady = await waitFor("document.querySelector('.assignment-row')", 8000)
    if (!assignmentReady) return { ok: false, detail: '找不到作業列' }
    await win.webContents.executeJavaScript("document.querySelector('.assignment-row')?.click()")

    const openSeat = async (seat: string): Promise<boolean> => {
      const ready = await waitFor(
        `[...document.querySelectorAll('.import-panel tbody tr')].some(
          (tr) => tr.querySelector('td')?.textContent?.trim() === ${JSON.stringify(seat)}
        )`,
        8000
      )
      if (!ready) return false
      await win.webContents.executeJavaScript(
        `(() => {
          const row = [...document.querySelectorAll('.import-panel tbody tr')].find(
            (tr) => tr.querySelector('td')?.textContent?.trim() === ${JSON.stringify(seat)}
          )
          const button = row?.querySelector('button')
          button?.click()
          return Boolean(button)
        })()`
      )
      return waitFor(
        `document.querySelector('.rv-student-seat')?.textContent?.trim() === ${JSON.stringify(seat)}`,
        8000
      )
    }

    const opened = await openSeat('02')
    if (!opened) return { ok: false, detail: '批閱座號 02 失敗' }
    const finalReady = await waitFor("document.querySelector('.rv-final')", 6000)
    if (!finalReady) return { ok: false, detail: '批閱畫面沒有總評輸入框' }

    // 1) API 回傳 matches：近似、未達上限時的結果。
    const apiResult = (await win.webContents.executeJavaScript(
      `window.electronAPI.work.reuse(
        ${JSON.stringify(classId)},
        ${JSON.stringify(assignmentId)},
        '02',
        ${JSON.stringify(NEAR_A)}
      )`
    )) as {
      count: number
      seats: string[]
      matches: { seat: string; similarity: number; exact: boolean }[]
    }
    const apiOk =
      apiResult.count === 1 &&
      apiResult.seats.join(',') === '01' &&
      apiResult.matches[0]?.exact === false &&
      (apiResult.matches[0]?.similarity ?? 0) >= FINAL_SIMILARITY_THRESHOLD

    // 2) 輸入近似文字，等 debounce 後顯示「相近」與百分比（未達上限，只是提醒）。
    await setTextarea('.rv-final', NEAR_A)
    const nearShown = await waitFor(
      `${bodyIncludes('相近')} && ${bodyIncludes(`01 ${nearPercent}%`)}`,
      6000
    )
    const blockedBefore = (await win.webContents.executeJavaScript(
      `Boolean([...document.querySelectorAll('.rv-warn')].find((el) => (el.textContent ?? '').includes('已達上限')))`
    )) as boolean

    // 3) 同批再多一份相同總評，達到上限 2 次 → 紅色阻擋警告。
    await addSecondBase()
    await setTextarea('.rv-final', `${NEAR_A}！`)
    const blockedShown = await waitFor(
      `[...document.querySelectorAll('.rv-warn')].some((el) =>
        (el.textContent ?? '').includes('已用 2 次') &&
        (el.textContent ?? '').includes('01 ${nearPercent}%、03 ${nearPercent}%') &&
        (el.textContent ?? '').includes('已達上限'))`,
      6000
    )
    const warnColor = (await win.webContents.executeJavaScript(
      `(() => {
        const el = [...document.querySelectorAll('.rv-warn')].find((item) =>
          (item.textContent ?? '').includes('已達上限'))
        return el ? getComputedStyle(el).backgroundColor : ''
      })()`
    )) as string
    const redOk = warnColor.includes('192, 57, 43')

    // 4) 完全相同也計入同一上限（相同座號 01、03）。
    await setTextarea('.rv-final', `${BASE}！`)
    const exactShown = await waitFor(
      `[...document.querySelectorAll('.rv-warn')].some((el) =>
        (el.textContent ?? '').includes('（01、03）') &&
        (el.textContent ?? '').includes('已達上限'))`,
      6000
    )

    const ok = apiOk && nearShown && !blockedBefore && blockedShown && redOk && exactShown
    const detail = ok
      ? `API matches 1 筆（近似、未 exact）；輸入近似後顯示「相近 01 ${nearPercent}%」；第 2 份後紅色阻擋（背景 ${warnColor}）；相同文字亦列 01、03`
      : `API ${apiOk ? '正常' : '異常'}；相近提示 ${nearShown ? '有' : '無'}；未達上限前阻擋 ${
          blockedBefore ? '誤顯示' : '未顯示'
        }；阻擋警告 ${blockedShown ? '有' : '無'}、紅色 ${redOk ? '是' : '否'}；相同提示 ${
          exactShown ? '有' : '無'
        }`
    return { ok, detail }
  } finally {
    win.destroy()
  }
}

/** `--similarity-check`：近似重複的相似度、門檻邊界、repository 計數、批次檢查與 UI 驗證。 */
export async function runSimilarityCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const assets = join(repoRoot, 'spike-out', 'similarity-assets')
  const root = join(repoRoot, 'spike-out', 'similarity-db')
  const uiRoot = join(repoRoot, 'spike-out', 'similarity-ui-db')

  await rm(assets, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
  await rm(uiRoot, { recursive: true, force: true })
  await mkdir(assets, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
    console.log(`[${pass(ok)}] ${label}：${detail}`)
  }

  const template = join(assets, 'page.jpg')
  await sharp({
    create: { width: 800, height: 1100, channels: 3, background: { r: 250, g: 248, b: 242 } }
  })
    .jpeg()
    .toFile(template)

  const seatsOrdered = ['01', '02', '03', '04', '05', '06', '07']

  try {
    // ---- 純函式：相似度與門檻 ------------------------------------------
    const nearScore = commentSimilarity(BASE, NEAR_A)
    const nearScoreB = commentSimilarity(BASE, NEAR_B)
    const shortScore = commentSimilarity(SHORT_BASE, SHORT_NEAR)
    const unrelatedScore = commentSimilarity(BASE, UNRELATED)
    const nearPercent = Math.round(nearScore * 100)

    const exactPair = findSimilarFinalComments(BASE, [{ seat: '01', text: BASE }])
    add(
      '完全相同 → 相似度 1、exact=true',
      commentSimilarity(BASE, BASE) === 1 && exactPair[0]?.exact === true && exactPair[0]?.similarity === 1,
      `similarity ${commentSimilarity(BASE, BASE)}、exact ${exactPair[0]?.exact ?? '—'}`
    )

    add(
      '中文近似（改一個詞）≥ 0.85 且非完全相同',
      nearScore >= FINAL_SIMILARITY_THRESHOLD &&
        nearScore < 1 &&
        findSimilarFinalComments(BASE, [{ seat: '03', text: NEAR_A }])[0]?.exact === false,
      `「段落間」版 ${nearScore.toFixed(4)}、「連接」版 ${nearScoreB.toFixed(4)}`
    )

    add(
      '明顯不同的總評 < 0.85',
      unrelatedScore < FINAL_SIMILARITY_THRESHOLD,
      `similarity ${unrelatedScore.toFixed(4)}`
    )

    add(
      '僅改 2 字（多一個「再」）低於門檻，不計入',
      shortScore < FINAL_SIMILARITY_THRESHOLD &&
        findSimilarFinalComments(SHORT_BASE, [{ seat: '06', text: SHORT_NEAR }]).length === 0,
      `similarity ${shortScore.toFixed(4)}（門檻 ${FINAL_SIMILARITY_THRESHOLD}）`
    )

    add(
      '空字串 → 0（含僅標點）',
      commentSimilarity('', BASE) === 0 &&
        commentSimilarity(BASE, '') === 0 &&
        commentSimilarity('', '') === 0 &&
        commentSimilarity(' 。，', BASE) === 0 &&
        findSimilarFinalComments('', [{ seat: '01', text: BASE }]).length === 0,
      '空字串、僅標點與空白皆為 0，且不列為重複'
    )

    add(
      '單字元走 unigram 路徑（相同 1、不同 0）',
      commentSimilarity('好', '好！') === 1 && commentSimilarity('好', '的') === 0,
      '「好」vs「好！」= 1；「好」vs「的」= 0'
    )

    const ordered = findSimilarFinalComments(BASE, [
      { seat: '09', text: BASE },
      { seat: '02', text: BASE },
      { seat: '07', text: NEAR_A },
      { seat: '04', text: NEAR_B },
      { seat: '11', text: UNRELATED },
      { seat: '12', text: '' },
      { seat: '13', text: SHORT_NEAR }
    ])
    const orderedSeats = ordered.map((match) => match.seat).join(',')
    const orderedExact = ordered.map((match) => match.exact).join(',')
    const uniqueSeats = new Set(ordered.map((match) => match.seat)).size === ordered.length
    add(
      'findSimilar：相似度高到低、座號小到大；exact 與近似不重複',
      orderedSeats === '02,09,07,04' &&
        orderedExact === 'true,true,false,false' &&
        uniqueSeats &&
        (ordered[2]?.similarity ?? 0) >= (ordered[3]?.similarity ?? 1),
      `順序 ${orderedSeats}；exact ${orderedExact}`
    )

    const boundaryIn = findSimilarFinalComments(BASE, [{ seat: '07', text: NEAR_A }], nearScore)
    const boundaryOut = findSimilarFinalComments(
      BASE,
      [{ seat: '07', text: NEAR_A }],
      nearScore + 0.0001
    )
    add(
      '門檻邊界：相似度等於門檻列入、略高於相似度則排除',
      boundaryIn.length === 1 && boundaryOut.length === 0,
      `等於門檻 ${boundaryIn.length} 筆；高於 ${boundaryOut.length} 筆`
    )

    // ---- repository：countFinalReuse ------------------------------------
    await openDatabase(root, { remember: false })
    const created = await createClass({
      classNo: '901',
      name: '相似測試901',
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: '王老師'
    })
    const students: Student[] = Array.from({ length: 7 }, (_, index) => {
      const seat = pad(index + 1)
      return { seat, name: `學生${seat}`, active: true }
    })
    await saveClass({
      schema_version: 1,
      id: created.id,
      name: '相似測試901',
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: '王老師',
      students
    })
    const assignmentSummary = await createAssignment(
      CreateAssignmentInputSchema.parse({ classId: created.id, title: '近似重複' })
    )
    const assignment = (await loadAssignment(created.id, assignmentSummary.id))
      .data as AssignmentFile
    const max = assignment.rules.final_max_reuse

    const texts: Record<string, string> = {
      '01': BASE,
      '02': BASE,
      '03': NEAR_A,
      '04': NEAR_B,
      '05': UNRELATED,
      '06': SHORT_NEAR,
      '07': ''
    }
    const assignmentDir = join(root, created.id, assignment.id)
    for (const seat of seatsOrdered) {
      const dir = join(assignmentDir, `S${seat}`)
      await mkdir(dir, { recursive: true })
      await copyFile(template, join(dir, 'p1.jpg'))
      await saveWork(
        created.id,
        assignment.id,
        seat,
        makeWork(created.id, assignment.id, seat, seat === '01' || seat === '02' ? 'done' : 'grading', texts[seat] ?? '')
      )
    }

    const reuse01 = await countFinalReuse(created.id, assignment.id, '01', BASE)
    const reuse01Seats = reuse01.seats.join(',')
    add(
      'countFinalReuse：同批相同＋近似，排除自己、空文字與門檻外',
      reuse01.count === 3 &&
        reuse01Seats === '02,03,04' &&
        reuse01.matches.map((m) => m.exact).join(',') === 'true,false,false' &&
        reuse01.matches.every((m) => m.seat !== '01' && m.seat !== '07'),
      `座號 01：count ${reuse01.count}、seats ${reuse01Seats}、exact ${reuse01.matches
        .map((m) => m.exact)
        .join(',')}`
    )

    const reuse03 = await countFinalReuse(created.id, assignment.id, '03', NEAR_A)
    const reuse03Seats = reuse03.seats
    add(
      'countFinalReuse：近似文字可找到相同文字的作品，且不列入自己',
      reuse03Seats.includes('01') &&
        reuse03Seats.includes('02') &&
        !reuse03Seats.includes('03') &&
        reuse03.count === reuse03.seats.length &&
        new Set(reuse03Seats).size === reuse03Seats.length,
      `座號 03：seats ${reuse03Seats.join(',')}，每座號僅一筆`
    )

    const reuseEmpty = await countFinalReuse(created.id, assignment.id, '01', '  ')
    add(
      'countFinalReuse：空白文字不比對',
      reuseEmpty.count === 0 && reuseEmpty.matches.length === 0,
      `count ${reuseEmpty.count}`
    )

    // ---- 批次檢查：近似也計入，且與獨立計算一致 ----------------------------
    const audit = await auditAssignment(created.id, assignment.id)
    const flagged = audit.rows
      .filter((row) => row.issues.some((issue) => issue.type === 'final_reuse'))
      .map((row) => row.seat)
    const expectedFlagged = seatsOrdered.filter((seat, index) => {
      const text = texts[seat] ?? ''
      if (!text.trim()) return false
      const priors = seatsOrdered
        .slice(0, index)
        .filter((prior) => commentSimilarity(texts[prior] ?? '', text) >= FINAL_SIMILARITY_THRESHOLD)
      return priors.length >= max
    })
    const consistentRows = seatsOrdered.filter(
      (seat) => flagged.includes(seat) === expectedFlagged.includes(seat)
    ).length
    add(
      '批次檢查：前 2 次合法、第 3 次起標記（近似也計入）',
      flagged.join(',') === '03,04' && flagged.join(',') === expectedFlagged.join(','),
      `標記 ${flagged.join(',') || '無'}；獨立計算 ${expectedFlagged.join(',') || '無'}；一致 ${consistentRows}/${seatsOrdered.length}`
    )

    const thirdMessage =
      audit.rows
        .find((row) => row.seat === '03')
        ?.issues.find((issue) => issue.type === 'final_reuse')?.message ?? ''
    add(
      '批次檢查訊息列出座號並說明相同或近似',
      thirdMessage.includes('相同或近似') &&
        thirdMessage.includes('01、02') &&
        thirdMessage.includes('第 3 次') &&
        thirdMessage.includes('上限 2 次'),
      thirdMessage || '未標記'
    )

    const untouched = ['01', '02', '05', '06', '07'].every(
      (seat) => !audit.rows.find((row) => row.seat === seat)?.issues.some((issue) => issue.type === 'final_reuse')
    )
    add(
      '批次檢查：前 2 次、不同與門檻外的作品不被誤標',
      untouched,
      untouched ? 'S01、S02、S05、S06、S07 皆無總評重複' : '有作品被誤標'
    )

    // ---- UI：批閱畫面（獨立資料庫） -------------------------------------
    await closeDatabase()
    await openDatabase(uiRoot, { remember: false })
    const uiClass = await createClass({
      classNo: '902',
      name: '相似測試902',
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: '王老師'
    })
    await saveClass({
      schema_version: 1,
      id: uiClass.id,
      name: '相似測試902',
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: '王老師',
      students: [
        { seat: '01', name: '學生01', active: true },
        { seat: '02', name: '學生02', active: true },
        { seat: '03', name: '學生03', active: true }
      ]
    })
    const uiAssignmentSummary = await createAssignment(
      CreateAssignmentInputSchema.parse({ classId: uiClass.id, title: '近似 UI' })
    )
    const uiAssignment = (await loadAssignment(uiClass.id, uiAssignmentSummary.id))
      .data as AssignmentFile
    const uiDir = join(uiRoot, uiClass.id, uiAssignment.id)
    const writeUiWork = async (seat: string, status: WorkStatus, text: string): Promise<void> => {
      const dir = join(uiDir, `S${seat}`)
      await mkdir(dir, { recursive: true })
      await copyFile(template, join(dir, 'p1.jpg'))
      await saveWork(
        uiClass.id,
        uiAssignment.id,
        seat,
        makeWork(uiClass.id, uiAssignment.id, seat, status, text)
      )
    }
    await writeUiWork('01', 'done', BASE)
    await writeUiWork('02', 'grading', UNRELATED)

    const ui = await runUiSmoke(uiClass.id, uiAssignment.id, nearPercent, async () => {
      await writeUiWork('03', 'done', BASE)
    })
    add('批閱 UI：近似「相近」百分比、API matches、紅色阻擋與相同文字', ui.ok, ui.detail)

    await closeDatabase()
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已經關閉或從未開啟
    }
  }

  console.log('')
  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[similarity] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
