import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  feedbackExportFileName,
  feedbackPdfFileName,
  sanitizeFileName,
  type Annotation,
  type WorkFile
} from '@essay-grader/core'
import {
  closeDatabase,
  createAssignment,
  createClass,
  openDatabase,
  saveClass,
  saveWork
} from './repository'
import { buildFeedback, exportFeedbackPdf, openFeedbackPreview } from '../feedback/service'

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
const LONG_COMMENT =
  '取材真切，母親的形象清楚，能從生活細節寫出情感。文中詞語使用正確，可見平日閱讀累積。若能多寫一個具體事件，並在結尾收回前文的伏筆，情感會更有層次。整體結構完整，段落之間略缺過渡，建議下次先列出事件順序再下筆。'

function annotation(
  index: number,
  category: Annotation['category'],
  text: string,
  meta?: Annotation['meta']
): Annotation {
  return {
    id: `a-${String(index).padStart(2, '0')}`,
    page_id: 'p1',
    anchor: { x: 0.05 + (index % 80) * 0.01, y: 0.2 },
    category,
    text,
    ...(meta ? { meta } : {}),
    created_at: now()
  }
}

function baseWork(
  classId: string,
  assignmentId: string,
  seat: string,
  status: WorkFile['status'],
  annotations: Annotation[],
  finalText: string
): WorkFile {
  return {
    schema_version: 1,
    class_id: classId,
    assignment_id: assignmentId,
    seat,
    name: seat === '07' ? '王小明' : `學生${seat}`,
    status,
    pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
    annotations,
    scores: {
      items: { content: 32, structure: 24, language: 25 },
      deduction: { typo: 2, punct: 0, override: null },
      total: 79,
      grade: 'B++'
    },
    final_comment: { text: finalText },
    updated_at: '2026-11-19T10:30:00.000Z'
  }
}

function feedbackRenderWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 900,
    height: 1320,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
}

async function waitForText(
  win: BrowserWindow,
  expression: string,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now()
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
}

/** 主畫面應出現「回饋單」按鈕，且只有已批作品才有。 */
async function runMainSmoke(): Promise<{ ok: boolean; detail: string }> {
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

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const ready = await waitForText(
      win,
      "document.body.innerText.includes('作文批閱') && !document.body.innerText.includes('載入中')",
      6000
    )
    if (!ready) return { ok: false, detail: '主畫面未渲染' }

    const hasApi = (await win.webContents.executeJavaScript(
      `Boolean(
        window.electronAPI &&
        window.electronAPI.feedback &&
        typeof window.electronAPI.feedback.load === 'function' &&
        typeof window.electronAPI.feedback.open === 'function' &&
        typeof window.electronAPI.feedback.exportPdf === 'function' &&
        typeof window.electronAPI.feedback.saveAs === 'function' &&
        typeof window.electronAPI.feedback.print === 'function'
      )`
    )) as boolean
    if (!hasApi) return { ok: false, detail: 'preload 缺少 feedback API' }

    const assignmentReady = await waitForText(win, "document.querySelector('.assignment-row')", 6000)
    if (!assignmentReady) return { ok: false, detail: '找不到作業列' }
    await win.webContents.executeJavaScript(
      "document.querySelector('.assignment-row')?.click()"
    )

    const panelReady = await waitForText(win, "document.querySelector('.import-panel')", 6000)
    if (!panelReady) return { ok: false, detail: '匯入佇列未出現' }

    const rowReady = await waitForText(
      win,
      "[...document.querySelectorAll('.import-panel .table tbody tr')].some((tr) => tr.querySelector('td.mono')?.textContent?.trim() === '07')",
      6000
    )
    if (!rowReady) return { ok: false, detail: '找不到 S07 作品列' }

    const labels = (await win.webContents.executeJavaScript(
      `(() => {
        const rowOf = (seat) => [...document.querySelectorAll('.import-panel .table tbody tr')]
          .find((tr) => tr.querySelector('td.mono')?.textContent?.trim() === seat)
        const labelsOf = (seat) => rowOf(seat)
          ? [...rowOf(seat).querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')
          : []
        return { done: labelsOf('07'), grading: labelsOf('09') }
      })()`
    )) as { done: string[]; grading: string[] }

    const ok = labels.done.includes('回饋單') && !labels.grading.includes('回饋單')
    return {
      ok,
      detail: `S07 按鈕 ${labels.done.join('／') || '—'}；S09 按鈕 ${
        labels.grading.join('／') || '—'
      }`
    }
  } finally {
    win.destroy()
  }
}

/** 直接載入回饋單頁，確認資料、版面密度與工具列。 */
async function runFeedbackPageSmoke(
  classId: string,
  assignmentId: string
): Promise<{ ok: boolean; detail: string }> {
  const win = feedbackRenderWindow()

  try {
    await win.loadFile(join(__dirname, '../renderer/feedback.html'), {
      query: { classId, assignmentId, seat: '07' }
    })

    const ready = await waitForText(win, 'window.__feedbackReady === true', 10_000)
    if (!ready) return { ok: false, detail: '回饋單未完成排版' }

    const info = (await win.webContents.executeJavaScript(
      `(() => {
        const sheet = document.querySelector('.sheet')
        return {
          text: document.body.innerText,
          density: sheet ? sheet.dataset.density ?? '' : '',
          overflow: Boolean(window.__feedbackOverflow),
          hasToolbar: Boolean(document.querySelector('.toolbar')),
          hasPrint: Boolean(document.querySelector('.toolbar-actions button'))
        }
      })()`
    )) as {
      text: string
      density: string
      overflow: boolean
      hasToolbar: boolean
      hasPrint: boolean
    }

    const previewPath = join(app.getAppPath(), '..', '..', 'spike-out', 'm5-preview.png')
    // 螢幕高度可能不足 A4，縮小後再截圖，方便人工檢視整頁。
    win.webContents.setZoomFactor(0.68)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const image = await win.webContents.capturePage()
    await writeFile(previewPath, image.toPNG())

    const ok =
      info.text.includes('作文回饋單') &&
      info.text.includes('王小明') &&
      info.text.includes(TITLE) &&
      info.text.includes('79') &&
      info.text.includes('B++') &&
      info.text.includes('在') &&
      info.text.includes('再') &&
      ['normal', 'compact', 'tiny'].includes(info.density) &&
      !info.overflow &&
      info.hasToolbar &&
      info.hasPrint

    return {
      ok,
      detail: `密度 ${info.density}、溢頁 ${info.overflow ? '是' : '否'}、工具列 ${
        info.hasToolbar ? '有' : '無'
      }、預覽圖 spike-out/m5-preview.png`
    }
  } finally {
    win.destroy()
  }
}

/** 預覽視窗實際開一次：同一份再次開啟應重用同一個視窗。 */
async function runPreviewWindowCheck(
  classId: string,
  assignmentId: string
): Promise<{ ok: boolean; detail: string }> {
  const before = new Set(BrowserWindow.getAllWindows().map((win) => win.id))
  await openFeedbackPreview(classId, assignmentId, '07', { show: false })

  let preview: BrowserWindow | undefined
  const started = Date.now()
  while (Date.now() - started < 8000) {
    preview = BrowserWindow.getAllWindows().find((win) => !before.has(win.id))
    if (preview) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  if (!preview) return { ok: false, detail: '沒有建立回饋單視窗' }

  try {
    const ready = await waitForText(preview, 'window.__feedbackReady === true', 10_000)
    const title = (await preview.webContents.executeJavaScript(
      "document.querySelector('.toolbar-title strong')?.textContent ?? ''"
    )) as string

    const firstId = preview.id
    await openFeedbackPreview(classId, assignmentId, '07', { show: false })
    const sameWindow =
      BrowserWindow.getAllWindows().find((win) => !before.has(win.id))?.id === firstId

    return {
      ok: ready && title === '回饋單預覽' && sameWindow,
      detail: `視窗 ${firstId}、標題「${title || '—'}」、重複開啟重用 ${
        sameWindow ? '是' : '否'
      }`
    }
  } finally {
    if (!preview.isDestroyed()) preview.destroy()
  }
}

/** `--m5-check`：回饋單資料、檔名、單頁 PDF、溢頁阻擋與 UI 煙霧。 */
export async function runM5Check(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const assets = join(repoRoot, 'spike-out', 'm5-assets')
  const root = join(repoRoot, 'spike-out', 'm5-db')

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
        { seat: '08', name: '陳大華', active: true },
        { seat: '09', name: '林小美', active: true }
      ]
    })

    const assignment = await createAssignment({
      classId: created.id,
      title: TITLE,
      prompt: '',
      rubricPreset: 'balanced'
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

    const assignmentDir = join(root, created.id, assignment.id)
    for (const seat of ['07', '08', '09']) {
      const dir = join(assignmentDir, `S${seat}`)
      await mkdir(dir, { recursive: true })
      await copyFile(template, join(dir, 'p1.jpg'))
    }

    const annotations: Annotation[] = [
      annotation(1, 'typo', '在再不分', { wrong: '在', correct: '再' }),
      annotation(2, 'typo', '在再不分', { wrong: '在', correct: '再' }),
      annotation(3, 'typo', '的得不分', { wrong: '的', correct: '得' }),
      annotation(4, 'typo', '未填結構化欄位'),
      annotation(5, 'sentence', '語句冗贅', {
        original: '我因為下雨的關係所以沒有去學校。',
        revised: '因為下雨，我沒有去學校。',
        reason: '刪去冗贅的因果連接詞'
      }),
      annotation(6, 'sentence', '補上主語', {
        original: '',
        revised: '她總是把最好的東西留給我們。',
        reason: '省略主語會造成指涉不明'
      }),
      annotation(7, 'sentence', '只寫評語沒有改寫'),
      annotation(8, 'praise', '「母親的手像一張舊地圖。」— 比喻新鮮。'),
      annotation(9, 'praise', '「雨停時，她把整個下午收進口袋。」— 動作與情緒扣合。'),
      annotation(10, 'structure', '段落之間略缺過渡。')
    ]

    await saveWork(
      created.id,
      assignment.id,
      '07',
      baseWork(created.id, assignment.id, '07', 'done', annotations, LONG_COMMENT)
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
    await saveWork(
      created.id,
      assignment.id,
      '08',
      baseWork(created.id, assignment.id, '08', 'done', extremeAnnotations, extremeComment)
    )

    await saveWork(
      created.id,
      assignment.id,
      '09',
      baseWork(created.id, assignment.id, '09', 'grading', [], LONG_COMMENT)
    )
    add('建立 1 班、1 份作業、3 份作品', true, `S07 done、S08 超長內容、S09 grading`)

    // ---- 回饋單資料 ------------------------------------------------------
    const sheet = await buildFeedback(created.id, assignment.id, '07')
    add(
      '基本資料與分數快照',
      sheet.className === CLASS_NAME &&
        sheet.teacher === TEACHER &&
        sheet.seat === '07' &&
        sheet.name === '王小明' &&
        sheet.title === TITLE &&
        sheet.gradedAt === '2026-11-19' &&
        sheet.score.itemsTotal === 81 &&
        sheet.score.total === 79 &&
        sheet.score.grade === 'B++' &&
        sheet.score.items.length === 3,
      `${sheet.className}／${sheet.title}／S${sheet.seat} ${sheet.name}；${sheet.score.itemsTotal} 扣 ${sheet.score.deduction} = ${sheet.score.total} ${sheet.score.grade ?? ''}`
    )

    const typoRow = (wrong: string, correct: string) =>
      sheet.typos.find((item) => item.wrong === wrong && item.correct === correct)
    add(
      '錯字聚合與排序',
      sheet.typos.length === 2 &&
        typoRow('在', '再')?.count === 2 &&
        typoRow('的', '得')?.count === 1 &&
        sheet.typos[0]?.wrong === '在' &&
        sheet.counts.typos === 4,
      sheet.typos.map((item) => `${item.wrong}→${item.correct}×${item.count}`).join('、')
    )

    add(
      '詞句改寫只收有 revised 的',
      sheet.rewrites.length === 2 &&
        sheet.rewrites[0]?.revised === '因為下雨，我沒有去學校。' &&
        sheet.rewrites[0]?.reason === '刪去冗贅的因果連接詞' &&
        sheet.rewrites[1]?.original === '',
      sheet.rewrites.map((item) => `${item.original || '（空）'}→${item.revised}`).join('；')
    )

    add(
      '佳句與批注統計',
      sheet.praises.length === 2 &&
        sheet.counts.sentences === 3 &&
        sheet.counts.structures === 1 &&
        sheet.counts.praises === 2 &&
        !sheet.truncated.typos &&
        !sheet.truncated.rewrites,
      `佳句 ${sheet.praises.length}、語句 ${sheet.counts.sentences}、結構 ${sheet.counts.structures}`
    )

    add(
      '總評完整保留',
      sheet.comment === LONG_COMMENT,
      `${sheet.comment.length} 字`
    )

    // ---- 檔名規則 --------------------------------------------------------
    add(
      '固定 PDF 檔名',
      feedbackPdfFileName('07') === 'S07_feedback.pdf',
      feedbackPdfFileName('07')
    )

    add(
      'Windows 非法字元清洗',
      sanitizeFileName('我的母親：段考/作文') === '我的母親：段考_作文' &&
        sanitizeFileName('a<>:"/\\|?*b') === 'a_b' &&
        sanitizeFileName('  多   空白  ') === '多 空白' &&
        sanitizeFileName('...') === '未命名',
      `slash→「${sanitizeFileName('a/b')}」、空白→「${sanitizeFileName('  多   空白  ')}」`
    )

    const exportName = feedbackExportFileName({
      className: CLASS_NAME,
      title: '我的母親：段考/作文',
      seat: '07',
      name: '王小明',
      gradedAt: '2026-11-19T10:30:00.000Z'
    })
    add(
      '另存中文檔名',
      exportName === '高中302_我的母親：段考_作文_S07_王小明_回饋單_2026-11-19.pdf',
      exportName
    )

    // ---- 單份 PDF --------------------------------------------------------
    const pdf = await exportFeedbackPdf(created.id, assignment.id, '07')
    const pdfPath = join(assignmentDir, 'S07', feedbackPdfFileName('07'))
    const pdfStat = await stat(pdfPath)
    const pdfRaw = (await readFile(pdfPath)).toString('latin1')
    add(
      '單份 PDF：一頁、檔名、位置',
      pdf.pages === 1 &&
        pdf.bytes > 20_000 &&
        pdf.path === pdfPath &&
        pdf.fileName === 'S07_feedback.pdf' &&
        pdfStat.size === pdf.bytes,
      `${pdf.fileName}、${pdf.pages} 頁、${Math.round(pdf.bytes / 1024)} KB、${pdf.ms} ms`
    )

    add(
      'PDF 內容與中文字型',
      pdfRaw.startsWith('%PDF') &&
        pdfRaw.includes('/Font') &&
        pdfRaw.includes('JhengHei'),
      '檔頭 %PDF、內嵌 JhengHei 子集'
    )

    const savePath = join(assets, '另存_王小明_回饋單.pdf')
    const saved = await exportFeedbackPdf(created.id, assignment.id, '07', savePath)
    const savedStat = await stat(savePath)
    add(
      '另存到指定路徑',
      saved.path === savePath && saved.pages === 1 && savedStat.size === saved.bytes,
      `${saved.path}（${Math.round(saved.bytes / 1024)} KB）`
    )

    // ---- 溢頁與未完成阻擋 ------------------------------------------------
    let overflowError = ''
    try {
      await exportFeedbackPdf(created.id, assignment.id, '08')
    } catch (error) {
      overflowError = message(error)
    }
    add(
      '內容超過一頁時阻擋匯出',
      overflowError.includes('超過一頁'),
      overflowError || '未擋下'
    )

    let incompleteError = ''
    try {
      await exportFeedbackPdf(created.id, assignment.id, '09')
    } catch (error) {
      incompleteError = message(error)
    }
    add(
      '未完成批閱不可匯出',
      incompleteError.includes('尚未完成批閱'),
      incompleteError || '未擋下'
    )

    // ---- UI 煙霧 --------------------------------------------------------
    const mainSmoke = await runMainSmoke()
    add('主畫面：僅已批作品有「回饋單」', mainSmoke.ok, mainSmoke.detail)

    const pageSmoke = await runFeedbackPageSmoke(created.id, assignment.id)
    add('回饋單頁：資料、密度、工具列', pageSmoke.ok, pageSmoke.detail)

    const previewSmoke = await runPreviewWindowCheck(created.id, assignment.id)
    add('預覽視窗可開啟且重複使用', previewSmoke.ok, previewSmoke.detail)

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
    `[m5] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
