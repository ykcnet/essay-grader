import { app, BrowserWindow } from 'electron'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  feedbackPdfFileName,
  sanitizeFileName,
  type Annotation,
  type WorkFile
} from '@essay-grader/core'
import {
  closeDatabase,
  createAssignment,
  createClass,
  listWorks,
  openDatabase,
  saveClass,
  saveWork
} from '../data/repository'
import {
  getBatchFeedbackInfo,
  startBatchFeedback,
  type BatchFeedbackProgress,
  type BatchFeedbackReport
} from './batch'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const CLASS_NAME = '高中302'
const TEACHER = '王老師'
const TITLE = '我的母親'
const LONG_COMMENT =
  '取材真切，母親的形象清楚，能從生活細節寫出情感。文中詞語使用正確，可見平日閱讀累積。若能多寫一個具體事件，並在結尾收回前文的伏筆，情感會更有層次。整體結構完整，段落之間略缺過渡，建議下次先列出事件順序再下筆。'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function countPdfPages(pdf: Buffer): number {
  const raw = pdf.toString('latin1')
  return (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

function annotation(
  index: number,
  category: Annotation['category'],
  text: string,
  meta?: Annotation['meta']
): Annotation {
  return {
    id: `a-${String(index).padStart(3, '0')}`,
    page_id: 'p1',
    anchor: { x: 0.05 + (index % 80) * 0.01, y: 0.2 },
    category,
    text,
    ...(meta ? { meta } : {}),
    created_at: new Date().toISOString()
  }
}

function normalAnnotations(): Annotation[] {
  return [
    annotation(1, 'typo', '在再不分', { wrong: '在', correct: '再' }),
    annotation(2, 'typo', '的得不分', { wrong: '的', correct: '得' }),
    annotation(3, 'sentence', '語句冗贅', {
      original: '我因為下雨的關係所以沒有去學校。',
      revised: '因為下雨，我沒有去學校。',
      reason: '刪去冗贅的因果連接詞'
    }),
    annotation(4, 'praise', '「母親的手像一張舊地圖。」— 比喻新鮮。'),
    annotation(5, 'structure', '段落之間略缺過渡。')
  ]
}

function baseWork(
  classId: string,
  assignmentId: string,
  seat: string,
  name: string,
  status: WorkFile['status'],
  annotations: Annotation[],
  finalText: string,
  withScores = true
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
    ...(withScores
      ? {
          scores: {
            items: { content: 32, structure: 24, language: 25 },
            deduction: { typo: 2, punct: 0, override: null },
            total: 79,
            grade: 'B++'
          }
        }
      : {}),
    final_comment: { text: finalText },
    updated_at: '2026-11-19T10:30:00.000Z'
  }
}

async function waitForWindow(
  win: BrowserWindow,
  expression: string,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const ok = (await win.webContents.executeJavaScript(
        `Boolean(${expression})`
      )) as boolean
      if (ok) return true
    } catch {
      // 頁面還在下載
    }
    await delay(120)
  }
  return false
}

async function runUiSmoke(
  assignmentId: string,
  emptyAssignmentId: string
): Promise<{ ok: boolean; detail: string }> {
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

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const ready = await waitForWindow(
      win,
      "document.body.innerText.includes('作文批閱') && document.querySelectorAll('.assignment-row').length > 0",
      10000
    )
    if (!ready) return { ok: false, detail: '主畫面或作業列表未渲染' }

    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const row = [...document.querySelectorAll('.assignment-row')].find(
          (item) => item.textContent?.includes(${JSON.stringify(assignmentId)})
        )
        if (!row) return false
        row.click()
        return true
      })()`
    )) as boolean
    if (!clicked) return { ok: false, detail: '找不到目標作業列' }

    const toggleReady = await waitForWindow(
      win,
      "document.querySelector('.batch-feedback-toggle') !== null",
      10000
    )
    if (!toggleReady) return { ok: false, detail: '找不到「批次回饋單」按鈕' }

    await win.webContents.executeJavaScript(
      `document.querySelector('.batch-feedback-toggle').click()`
    )

    const panelReady = await waitForWindow(
      win,
      "document.querySelector('.batch-feedback-panel') !== null",
      10000
    )
    const infoReady = await waitForWindow(
      win,
      "document.querySelector('.batch-feedback-info')?.textContent?.includes('已批 4 份') === true",
      10000
    )
    const controls = (await win.webContents.executeJavaScript(
      `(() => {
        const start = document.querySelector('.batch-start')
        const cancel = document.querySelector('.batch-cancel')
        const reveal = document.querySelector('.batch-reveal')
        return {
          start: Boolean(start) && !start.disabled,
          cancel: Boolean(cancel),
          reveal: Boolean(reveal),
          progress: Boolean(document.querySelector('.batch-progress-bar')),
          output: document.querySelector('.batch-output')?.textContent?.includes('_feedback') === true,
          thresholds:
            document.querySelector('.batch-feedback-info')?.textContent?.includes('未完成 1 份') === true
        }
      })()`
    )) as {
      start: boolean
      cancel: boolean
      reveal: boolean
      progress: boolean
      output: boolean
      thresholds: boolean
    }

    const apiReady = (await win.webContents.executeJavaScript(
      `Boolean(
        window.electronAPI &&
        typeof window.electronAPI.feedback?.batchInfo === 'function' &&
        typeof window.electronAPI.feedback?.batchStart === 'function' &&
        typeof window.electronAPI.feedback?.batchCancel === 'function' &&
        typeof window.electronAPI.feedback?.batchReveal === 'function' &&
        typeof window.electronAPI.feedback?.onBatchProgress === 'function'
      )`
    )) as boolean

    const emptyClicked = (await win.webContents.executeJavaScript(
      `(() => {
        const row = [...document.querySelectorAll('.assignment-row')].find(
          (item) => item.textContent?.includes(${JSON.stringify(emptyAssignmentId)})
        )
        if (!row) return false
        row.click()
        return true
      })()`
    )) as boolean
    const emptyReady =
      emptyClicked &&
      (await waitForWindow(
        win,
        "document.querySelector('.batch-feedback-panel') !== null && document.querySelector('.batch-start')?.disabled === true",
        10000
      ))

    const ok =
      panelReady &&
      infoReady &&
      controls.start &&
      controls.cancel &&
      controls.reveal &&
      controls.progress &&
      controls.output &&
      controls.thresholds &&
      apiReady &&
      emptyReady

    // 等面板最後一次資訊查詢完成，避免關閉視窗後才落到關閉中的資料庫。
    await delay(500)

    return {
      ok,
      detail: `面板 ${panelReady ? '是' : '否'}、資訊 ${infoReady ? '是' : '否'}、開始 ${controls.start ? '是' : '否'}、取消 ${controls.cancel ? '是' : '否'}、開啟資料夾 ${controls.reveal ? '是' : '否'}、進度條 ${controls.progress ? '是' : '否'}、空狀態停用 ${emptyReady ? '是' : '否'}、preload API ${apiReady ? '是' : '否'}`
    }
  } finally {
    win.destroy()
  }
}

/** `--batch-check`：整班批次回饋單的輸出、跳過、失敗、報告、取消與 UI。 */
export async function runBatchCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'batch-check')
  const dbRoot = join(work, 'db')
  const assets = join(work, 'assets')
  const userData = join(work, 'userData')

  await rm(work, { recursive: true, force: true })
  await mkdir(dbRoot, { recursive: true })
  await mkdir(assets, { recursive: true })
  await mkdir(userData, { recursive: true })
  app.setPath('userData', userData)

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
      '08': '陳怡君',
      '09': '林/小:美?',
      '10': '張志豪',
      '11': '李大同'
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

    const main = await createAssignment({
      classId: created.id,
      title: TITLE,
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-19T00:00:00.000Z'
    })
    const cancel = await createAssignment({
      classId: created.id,
      title: '取消測試',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-18T00:00:00.000Z'
    })
    const duplicate = await createAssignment({
      classId: created.id,
      title: '重複啟動測試',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-17T00:00:00.000Z'
    })
    const empty = await createAssignment({
      classId: created.id,
      title: '空作業',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-16T00:00:00.000Z'
    })

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

    const preparePage = async (assignmentId: string, seat: string): Promise<void> => {
      const dir = join(dbRoot, created.id, assignmentId, `S${seat}`)
      await mkdir(dir, { recursive: true })
      await copyFile(template, join(dir, 'p1.jpg'))
    }

    const normal = normalAnnotations()
    for (const seat of ['07', '08', '09']) {
      await preparePage(main.id, seat)
      await saveWork(
        created.id,
        main.id,
        seat,
        baseWork(
          created.id,
          main.id,
          seat,
          names[seat]!,
          'done',
          normal,
          LONG_COMMENT
        )
      )
    }

    await preparePage(main.id, '10')
    await saveWork(
      created.id,
      main.id,
      '10',
      baseWork(created.id, main.id, '10', names['10']!, 'grading', [], LONG_COMMENT)
    )

    const extremeComment = '這是一段很長的總評，用來驗證一頁溢出時的阻擋。'.repeat(400)
    const extremeAnnotations: Annotation[] = [
      ...Array.from({ length: 30 }, (_, index) =>
        annotation(100 + index, 'typo', '錯字', {
          wrong: `錯${index}`,
          correct: `正${index}`
        })
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        annotation(200 + index, 'sentence', '語句', {
          original: `第 ${index} 個原句`,
          revised: `第 ${index} 個建議`,
          reason: '測試用'
        })
      )
    ]
    await preparePage(main.id, '11')
    await saveWork(
      created.id,
      main.id,
      '11',
      baseWork(
        created.id,
        main.id,
        '11',
        names['11']!,
        'done',
        extremeAnnotations,
        extremeComment
      )
    )
    add(
      '建立 5 位學生與測試作業',
      true,
      `主作業 S07／S08／S09 done、S10 grading、S11 done 但總評超長；另建取消、重複啟動與空作業`
    )

    const mainInfo = await getBatchFeedbackInfo(created.id, main.id)
    add(
      '批次資訊：已批與未完成份數',
      mainInfo.exportable === 4 &&
        mainInfo.unfinished === 1 &&
        mainInfo.total === 5 &&
        mainInfo.outputDir.endsWith('_feedback'),
      `已批 ${mainInfo.exportable}、未完成 ${mainInfo.unfinished}、共 ${mainInfo.total}`
    )

    // ---- 主批次 ----------------------------------------------------------
    const progressList: BatchFeedbackProgress[] = []
    const report = await startBatchFeedback({
      classId: created.id,
      assignmentId: main.id,
      onProgress: (progress) => progressList.push(progress)
    })

    add(
      '批次統計：3 輸出、1 跳過、1 失敗',
      report.total === 5 &&
        report.exported === 3 &&
        report.skipped === 1 &&
        report.failed === 1 &&
        report.cancelled === 0 &&
        report.items.length === 5,
      `total=${report.total}、exported=${report.exported}、skipped=${report.skipped}、failed=${report.failed}`
    )

    const itemOf = (seat: string): BatchFeedbackReport['items'][number] | undefined =>
      report.items.find((item) => item.seat === seat)
    add(
      '跳過與失敗原因明確',
      itemOf('10')?.status === 'skipped' &&
        itemOf('10')?.reason.includes('批閱中') === true &&
        itemOf('11')?.status === 'failed' &&
        itemOf('11')?.reason.includes('超過一頁') === true &&
        itemOf('07')?.status === 'exported' &&
        itemOf('07')?.reason === '',
      `S10 ${itemOf('10')?.status}／${itemOf('10')?.reason ?? ''}；S11 ${itemOf('11')?.status}／${itemOf('11')?.reason ?? ''}`
    )

    const progressOk =
      progressList.length === 5 &&
      progressList.every(
        (progress, index) =>
          progress.index === index + 1 &&
          progress.total === 5 &&
          progress.completed === index + 1 &&
          progress.jobId === report.jobId &&
          progress.classId === created.id &&
          progress.assignmentId === main.id
      ) &&
      progressList.map((progress) => progress.seat).join(',') === '07,08,09,10,11' &&
      progressList.map((progress) => progress.status).join(',') ===
        'exported,exported,exported,skipped,failed'
    add(
      '進度 callback 的 index／total／status 順序',
      progressOk,
      progressList
        .map((progress) => `${progress.index}/${progress.total}:${progress.seat}:${progress.status}`)
        .join('、')
    )

    const assignmentDir = join(dbRoot, created.id, main.id)
    const pdfChecks = await Promise.all(
      ['07', '08', '09'].map(async (seat) => {
        const path = join(assignmentDir, `S${seat}`, feedbackPdfFileName(seat))
        if (!(await exists(path))) return { seat, ok: false, detail: '不存在' }
        const buffer = await readFile(path)
        return {
          seat,
          ok: buffer.length > 20_000 && countPdfPages(buffer) === 1,
          detail: `${countPdfPages(buffer)} 頁、${Math.round(buffer.length / 1024)} KB`
        }
      })
    )
    add(
      '3 份 canonical PDF 存在、1 頁、大於 20 KB',
      pdfChecks.every((item) => item.ok),
      pdfChecks.map((item) => `S${item.seat} ${item.detail}`).join('；')
    )
    add(
      '未完成與溢頁作品不產生 canonical PDF',
      !(await exists(join(assignmentDir, 'S10', feedbackPdfFileName('10')))) &&
        !(await exists(join(assignmentDir, 'S11', feedbackPdfFileName('11')))),
      'S10、S11 皆無 S*_feedback.pdf'
    )

    const feedbackDir = join(assignmentDir, '_feedback')
    const feedbackFiles = await readdir(feedbackDir)
    const pdfFiles = feedbackFiles.filter((file) => file.toLowerCase().endsWith('.pdf'))
    const expectedName = (seat: string): string => {
      const raw = names[seat]!.trim()
      return `S${seat}_${sanitizeFileName(raw)}_回饋單.pdf`
    }
    const chineseNamesOk =
      pdfFiles.length === 3 &&
      ['07', '08', '09'].every((seat) => pdfFiles.includes(expectedName(seat))) &&
      expectedName('09').includes('_林_小_美_')
    add(
      '`_feedback/` 三份中文檔名 PDF 與清洗結果',
      chineseNamesOk,
      pdfFiles.sort().join('、')
    )

    const reportJson = JSON.parse(
      await readFile(join(feedbackDir, 'report.json'), 'utf8')
    ) as BatchFeedbackReport
    const reportCsvBuffer = await readFile(join(feedbackDir, 'report.csv'))
    const reportCsv = reportCsvBuffer.toString('utf8')
    const csvLines = reportCsv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')
    const csvBom =
      reportCsvBuffer[0] === 0xef &&
      reportCsvBuffer[1] === 0xbb &&
      reportCsvBuffer[2] === 0xbf
    add(
      'report.json 與統計一致',
      reportJson.jobId === report.jobId &&
        reportJson.total === report.total &&
        reportJson.exported === report.exported &&
        reportJson.skipped === report.skipped &&
        reportJson.failed === report.failed &&
        reportJson.items.length === 5 &&
        reportJson.items.every(
          (item) =>
            typeof item.seat === 'string' &&
            typeof item.name === 'string' &&
            typeof item.status === 'string' &&
            typeof item.path === 'string' &&
            typeof item.reason === 'string' &&
            typeof item.ms === 'number'
        ) &&
        !Number.isNaN(Date.parse(reportJson.generatedAt)),
      `generatedAt=${reportJson.generatedAt}、items=${reportJson.items.length}`
    )
    add(
      'report.csv 有 BOM、CRLF 且內容一致',
      csvBom &&
        csvLines.length === 6 &&
        csvLines[0]!.startsWith('座號,姓名,狀態,檔名,輸出路徑,錯誤原因,耗時(ms)') &&
        csvLines.some((line) => line.startsWith('11,李大同,failed,')),
      `BOM ${csvBom ? '有' : '無'}、${csvLines.length} 列、${reportCsvBuffer.length} bytes`
    )

    // ---- 取消 ------------------------------------------------------------
    for (const seat of ['07', '08', '09']) {
      await preparePage(cancel.id, seat)
      await saveWork(
        created.id,
        cancel.id,
        seat,
        baseWork(
          created.id,
          cancel.id,
          seat,
          names[seat]!,
          'done',
          normal,
          LONG_COMMENT
        )
      )
    }

    let processed = 0
    const cancelReport = await startBatchFeedback({
      classId: created.id,
      assignmentId: cancel.id,
      onProgress: () => {
        processed += 1
      },
      shouldCancel: () => processed >= 1
    })
    const cancelDir = join(dbRoot, created.id, cancel.id)
    const cancelPdfs = (await readdir(join(cancelDir, '_feedback'))).filter((file) =>
      file.toLowerCase().endsWith('.pdf')
    )
    add(
      '取消：處理第 1 份後停止，其餘 cancelled',
      cancelReport.total === 3 &&
        cancelReport.exported === 1 &&
        cancelReport.cancelled === 2 &&
        cancelReport.failed === 0 &&
        cancelReport.items.map((item) => item.status).join(',') ===
          'exported,cancelled,cancelled' &&
        cancelReport.items[1]?.reason.includes('已取消'),
      cancelReport.items
        .map((item) => `${item.seat}:${item.status}`)
        .join('、')
    )
    add(
      '取消後不再產生後續 PDF',
      (await exists(join(cancelDir, 'S07', feedbackPdfFileName('07')))) &&
        !(await exists(join(cancelDir, 'S08', feedbackPdfFileName('08')))) &&
        !(await exists(join(cancelDir, 'S09', feedbackPdfFileName('09')))) &&
        cancelPdfs.length === 1,
      `_feedback PDF ${cancelPdfs.length} 份`
    )

    // ---- 重複啟動 --------------------------------------------------------
    for (const seat of ['07', '08']) {
      await preparePage(duplicate.id, seat)
      await saveWork(
        created.id,
        duplicate.id,
        seat,
        baseWork(
          created.id,
          duplicate.id,
          seat,
          names[seat]!,
          'done',
          normal,
          LONG_COMMENT
        )
      )
    }

    const first = startBatchFeedback({
      classId: created.id,
      assignmentId: duplicate.id
    })
    let duplicateError = ''
    try {
      await startBatchFeedback({
        classId: created.id,
        assignmentId: duplicate.id
      })
    } catch (error) {
      duplicateError = message(error)
    }
    const firstReport = await first
    add(
      '同一時間只允許一個批次',
      duplicateError.includes('已有批次回饋單正在進行') &&
        firstReport.exported === 2,
      duplicateError || '未拒絕重複啟動'
    )

    const works = await listWorks(created.id, main.id)
    add(
      '批次完成後作品狀態不變',
      works.map((item) => `${item.seat}:${item.status}`).join(',') ===
        '07:done,08:done,09:done,10:grading,11:done',
      works.map((item) => `${item.seat}:${item.status}`).join('、')
    )

    const ui = await runUiSmoke(main.id, empty.id)
    add('UI：批次按鈕、面板、進度條、控制項與 preload API', ui.ok, ui.detail)

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
    `[batch] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
