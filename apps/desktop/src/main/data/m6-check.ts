import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Annotation, AssignmentFile, WorkFile } from '@essay-grader/core'
import {
  closeDatabase,
  createAssignment,
  createClass,
  exportAssignmentStats,
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
const now = (): string => new Date().toISOString()

const CLASS_NAME = '高中302'
const TEACHER = '王老師'
const TITLE = '我的母親'
const FINAL =
  '取材自生活經驗，敘寫具體，段落安排清楚，結尾能回應題旨；若再加上具體反思，文章會更有層次。'

function annotation(
  id: string,
  category: Annotation['category'],
  text: string,
  subtype?: string,
  meta?: Annotation['meta']
): Annotation {
  return {
    id,
    page_id: 'p1',
    anchor: { x: 0.2, y: 0.2 },
    category,
    ...(subtype ? { subtype } : {}),
    text,
    ...(meta ? { meta } : {}),
    created_at: now()
  }
}

function makeWork(
  classId: string,
  assignmentId: string,
  seat: string,
  name: string,
  status: WorkFile['status'],
  annotations: Annotation[],
  scores: WorkFile['scores']
): WorkFile {
  return {
    schema_version: 1,
    class_id: classId,
    assignment_id: assignmentId,
    seat,
    name,
    status,
    pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
    annotations,
    scores,
    final_comment: { text: FINAL },
    updated_at: '2026-11-19T09:00:00.000Z'
  }
}

function waitFor(
  win: BrowserWindow,
  expression: string,
  timeoutMs: number
): Promise<boolean> {
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

async function runUiSmoke(): Promise<{ ok: boolean; detail: string }> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const mainReady = await waitFor(
      win,
      "document.body.innerText.includes('作文批閱') && !document.body.innerText.includes('載入中')",
      6000
    )
    if (!mainReady) return { ok: false, detail: '主畫面未渲染' }

    const assignmentReady = await waitFor(win, "document.querySelector('.assignment-row')", 6000)
    if (!assignmentReady) return { ok: false, detail: '找不到作業列' }
    await win.webContents.executeJavaScript(
      "document.querySelector('.assignment-row')?.click()"
    )

    const buttonReady = await waitFor(
      win,
      `[...document.querySelectorAll('.import-panel .card-head button')].some(
        (item) => item.textContent?.trim() === '統計'
      )`,
      6000
    )
    if (!buttonReady) return { ok: false, detail: '找不到統計按鈕' }

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.import-panel .card-head button')]
        .find((item) => item.textContent?.trim() === '統計')?.click()`
    )

    const panelReady = await waitFor(win, "document.querySelector('.stats-panel')", 6000)
    const statsReady = panelReady
      ? await waitFor(
          win,
          `document.querySelector('.stats-panel')?.textContent?.includes('已批 4')`,
          6000
        )
      : false
    if (!panelReady || !statsReady) {
      return {
        ok: false,
        detail: panelReady ? '統計面板出現，但資料未載入' : '統計面板未出現'
      }
    }

    const text = (await win.webContents.executeJavaScript(
      "document.querySelector('.stats-panel')?.innerText ?? ''"
    )) as string

    // 統計面板比預設視窗高；依面板實際高度調整視窗，讓摘要、G1、G2、G3 一次入鏡。
    const panelHeight = (await win.webContents.executeJavaScript(
      "document.querySelector('.stats-panel')?.offsetHeight ?? 900"
    )) as number
    win.setContentSize(1440, Math.max(900, Math.ceil(panelHeight) + 180))
    await new Promise((resolve) => setTimeout(resolve, 600))

    // 視窗放大是非同步的，重複微調直到面板對齊內容頂端（避免只截到頁面上方）。
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const offset = (await win.webContents.executeJavaScript(
        `(() => {
          const content = document.querySelector('.content')
          const panel = document.querySelector('.stats-panel')
          if (!content || !panel) return -1
          const delta =
            panel.getBoundingClientRect().top - content.getBoundingClientRect().top - 8
          content.scrollTop += delta
          return panel.getBoundingClientRect().top - content.getBoundingClientRect().top
        })()`
      )) as number
      if (offset >= 0 && offset <= 12) break
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    // 隱藏視窗捲動後不會更新畫面；移到螢幕外顯示後再截圖，避免截到捲動前的內容。
    win.setPosition(-20000, -20000)
    win.showInactive()
    await new Promise((resolve) => setTimeout(resolve, 600))
    win.webContents.invalidate()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const image = await win.webContents.capturePage()
    await writeFile(join(app.getAppPath(), '..', '..', 'spike-out', 'm6-stats.png'), image.toPNG())

    const auditRows = (await win.webContents.executeJavaScript(
      "document.querySelectorAll('.stats-table tbody tr').length"
    )) as number

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.stats-panel button')]
        .find((item) => item.textContent?.trim() === '匯出 CSV')?.click()`
    )
    const exported = await waitFor(
      win,
      `document.querySelector('.stats-panel')?.textContent?.includes('scores.csv')`,
      8000
    )

    const ok =
      text.includes('已批 4') &&
      text.includes('平均 81') &&
      text.includes('在') &&
      text.includes('再') &&
      text.includes('陳,大華') &&
      auditRows >= 6 &&
      exported

    return {
      ok,
      detail: `已批 4、平均 81、表格 ${auditRows} 列、CSV 匯出 ${exported ? '是' : '否'}、截圖 spike-out/m6-stats.png`
    }
  } finally {
    win.destroy()
  }
}

/** `--m6-check`：G1／G2／G3、CSV 與統計 UI。 */
export async function runM6Check(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const assets = join(repoRoot, 'spike-out', 'm6-assets')
  const root = join(repoRoot, 'spike-out', 'm6-db')

  await rm(assets, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
  await mkdir(assets, { recursive: true })
  await mkdir(root, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    await openDatabase(root, { remember: false })
    add('開啟暫存資料庫', true, root)

    const created = await createClass({
      classNo: '302',
      name: CLASS_NAME,
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: TEACHER
    })

    await saveClass({
      schema_version: 1,
      id: created.id,
      name: CLASS_NAME,
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: TEACHER,
      students: [
        { seat: '07', name: '王小明', active: true },
        { seat: '08', name: '陳,大華', active: true },
        { seat: '12', name: '林小美', active: true },
        { seat: '15', name: '張小華', active: true },
        { seat: '20', name: '李大同', active: true },
        { seat: '21', name: '吳小安', active: true }
      ]
    })

    const assignment = (await createAssignment({
      classId: created.id,
      title: TITLE,
      prompt: '',
      rubricPreset: 'balanced'
    })) as { id: string }

    const template = join(assets, 'page.jpg')
    await sharp({
      create: {
        width: 800,
        height: 1100,
        channels: 3,
        background: { r: 250, g: 248, b: 242 }
      }
    })
      .jpeg()
      .toFile(template)

    const assignmentDir = join(root, created.id, assignment.id)
    for (const seat of ['07', '08', '12', '15', '20']) {
      const dir = join(assignmentDir, `S${seat}`)
      await mkdir(dir, { recursive: true })
      await copyFile(template, join(dir, 'p1.jpg'))
    }

    const scores = (content: number, structure: number, language: number) => ({
      items: { content, structure, language },
      deduction: { typo: 0, punct: 0, override: null },
      total: content + structure + language,
      grade: ''
    })

    await saveWork(
      created.id,
      assignment.id,
      '07',
      makeWork(
        created.id,
        assignment.id,
        '07',
        '王小明',
        'done',
        [
          annotation('t1', 'typo', '在再不分', undefined, { wrong: '在', correct: '再' }),
          annotation('t2', 'typo', '在再不分', undefined, { wrong: '在', correct: '再' }),
          annotation('t3', 'typo', '的得不分', undefined, { wrong: '的', correct: '得' }),
          annotation('s1', 'sentence', '用詞', 'word_choice'),
          annotation('s2', 'sentence', '用詞', 'word_choice'),
          annotation('r1', 'structure', '轉折', 'transition'),
          annotation('p1', 'praise', '佳句'),
          annotation('c1', 'comment', '整體評語')
        ],
        { ...scores(32, 24, 25), deduction: { typo: 2, punct: 0, override: null }, total: 79, grade: 'B++' }
      )
    )

    await saveWork(
      created.id,
      assignment.id,
      '08',
      makeWork(
        created.id,
        assignment.id,
        '08',
        '陳,大華',
        'done',
        [
          annotation('t4', 'typo', '在再不分', undefined, { wrong: '在', correct: '再' }),
          annotation('s3', 'sentence', '冗贅', 'redundant'),
          annotation('s4', 'sentence', '冗贅', 'redundant'),
          annotation('r2', 'structure', '離題', 'off_topic')
        ],
        { ...scores(28, 20, 22), total: 70, grade: 'B+' }
      )
    )

    await saveWork(
      created.id,
      assignment.id,
      '12',
      makeWork(
        created.id,
        assignment.id,
        '12',
        '林小美',
        'done',
        [
          annotation('t5', 'typo', '以已不分', undefined, { wrong: '已', correct: '以' }),
          annotation('s5', 'sentence', '銜接', 'cohesion'),
          annotation('r3', 'structure', '轉折', 'transition'),
          annotation('p2', 'praise', '佳句'),
          annotation('p3', 'praise', '佳句')
        ],
        { ...scores(34, 26, 25), total: 85, grade: 'A+' }
      )
    )

    await saveWork(
      created.id,
      assignment.id,
      '15',
      makeWork(
        created.id,
        assignment.id,
        '15',
        '張小華',
        'done',
        [annotation('p4', 'praise', '佳句')],
        { ...scores(38, 27, 25), total: 90, grade: 'A++' }
      )
    )

    await saveWork(
      created.id,
      assignment.id,
      '20',
      makeWork(
        created.id,
        assignment.id,
        '20',
        '李大同',
        'grading',
        [
          annotation('t6', 'typo', '錯字', undefined, { wrong: '在', correct: '再' }),
          annotation('t7', 'typo', '錯字', undefined, { wrong: '在', correct: '再' }),
          annotation('t8', 'typo', '錯字', undefined, { wrong: '在', correct: '再' }),
          annotation('t9', 'typo', '錯字', undefined, { wrong: '在', correct: '再' }),
          annotation('t10', 'typo', '錯字', undefined, { wrong: '在', correct: '再' })
        ],
        { ...scores(30, 20, 20), total: 70, grade: '' }
      )
    )

    add(
      '建立 6 人、5 份作品',
      true,
      'S07／S08／S12／S15 done、S20 grading、S21 未匯入'
    )

    const stats = await getAssignmentStats(created.id, assignment.id)
    const summary = stats.summary

    add(
      '統計範圍只用已批作品',
      summary.students === 6 &&
        summary.imported === 5 &&
        summary.done === 4 &&
        summary.notDone === 1 &&
        summary.missing === 1,
      `在學 6、匯入 5、已批 4、未完成 1、未匯入 1`
    )

    add(
      '分數摘要',
      summary.average === 81 &&
        summary.median === 82 &&
        summary.high === 90 &&
        summary.low === 70 &&
        summary.grades.map((item) => `${item.label}:${item.count}`).join('、') ===
          'A++:1、A+:1、B++:1、B+:1',
      `平均 ${summary.average}、中位 ${summary.median}、最高 ${summary.high}、最低 ${summary.low}`
    )

    const item = (id: string) => summary.items.find((entry) => entry.id === id)
    add(
      '分項平均',
      item('content')?.average === 33 &&
        item('structure')?.average === 24.3 &&
        item('language')?.average === 24.3 &&
        item('content')?.percent === 82.5,
      `內容 ${item('content')?.average}/40、結構 ${item('structure')?.average}/30、語言 ${item('language')?.average}/30`
    )

    const weakness = (key: string) => stats.weaknesses.find((entry) => entry.key === key)
    const totalWeakness = stats.weaknesses.reduce((sum, entry) => sum + entry.count, 0)
    add(
      'G1 弱項排行',
      totalWeakness === 13 &&
        stats.weaknesses[0]?.key === 'typo:general' &&
        stats.weaknesses[0]?.count === 5 &&
        stats.weaknesses[0]?.students === 3 &&
        Math.abs((stats.weaknesses[0]?.share ?? 0) - 5 / 13) < 1e-9 &&
        weakness('sentence:word_choice')?.count === 2 &&
        weakness('sentence:redundant')?.count === 2 &&
        weakness('structure:transition')?.count === 2 &&
        weakness('sentence:cohesion')?.count === 1 &&
        weakness('structure:off_topic')?.count === 1,
      `共 ${totalWeakness} 個弱項批注，第一項 ${stats.weaknesses[0]?.label} ${stats.weaknesses[0]?.count}`
    )

    add(
      'G1 類別合計',
      stats.categories.find((entry) => entry.key === 'typo')?.count === 5 &&
        stats.categories.find((entry) => entry.key === 'sentence')?.count === 5 &&
        stats.categories.find((entry) => entry.key === 'structure')?.count === 3,
      stats.categories.map((entry) => `${entry.label} ${entry.count}`).join('、')
    )

    const typoRow = (wrong: string, correct: string) =>
      stats.typos.find((entry) => entry.wrong === wrong && entry.correct === correct)
    add(
      'G2 常錯字',
      stats.typos.length === 3 &&
        typoRow('在', '再')?.count === 3 &&
        typoRow('在', '再')?.students === 2 &&
        typoRow('在', '再')?.seats.join('、') === '07、08' &&
        typoRow('的', '得')?.count === 1 &&
        typoRow('已', '以')?.count === 1,
      stats.typos.map((entry) => `${entry.wrong}→${entry.correct}×${entry.count}`).join('、')
    )

    const student = (seat: string) => stats.students.find((row) => row.seat === seat)
    add(
      'G3 個人前三弱項',
      student('07')?.weaknesses.map((entry) => `${entry.label}:${entry.count}`).join('、') ===
        '錯字:3、用詞:2、轉折不足:1' &&
        student('08')?.weaknesses.map((entry) => `${entry.label}:${entry.count}`).join('、') ===
          '冗贅:2、錯字:1、離題:1' &&
        student('12')?.weaknesses.length === 3 &&
        student('15')?.weaknesses.length === 0,
      `S07 ${student('07')?.weaknesses.map((entry) => entry.label).join('、')}`
    )

    add(
      '未完成與未匯入不計入',
      student('20')?.counted === false &&
        student('20')?.weaknesses.length === 0 &&
        student('20')?.counts.typo === 5 &&
        student('21')?.status === 'missing' &&
        student('21')?.imported === false,
      `S20 批閱中、5 個錯字但不計入；S21 未匯入`
    )

    // ---- CSV -------------------------------------------------------------
    const exported = await exportAssignmentStats(created.id, assignment.id)
    const csvDir = join(assignmentDir, '_stats')
    add(
      '匯出四個 CSV',
      exported.dir === csvDir &&
        exported.files.join('、') ===
          'scores.csv、weakness-ranking.csv、common-typos.csv、student-weakness.csv',
      exported.files.join('、')
    )

    const scoresCsv = await readFile(join(csvDir, 'scores.csv'), 'utf8')
    const typoCsv = await readFile(join(csvDir, 'common-typos.csv'), 'utf8')
    const weaknessCsv = await readFile(join(csvDir, 'weakness-ranking.csv'), 'utf8')
    const personalCsv = await readFile(join(csvDir, 'student-weakness.csv'), 'utf8')
    const scoresStat = await stat(join(csvDir, 'scores.csv'))

    add(
      'CSV 編碼與表頭',
      scoresCsv.startsWith('\uFEFF') &&
        scoresCsv.includes('座號,姓名,狀態,計入統計,總分,等第') &&
        scoresCsv.includes('內容與思想') &&
        scoresStat.size > 200,
      `BOM、CRLF、${scoresStat.size} bytes`
    )

    add(
      'CSV 含逗號姓名正確轉義',
      scoresCsv.includes('"陳,大華"') &&
        scoresCsv.split('\r\n').filter((line) => line.length > 0).length === 7,
      '陳,大華 加引號；6 位學生＋表頭'
    )

    add(
      'CSV 未完成與未匯入狀態',
      scoresCsv.includes('批閱中,否') &&
        scoresCsv.includes('未匯入,否') &&
        personalCsv.includes('李大同,批閱中') &&
        personalCsv.includes('吳小安,未匯入'),
      'S20 批閱中、S21 未匯入，皆標不計入'
    )

    add(
      'CSV 統計內容',
      typoCsv.includes('在,再,3,2,07、08') &&
        weaknessCsv.includes('錯字,,5,38.5%,3') &&
        personalCsv.includes('錯字 3、用詞 2、轉折不足 1'),
      '常錯字、弱項排行與個人弱項一致'
    )

    // ---- UI --------------------------------------------------------------
    const ui = await runUiSmoke()
    add('統計 UI（按鈕、面板、資料、匯出）', ui.ok, ui.detail)

    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已經關閉或從未開啟
    }
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[m6] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
