import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { feedbackPdfPath } from './paths'
import { loadFeedbackPage } from './windows'

export interface PdfResult {
  ok: boolean
  pages: number
  bytes: number
  ms: number
  path: string
}

/** 用隱藏視窗載入 A4 回饋單，再 printToPDF；驗證頁數與檔案大小。 */
export async function runPdfCheck(): Promise<PdfResult> {
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { sandbox: false, backgroundThrottling: false }
  })

  try {
    await loadFeedbackPage(win)
    // 等字型與版面穩定
    await new Promise((resolve) => setTimeout(resolve, 300))

    const started = performance.now()
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    const ms = performance.now() - started

    await writeFile(feedbackPdfPath, pdf)

    // PDF 的物件字典未壓縮，可粗略計算頁數
    const raw = pdf.toString('latin1')
    const pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length

    return {
      ok: pages === 1 && pdf.length > 20_000,
      pages,
      bytes: pdf.length,
      ms,
      path: feedbackPdfPath
    }
  } finally {
    win.destroy()
  }
}
