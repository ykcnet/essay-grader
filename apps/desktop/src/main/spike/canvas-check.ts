import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { spikePagePath } from './paths'
import { createSpikeWindow, loadSpikePage } from './windows'

export interface SpikeMarker {
  id: string
  x: number
  y: number
}

export interface CanvasResult {
  ok: boolean
  placed: number
  reloaded: number
  maxDelta: number
  fps: number
  zoom: number
  anchorError: number
  memoryMB: number
  privateMB: number | null
  error?: string
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForApi(win: BrowserWindow): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const ready = await win.webContents.executeJavaScript('Boolean(window.__spike)')
    if (ready) return
    await delay(50)
  }
  throw new Error('spike API 未就緒')
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`${label} 超過 ${ms}ms`)
    })
  ])
}

export function currentMemoryMB(): number {
  const totalKb = app
    .getAppMetrics()
    .reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0), 0)
  return Math.round(totalKb / 1024)
}

/**
 * Windows 工作管理員的「記憶體」約等於 private bytes。
 * app.getAppMetrics() 的 workingSetSize 會把共用 DLL 重複計算，所以另外量這個。
 */
async function privateMemoryMB(): Promise<number | null> {
  if (process.platform !== 'win32') return null

  return new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum'
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const bytes = Number(stdout.trim())
        resolve(Number.isFinite(bytes) ? Math.round(bytes / 1024 / 1024) : null)
      }
    )
  })
}

/**
 * 在隱藏視窗跑完整 Canvas 流程：
 * 載入 2600×3466 → 放 50 個標記 → 存檔 → reload → 比對 → 400% 縮放 → FPS。
 */
export async function runCanvasCheck(): Promise<CanvasResult> {
  try {
    await access(spikePagePath)
  } catch {
    return {
      ok: false,
      placed: 0,
      reloaded: 0,
      maxDelta: 0,
      fps: 0,
      zoom: 0,
      anchorError: 0,
      memoryMB: currentMemoryMB(),
      privateMB: null,
      error: `缺少 ${spikePagePath}，請先執行 tools/make_spike_page.ps1`
    }
  }

  const win = createSpikeWindow({ show: true, offscreen: true })

  try {
    await loadSpikePage(win)
    await waitForApi(win)
    await withTimeout(
      win.webContents.executeJavaScript('window.__spike.ready()') as Promise<void>,
      15_000,
      '圖片載入'
    )

    await win.webContents.executeJavaScript('window.__spike.clear()')
    const expected = (await win.webContents.executeJavaScript(
      'window.__spike.placeMarkers(50)'
    )) as SpikeMarker[]
    await win.webContents.executeJavaScript('window.__spike.save()')

    const loaded = new Promise<void>((resolve) =>
      win.webContents.once('did-finish-load', () => resolve())
    )
    win.reload()
    await loaded
    await waitForApi(win)
    await withTimeout(
      win.webContents.executeJavaScript('window.__spike.ready()') as Promise<void>,
      15_000,
      '重載後圖片'
    )

    const actual = (await win.webContents.executeJavaScript(
      'window.__spike.getMarkers()'
    )) as SpikeMarker[]

    const byId = new Map(actual.map((marker) => [marker.id, marker]))
    let maxDelta = 0
    for (const marker of expected) {
      const found = byId.get(marker.id)
      if (!found) {
        maxDelta = Number.POSITIVE_INFINITY
        continue
      }
      maxDelta = Math.max(
        maxDelta,
        Math.abs(marker.x - found.x),
        Math.abs(marker.y - found.y)
      )
    }

    await win.webContents.executeJavaScript('window.__spike.setZoom(4)')
    const fps = (await withTimeout(
      win.webContents.executeJavaScript('window.__spike.fpsTest(2500)') as Promise<number>,
      15_000,
      'FPS 測試'
    )) as number
    const zoom = (await win.webContents.executeJavaScript(
      'window.__spike.getZoom()'
    )) as number
    const anchorError = (await win.webContents.executeJavaScript(
      'window.__spike.anchorError()'
    )) as number

    const memoryMB = currentMemoryMB()
    const privateMB = await privateMemoryMB()
    const ok =
      expected.length === 50 &&
      actual.length === 50 &&
      maxDelta < 1e-9 &&
      fps >= 30 &&
      Math.abs(zoom - 4) < 0.01 &&
      anchorError <= 0.5

    return {
      ok,
      placed: expected.length,
      reloaded: actual.length,
      maxDelta,
      fps,
      zoom,
      anchorError,
      memoryMB,
      privateMB
    }
  } catch (error) {
    return {
      ok: false,
      placed: 0,
      reloaded: 0,
      maxDelta: 0,
      fps: 0,
      zoom: 0,
      anchorError: 0,
      memoryMB: currentMemoryMB(),
      privateMB: null,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    win.destroy()
    // 讓主行程有機會回收子行程
    await delay(500)
  }
}
