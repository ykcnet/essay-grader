import { app, BrowserWindow } from 'electron'
import { mkdir, open, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  buildFeedbackSheet,
  feedbackPdfFileName,
  type FeedbackSheet
} from '@essay-grader/core'
import {
  currentRoot,
  loadAssignment,
  loadClass,
  loadWork
} from '../data/repository'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']
const PRELOAD = join(__dirname, '../preload/index.js')
const FEEDBACK_HTML = join(__dirname, '../renderer/feedback.html')

const previewWindows = new Map<string, BrowserWindow>()

function keyOf(classId: string, assignmentId: string, seat: string): string {
  return `${classId}/${assignmentId}/${seat}`
}

/** 由資料庫組出回饋單；不寫入任何檔案。 */
export async function buildFeedback(
  classId: string,
  assignmentId: string,
  seat: string
): Promise<FeedbackSheet> {
  const [classResult, assignmentResult, work] = await Promise.all([
    loadClass(classId),
    loadAssignment(classId, assignmentId),
    loadWork(classId, assignmentId, seat)
  ])

  return buildFeedbackSheet({
    classFile: classResult.data,
    assignment: assignmentResult.data,
    work
  })
}

function createFeedbackWindow(
  classId: string,
  assignmentId: string,
  seat: string,
  show: boolean
): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 1000,
    minWidth: 760,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#e9edf2',
    title: `回饋單 · S${seat}`,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const key = keyOf(classId, assignmentId, seat)
  previewWindows.set(key, win)

  win.on('ready-to-show', () => {
    if (show) win.show()
  })
  win.on('closed', () => {
    if (previewWindows.get(key) === win) previewWindows.delete(key)
  })

  return win
}

async function loadFeedbackWindow(
  win: BrowserWindow,
  classId: string,
  assignmentId: string,
  seat: string
): Promise<void> {
  const query = new URLSearchParams({ classId, assignmentId, seat })
  if (DEV_URL) {
    await win.loadURL(`${DEV_URL}/feedback.html?${query.toString()}`)
  } else {
    await win.loadFile(FEEDBACK_HTML, {
      query: { classId, assignmentId, seat }
    })
  }
}

/** 開啟（或聚焦）單份回饋單預覽視窗；`show` 僅供自動驗收關閉顯示。 */
export async function openFeedbackPreview(
  classId: string,
  assignmentId: string,
  seat: string,
  options: { show?: boolean } = {}
): Promise<{ opened: boolean }> {
  const show = options.show !== false
  const key = keyOf(classId, assignmentId, seat)
  const existing = previewWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    if (show) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
    return { opened: true }
  }

  const win = createFeedbackWindow(classId, assignmentId, seat, show)
  try {
    await loadFeedbackWindow(win, classId, assignmentId, seat)
  } catch (error) {
    if (!win.isDestroyed()) win.destroy()
    throw error
  }
  return { opened: true }
}

interface RenderState {
  ready: boolean
  overflow: boolean
  failed: string
}

async function waitForRender(
  win: BrowserWindow,
  timeoutMs = 15_000
): Promise<RenderState> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const state = (await win.webContents.executeJavaScript(
        `({
          ready: Boolean(window.__feedbackReady),
          overflow: Boolean(window.__feedbackOverflow),
          failed: window.__feedbackFailed || ''
        })`
      )) as RenderState

      if (state.ready) return state
    } catch {
      // 頁面還在載入，稍後再試
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error('回饋單排版逾時，請稍後再試')
}

function countPdfPages(pdf: Buffer): number {
  // Chromium 產出的 PDF 物件字典未壓縮，可粗略計算頁數
  const raw = pdf.toString('latin1')
  return (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

async function writeFileAtomic(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmp, path)
}

export interface FeedbackPdfResult {
  path: string
  pages: number
  bytes: number
  ms: number
  fileName: string
}

/** 另存前先確認作品已完成，避免選完路徑才失敗。 */
export async function assertFeedbackExportable(
  classId: string,
  assignmentId: string,
  seat: string
): Promise<void> {
  const work = await loadWork(classId, assignmentId, seat)
  if (work.status !== 'done') {
    throw new Error('尚未完成批閱，無法產出回饋單')
  }
}

/**
 * 用隱藏視窗載入回饋單，量測是否溢出一頁，再 printToPDF。
 * 內容在最小字級仍放不下時直接擋下，不產生被裁切的 PDF。
 */
export async function exportFeedbackPdf(
  classId: string,
  assignmentId: string,
  seat: string,
  targetPath?: string
): Promise<FeedbackPdfResult> {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫')

  const work = await loadWork(classId, assignmentId, seat)
  if (work.status !== 'done') {
    throw new Error('尚未完成批閱，無法產出回饋單')
  }

  const path =
    targetPath ??
    join(root, classId, assignmentId, `S${seat}`, feedbackPdfFileName(work.seat))

  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  try {
    await loadFeedbackWindow(win, classId, assignmentId, seat)
    const state = await waitForRender(win)

    if (state.failed) {
      throw new Error(`回饋單資料載入失敗：${state.failed}`)
    }

    if (state.overflow) {
      throw new Error('回饋單內容超過一頁，請縮短總評或減少批注')
    }

    const started = performance.now()
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    const ms = Math.round(performance.now() - started)
    const pages = countPdfPages(pdf)

    if (pages !== 1) {
      throw new Error(`回饋單應為一頁，實際產生 ${pages} 頁`)
    }

    await writeFileAtomic(path, pdf)

    return {
      path,
      pages,
      bytes: pdf.length,
      ms,
      fileName: path.split(/[\\/]/).pop() ?? feedbackPdfFileName(work.seat)
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** 另存 PDF 的預設路徑（文件資料夾＋中文檔名）。 */
export function defaultSavePath(fileName: string): string {
  return join(app.getPath('documents'), fileName)
}

/** 整班批次回饋單的固定輸出資料夾。 */
export function feedbackBatchDir(
  root: string,
  classId: string,
  assignmentId: string
): string {
  return join(root, classId, assignmentId, '_feedback')
}
