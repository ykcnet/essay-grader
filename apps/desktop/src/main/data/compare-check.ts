import { app, BrowserWindow } from 'electron'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  compareAssignmentStats,
  type Annotation,
  type AssignmentComparison,
  type WorkFile
} from '@essay-grader/core'
import {
  closeDatabase,
  compareAssignments,
  createAssignment,
  createClass,
  getAssignmentStats,
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

const CLASS_NAME = '高中302'
const TEACHER = '王老師'
const FINAL =
  '取材自生活經驗，敘寫具體，段落安排清楚，結尾能回應題旨；若再加上具體反思，文章會更有層次。'
const FIXED_TIME = '2026-11-20T12:00:00.000Z'

type Counts = { typo: number; sentence: number; structure: number; other: number; praise?: number }

let annotationSeq = 0

function annotations(counts: Counts): Annotation[] {
  const result: Annotation[] = []
  const push = (category: Annotation['category'], amount: number): void => {
    for (let index = 0; index < amount; index += 1) {
      annotationSeq += 1
      result.push({
        id: `a-${String(annotationSeq).padStart(3, '0')}`,
        page_id: 'p1',
        anchor: { x: 0.2, y: 0.2 },
        category,
        text: category,
        created_at: FIXED_TIME
      })
    }
  }
  push('typo', counts.typo)
  push('sentence', counts.sentence)
  push('structure', counts.structure)
  push('other', counts.other)
  push('praise', counts.praise ?? 0)
  return result
}

function makeWork(
  classId: string,
  assignmentId: string,
  seat: string,
  name: string,
  score: number,
  grade: string,
  counts: Counts
): WorkFile {
  return {
    schema_version: 1,
    class_id: classId,
    assignment_id: assignmentId,
    seat,
    name,
    status: 'done',
    pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
    annotations: annotations(counts),
    scores: {
      items: { content: 32, structure: 24, language: 20 },
      deduction: { typo: 0, punct: 0, override: null },
      total: score,
      grade
    },
    final_comment: { text: FINAL },
    updated_at: FIXED_TIME
  }
}

function waitFor(win: BrowserWindow, expression: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  return (async () => {
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = (await win.webContents.executeJavaScript(`Boolean(${expression})`)) as boolean
        if (ok) return true
      } catch {
        // 頁面還在下載
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    return false
  })()
}

type UiResult = {
  ok: boolean
  detail: string
}

async function runUiSmoke(
  currentId: string,
  previousId: string,
  olderId: string
): Promise<UiResult> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const clickAssignment = async (assignmentId: string): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const row = [...document.querySelectorAll('.assignment-row')].find(
          (item) => item.textContent?.includes(${JSON.stringify(assignmentId)})
        )
        if (!row) return false
        row.click()
        return true
      })()`
    )) as boolean

  const clickStats = async (): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll('.import-panel .card-head button')].find(
          (item) => item.textContent?.trim() === '統計'
        )
        if (!button) return false
        button.click()
        return true
      })()`
    )) as boolean

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const ready = await waitFor(
      win,
      "document.body.innerText.includes('作文批閱') && document.querySelectorAll('.assignment-row').length > 0",
      10000
    )
    if (!ready) return { ok: false, detail: '主畫面或作業列表未渲染' }

    if (!(await clickAssignment(currentId))) return { ok: false, detail: '找不到目前作業列' }
    if (!(await clickStats())) return { ok: false, detail: '找不到統計按鈕' }

    const panelReady = await waitFor(win, "document.querySelector('.compare-block') !== null", 10000)
    const compareReady = await waitFor(
      win,
      "document.querySelector('[data-compare-state=\"ready\"]') !== null",
      12000
    )
    if (!panelReady || !compareReady) {
      return {
        ok: false,
        detail: panelReady ? '比較區塊出現，但資料未載入' : '比較區塊未出現'
      }
    }

    const first = (await win.webContents.executeJavaScript(
      `(() => {
        const select = document.querySelector('.compare-select')
        const summary = document.querySelector('.compare-summary')?.innerText ?? ''
        const weakness = document.querySelector('.compare-weakness-table')?.innerText ?? ''
        const student = document.querySelector('.compare-student-table')
        const statuses = [...document.querySelectorAll('.compare-student-table .compare-status')]
          .map((item) => item.textContent?.trim() ?? '')
        const ranks = [...document.querySelectorAll('.compare-rank')].map(
          (item) => item.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
        )
        return {
          selectValue: select ? select.value : '',
          selectOptions: select ? select.options.length : 0,
          summary,
          weakness,
          studentRows: student ? student.querySelectorAll('tbody tr').length : 0,
          statuses,
          ranks,
          hasTableHead:
            student?.querySelector('th')?.textContent?.trim() === '座號' &&
            (document.querySelector('.compare-weakness-table th')?.textContent?.trim() ?? '') ===
              '類別',
          api: Boolean(
            window.electronAPI &&
            typeof window.electronAPI.stats?.compare === 'function'
          )
        }
      })()`
    )) as {
      selectValue: string
      selectOptions: number
      summary: string
      weakness: string
      studentRows: number
      statuses: string[]
      ranks: string[]
      hasTableHead: boolean
      api: boolean
    }

    const firstOk =
      first.selectValue === previousId &&
      previousId.endsWith('-02') &&
      first.selectOptions >= 3 &&
      first.summary.includes('已比較 3 份') &&
      first.summary.includes('78.3') &&
      first.summary.includes('79.7') &&
      first.summary.includes('+1.4') &&
      first.summary.includes('進步 1') &&
      first.summary.includes('退步 1') &&
      first.summary.includes('持平 1') &&
      first.summary.includes('新作品 1') &&
      first.summary.includes('缺資料 1') &&
      first.weakness.includes('錯字') &&
      first.weakness.includes('1.3') &&
      first.weakness.includes('1.0') &&
      first.weakness.includes('語句') &&
      first.weakness.includes('0.7') &&
      first.weakness.includes('0.3') &&
      first.weakness.includes('結構') &&
      first.weakness.includes('0.7') &&
      first.studentRows === 5 &&
      first.statuses.join('、') === '進步、退步、持平、缺資料、新作品' &&
      first.ranks.some((item) => item.includes('07') && item.includes('+9')) &&
      first.ranks.some((item) => item.includes('08') && item.includes('-5')) &&
      first.hasTableHead &&
      first.api

    if (!firstOk) {
      return {
        ok: false,
        detail: `預設 ${first.selectValue}／摘要 ${first.summary.replace(/\\s+/g, ' ').slice(0, 80)}／列 ${first.studentRows}`
      }
    }

    // 換 previousId：改選更早的作業，摘要與排行必須跟著變。
    const changed = (await win.webContents.executeJavaScript(
      `(() => {
        const select = document.querySelector('.compare-select')
        if (!select) return false
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          'value'
        )?.set
        setter?.call(select, ${JSON.stringify(olderId)})
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`
    )) as boolean

    const switched = changed
      ? await waitFor(
          win,
          `document.querySelector('.compare-summary')?.innerText?.includes('73.3') === true &&
           document.querySelector('.compare-summary')?.innerText?.includes('+6.4') === true`,
          12000
        )
      : false

    // 切換目前作業：比較選擇要重置成新作業的預設（更早的那一份）。
    const switchedAssignment = await clickAssignment(previousId)
    const panelClosed = switchedAssignment
      ? await waitFor(win, "document.querySelector('.stats-panel') === null", 6000)
      : false
    const statsAgain = panelClosed ? await clickStats() : false
    const readyAgain = statsAgain
      ? await waitFor(
          win,
          "document.querySelector('[data-compare-state=\"ready\"]') !== null",
          12000
        )
      : false
    const resetValue = readyAgain
      ? ((await win.webContents.executeJavaScript(
          "document.querySelector('.compare-select')?.value ?? ''"
        )) as string)
      : ''

    const ok = firstOk && switched && resetValue === olderId
    return {
      ok,
      detail: `區塊 是、下拉預設 ${first.selectValue}、摘要 78.3→79.7（+1.4）、學生 ${first.studentRows} 列、換上次 ${switched ? '是' : '否'}、切換作業重置 ${resetValue || '否'}、preload API ${first.api ? '是' : '否'}`
    }
  } finally {
    win.destroy()
  }
}

/** `--compare-check`：G4 與上次比較的核心、repository、拒絕情境與 UI。 */
export async function runCompareCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'compare-check')
  const dbRoot = join(work, 'db')

  await rm(work, { recursive: true, force: true })
  await mkdir(dbRoot, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    await openDatabase(dbRoot, { remember: false })
    add('開啟暫存資料庫', true, dbRoot)

    const created = await createClass({
      classNo: '302',
      name: CLASS_NAME,
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: TEACHER
    })

    const names: Record<string, string> = {
      '07': '王小明',
      '08': '陳大華',
      '12': '林小美',
      '15': '張小華',
      '20': '李大同'
    }

    await saveClass({
      schema_version: 1,
      id: created.id,
      name: CLASS_NAME,
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: TEACHER,
      students: Object.entries(names).map(([seat, name]) => ({
        seat,
        name,
        active: true
      }))
    })

    const older = (await createAssignment({
      classId: created.id,
      title: '更早的作業',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-10T04:00:00.000Z'
    })) as { id: string }
    const previous = (await createAssignment({
      classId: created.id,
      title: '上次作業',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-10T04:00:00.000Z'
    })) as { id: string }
    const current = (await createAssignment({
      classId: created.id,
      title: '本次作業',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-20T04:00:00.000Z'
    })) as { id: string }

    add(
      '建立 5 位學生與 3 份作業（含同日 -02）',
      Object.keys(names).length === 5 &&
        older.id < previous.id &&
        previous.id < current.id &&
        previous.id.endsWith('-02'),
      `${older.id}、${previous.id}、${current.id}`
    )

    // 上次：S07 70 B+、S08 85 A+、S12 80 A、S15 60 C
    await saveWork(
      created.id,
      previous.id,
      '07',
      makeWork(created.id, previous.id, '07', names['07']!, 70, 'B+', {
        typo: 1,
        sentence: 1,
        structure: 1,
        other: 0
      })
    )
    await saveWork(
      created.id,
      previous.id,
      '08',
      makeWork(created.id, previous.id, '08', names['08']!, 85, 'A+', {
        typo: 2,
        sentence: 1,
        structure: 0,
        other: 0
      })
    )
    await saveWork(
      created.id,
      previous.id,
      '12',
      makeWork(created.id, previous.id, '12', names['12']!, 80, 'A', {
        typo: 1,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )
    await saveWork(
      created.id,
      previous.id,
      '15',
      makeWork(created.id, previous.id, '15', names['15']!, 60, 'C', {
        typo: 0,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )

    // 本次：S07 79 B++、S08 80 A、S12 80 A、S20 75 B++、S15 缺資料
    await saveWork(
      created.id,
      current.id,
      '07',
      makeWork(created.id, current.id, '07', names['07']!, 79, 'B++', {
        typo: 1,
        sentence: 0,
        structure: 1,
        other: 0
      })
    )
    await saveWork(
      created.id,
      current.id,
      '08',
      makeWork(created.id, current.id, '08', names['08']!, 80, 'A', {
        typo: 1,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )
    await saveWork(
      created.id,
      current.id,
      '12',
      makeWork(created.id, current.id, '12', names['12']!, 80, 'A', {
        typo: 1,
        sentence: 1,
        structure: 1,
        other: 0
      })
    )
    await saveWork(
      created.id,
      current.id,
      '20',
      makeWork(created.id, current.id, '20', names['20']!, 75, 'B++', {
        typo: 0,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )

    // 更早的作業：分數不同，用來驗證切換 previousId 後結果會變。
    await saveWork(
      created.id,
      older.id,
      '07',
      makeWork(created.id, older.id, '07', names['07']!, 60, 'B', {
        typo: 0,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )
    await saveWork(
      created.id,
      older.id,
      '08',
      makeWork(created.id, older.id, '08', names['08']!, 90, 'A++', {
        typo: 0,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )
    await saveWork(
      created.id,
      older.id,
      '12',
      makeWork(created.id, older.id, '12', names['12']!, 70, 'B+', {
        typo: 0,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )
    await saveWork(
      created.id,
      older.id,
      '15',
      makeWork(created.id, older.id, '15', names['15']!, 65, 'B', {
        typo: 0,
        sentence: 0,
        structure: 0,
        other: 0
      })
    )

    const currentStats = await getAssignmentStats(created.id, current.id)
    const previousStats = await getAssignmentStats(created.id, previous.id)
    const currentSnapshot = JSON.stringify(currentStats)
    const previousSnapshot = JSON.stringify(previousStats)

    const comparison = compareAssignmentStats(currentStats, previousStats, FIXED_TIME)
    const summary = comparison.summary

    add(
      '核心比較：狀態分布',
      summary.students === 5 &&
        summary.compared === 3 &&
        summary.improved === 1 &&
        summary.declined === 1 &&
        summary.same === 1 &&
        summary.new === 1 &&
        summary.missing === 1 &&
        summary.incomplete === 0,
      `在學 ${summary.students}、已比較 ${summary.compared}、進步 ${summary.improved}、退步 ${summary.declined}、持平 ${summary.same}、新作品 ${summary.new}、缺資料 ${summary.missing}、資料不足 ${summary.incomplete}`
    )

    const row = (seat: string) => comparison.students.find((item) => item.seat === seat)
    add(
      '核心比較：以座號對齊與逐筆狀態',
      row('07')?.status === 'improved' &&
        row('07')?.delta === 9 &&
        row('07')?.previousGrade === 'B+' &&
        row('07')?.currentGrade === 'B++' &&
        row('08')?.status === 'declined' &&
        row('08')?.delta === -5 &&
        row('12')?.status === 'same' &&
        row('12')?.delta === 0 &&
        row('20')?.status === 'new' &&
        row('20')?.previousScore === null &&
        row('20')?.currentScore === 75 &&
        row('15')?.status === 'missing' &&
        row('15')?.previousScore === 60 &&
        row('15')?.currentScore === null,
      'S07 +9、S08 −5、S12 0、S20 新作品、S15 缺資料'
    )

    add(
      '平均只計 compared 學生',
      summary.averagePrevious === 78.3 &&
        summary.averageCurrent === 79.7 &&
        summary.averageDelta === 1.4,
      `${summary.averagePrevious} → ${summary.averageCurrent}（Δ ${summary.averageDelta}）`
    )

    add(
      '進步／退步前 5',
      summary.topImproved.length === 1 &&
        summary.topImproved[0]?.seat === '07' &&
        summary.topImproved[0]?.delta === 9 &&
        summary.topDeclined.length === 1 &&
        summary.topDeclined[0]?.seat === '08' &&
        summary.topDeclined[0]?.delta === -5,
      `進步 ${summary.topImproved.map((item) => `${item.seat} ${item.delta}`).join('、')}；退步 ${summary.topDeclined.map((item) => `${item.seat} ${item.delta}`).join('、')}`
    )

    const weakness = (category: string) =>
      comparison.weaknesses.find((item) => item.category === category)
    add(
      '弱項類別每份平均與方向',
      comparison.weaknesses.length === 4 &&
        weakness('typo')?.previousPerStudent === 1.3 &&
        weakness('typo')?.currentPerStudent === 1 &&
        weakness('typo')?.delta === -0.3 &&
        weakness('sentence')?.previousPerStudent === 0.7 &&
        weakness('sentence')?.currentPerStudent === 0.3 &&
        weakness('sentence')?.delta === -0.4 &&
        weakness('structure')?.previousPerStudent === 0.3 &&
        weakness('structure')?.currentPerStudent === 0.7 &&
        weakness('structure')?.delta === 0.4 &&
        weakness('other')?.previousPerStudent === 0 &&
        weakness('other')?.currentPerStudent === 0 &&
        weakness('other')?.delta === 0,
      comparison.weaknesses
        .map(
          (item) =>
            `${item.label} ${item.previousPerStudent?.toFixed(1) ?? '—'}→${item.currentPerStudent?.toFixed(1) ?? '—'}（${item.delta?.toFixed(1) ?? '—'}）`
        )
        .join('、')
    )

    add(
      '純函式不改來源且可注入 generatedAt',
      comparison.generatedAt === FIXED_TIME &&
        JSON.stringify(currentStats) === currentSnapshot &&
        JSON.stringify(previousStats) === previousSnapshot &&
        comparison.currentAssignmentId === current.id &&
        comparison.previousAssignmentId === previous.id,
      `generatedAt ${comparison.generatedAt}；來源統計未變`
    )

    const wired: AssignmentComparison = await compareAssignments(
      created.id,
      current.id,
      previous.id
    )
    add(
      'repository 比較：id 與標題',
      wired.currentAssignmentId === current.id &&
        wired.previousAssignmentId === previous.id &&
        wired.currentTitle === '本次作業' &&
        wired.previousTitle === '上次作業' &&
        wired.summary.improved === 1 &&
        wired.summary.declined === 1,
      `${wired.previousAssignmentId} → ${wired.currentAssignmentId}`
    )

    const switched = await compareAssignments(created.id, current.id, older.id)
    add(
      '換 previousId 後結果改變',
      switched.previousAssignmentId === older.id &&
        switched.summary.averagePrevious === 73.3 &&
        switched.summary.averageCurrent === 79.7 &&
        switched.summary.averageDelta === 6.4 &&
        switched.summary.topImproved[0]?.seat === '07' &&
        switched.summary.topImproved[0]?.delta === 19 &&
        switched.summary.topDeclined[0]?.seat === '08' &&
        switched.summary.topDeclined[0]?.delta === -10,
      `${switched.summary.averagePrevious} → ${switched.summary.averageCurrent}（Δ ${switched.summary.averageDelta}）`
    )

    const reject = async (action: () => Promise<unknown>): Promise<string> => {
      try {
        await action()
        return ''
      } catch (error) {
        return message(error)
      }
    }

    const sameError = await reject(() => compareAssignments(created.id, current.id, current.id))
    add(
      '拒絕同一份作業自己比較',
      sameError.includes('不能是同一份'),
      sameError || '未拒絕'
    )

    const otherClass = await createClass({
      classNo: '303',
      name: '高中303',
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: TEACHER
    })
    const cross = (await createAssignment({
      classId: otherClass.id,
      title: '別班作業',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-18T04:00:00.000Z'
    })) as { id: string }

    const crossError = await reject(() =>
      compareAssignments(created.id, current.id, cross.id)
    )
    add(
      '拒絕跨班作業',
      crossError.includes('找不到上次作業'),
      crossError || '未拒絕'
    )

    const missingCurrent = await reject(() =>
      compareAssignments(created.id, 'E20990101', previous.id)
    )
    const missingPrevious = await reject(() =>
      compareAssignments(created.id, current.id, 'E20990101')
    )
    add(
      '拒絕不存在的作業',
      missingCurrent.includes('找不到目前作業') &&
        missingPrevious.includes('找不到上次作業'),
      `${missingCurrent || '未拒絕'}；${missingPrevious || '未拒絕'}`
    )

    // ---- UI --------------------------------------------------------------
    const ui = await runUiSmoke(current.id, previous.id, older.id)
    add('UI：比較區塊、下拉、摘要、弱項表、學生表與重置', ui.ok, ui.detail)

    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已關閉或從未開啟
    }
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[compare] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
