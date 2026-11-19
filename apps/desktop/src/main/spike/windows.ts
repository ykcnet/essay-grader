import { BrowserWindow } from 'electron'
import { join } from 'node:path'

interface SpikeWindowOptions {
  show: boolean
  /** 顯示在螢幕外：仍會被合成器繪製，但使用者看不到，FPS 才不會被節流 */
  offscreen?: boolean
}

export function createSpikeWindow(options: SpikeWindowOptions): BrowserWindow {
  const { show, offscreen = false } = options

  return new BrowserWindow({
    show,
    x: offscreen ? -3200 : undefined,
    y: offscreen ? -3200 : undefined,
    width: 1400,
    height: 950,
    backgroundColor: '#0b2545',
    title: 'Spike 驗證',
    skipTaskbar: offscreen,
    focusable: !offscreen,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
}

export async function loadSpikePage(win: BrowserWindow): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    await win.loadURL(`${devUrl}/spike.html`)
  } else {
    await win.loadFile(join(__dirname, '../renderer/spike.html'))
  }
}

export async function loadFeedbackPage(win: BrowserWindow): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    await win.loadURL(`${devUrl}/feedback.html`)
  } else {
    await win.loadFile(join(__dirname, '../renderer/feedback.html'))
  }
}
