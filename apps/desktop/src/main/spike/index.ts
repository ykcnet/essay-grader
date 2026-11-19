import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { access, readFile } from 'node:fs/promises'
import { currentMemoryMB, runCanvasCheck, type SpikeMarker } from './canvas-check'
import { atomicWrite, readJsonFile } from './io'
import {
  markersPath,
  reportPath,
  spikeOutDir,
  spikePagePath
} from './paths'
import { runPdfCheck } from './pdf-check'
import { runWatcherCheck } from './watcher-check'
import { createSpikeWindow, loadSpikePage } from './windows'

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

function sanitizeMarkers(input: unknown): SpikeMarker[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const { id, x, y } = item as Record<string, unknown>
    if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number') return []
    return [{ id, x: clamp01(x), y: clamp01(y) }]
  })
}

let spikeWindow: BrowserWindow | null = null

/** 註冊 Spike 頁面用的 IPC；正式功能不會用到。 */
export function registerSpikeIpc(): void {
  ipcMain.handle('spike:load-page', async () => {
    const buffer = await readFile(spikePagePath)
    return {
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      width: 2600,
      height: 3466
    }
  })

  ipcMain.handle('spike:load-markers', async () => {
    return (await readJsonFile<SpikeMarker[]>(markersPath)) ?? []
  })

  ipcMain.handle('spike:save-markers', async (_event, raw: unknown) => {
    const markers = sanitizeMarkers(raw)
    await atomicWrite(markersPath, JSON.stringify(markers, null, 2))
    return { path: markersPath, count: markers.length }
  })

  ipcMain.handle('spike:export-pdf', async () => runPdfCheck())
  ipcMain.handle('spike:run-watcher', async () => runWatcherCheck())
  ipcMain.handle('spike:memory', () => ({ mb: currentMemoryMB(), metrics: app.getAppMetrics().length }))

  ipcMain.handle('spike:open-window', async () => {
    if (spikeWindow && !spikeWindow.isDestroyed()) {
      spikeWindow.show()
      spikeWindow.focus()
      return { reused: true }
    }

    spikeWindow = createSpikeWindow({ show: true })
    spikeWindow.on('closed', () => {
      spikeWindow = null
    })
    await loadSpikePage(spikeWindow)
    return { reused: false }
  })

  ipcMain.handle('spike:open-out', async () => {
    await shell.openPath(spikeOutDir)
  })
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')

/** `--spike` 進入點：跑完 Canvas／PDF／監看／記憶體，輸出報告後結束。 */
export async function runSpike(): Promise<number> {
  try {
    await access(spikePagePath)
  } catch {
    console.error('[spike] 缺少 spike-assets/page-2600.jpg')
    console.error('[spike] 請先執行：powershell -ExecutionPolicy Bypass -File tools/make_spike_page.ps1')
    return 1
  }

  console.log('[spike] 開始（Canvas → PDF → 監看 → 記憶體）')

  const canvas = await runCanvasCheck()
  const pdf = await runPdfCheck()
  const watcher = await runWatcherCheck()
  // private bytes 才接近工作管理員顯示的數字；沒有就退回 working set
  const memoryMB = canvas.privateMB ?? currentMemoryMB()

  const canvasOk =
    canvas.ok &&
    canvas.placed === 50 &&
    canvas.reloaded === 50 &&
    canvas.maxDelta < 1e-9 &&
    canvas.fps >= 30 &&
    Math.abs(canvas.zoom - 4) < 0.01 &&
    canvas.anchorError <= 0.5
  const pdfOk = pdf.ok
  const watcherOk = watcher.ok
  const memoryOk = memoryMB < 500

  console.log('')
  console.log(`[${pass(canvasOk)}] Canvas 50 標記：重載 ${canvas.reloaded}/50，最大位移 ${canvas.maxDelta}`)
  console.log(
    `[${pass(canvasOk)}] 400% 縮放：scale ${canvas.zoom.toFixed(2)}，錨點誤差 ${canvas.anchorError.toFixed(2)} px，FPS ${canvas.fps.toFixed(1)}`
  )
  console.log(
    `[${pass(pdfOk)}] A4 PDF：${pdf.pages} 頁，${(pdf.bytes / 1024).toFixed(0)} KB，${pdf.ms.toFixed(0)}ms`
  )
  console.log(
    `[${pass(watcherOk)}] 資料夾監看：${watcher.pairs}/10 配對，${watcher.ms.toFixed(0)}ms${watcher.error ? `（${watcher.error}）` : ''}`
  )
  console.log(
    `[${pass(memoryOk)}] 記憶體：${memoryMB} MB private（working set 峰值 ${canvas.memoryMB} MB，門檻 500 MB）`
  )

  if (canvas.error) console.error(`[spike] Canvas 錯誤：${canvas.error}`)

  const report = {
    generated_at: new Date().toISOString(),
    canvas,
    pdf,
    watcher,
    memory_mb: memoryMB
  }
  await atomicWrite(reportPath, JSON.stringify(report, null, 2))
  console.log(`[spike] 報告：${reportPath}`)

  return canvasOk && pdfOk && watcherOk && memoryOk ? 0 : 1
}
