import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerDataIpc } from './data/ipc'
import { runM1Check } from './data/m1-check'
import { runM3Check } from './data/m3-check'
import { runM4Check } from './data/m4-check'
import { runM5Check } from './data/m5-check'
import { autoOpenLastDatabase } from './data/repository'
import { readSettings } from './data/settings'
import { registerFeedbackIpc } from './feedback/ipc'
import { runM2Check } from './import/m2-check'
import { registerSpikeIpc, runSpike } from './spike'
import { validateFixtures } from './validate-fixtures'

const isDev = !app.isPackaged
const fixturesOnly = process.argv.includes('--validate-fixtures')
const spikeMode = process.argv.includes('--spike')
const m1Mode = process.argv.includes('--m1-check')
const m2Mode = process.argv.includes('--m2-check')
const m3Mode = process.argv.includes('--m3-check')
const m4Mode = process.argv.includes('--m4-check')
const m5Mode = process.argv.includes('--m5-check')

if (spikeMode) {
  // 隱藏/離屏視窗預設會被 Chromium 降頻，FPS 測試需要關掉
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b2545',
    title: '作文批閱 Essay Grader',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 一律用系統瀏覽器開外部連結，不在 app 內導航。
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 同一時間只允許一個實例，避免兩個程式同時寫入資料庫。
registerSpikeIpc()
registerDataIpc()
registerFeedbackIpc()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('tw.edu.essaygrader')

    if (spikeMode) {
      const code = await runSpike()
      app.exit(code)
      return
    }

    if (m1Mode) {
      const code = await runM1Check()
      app.exit(code)
      return
    }

    if (m2Mode) {
      const code = await runM2Check()
      app.exit(code)
      return
    }

    if (m3Mode) {
      const code = await runM3Check()
      app.exit(code)
      return
    }

    if (m4Mode) {
      const code = await runM4Check()
      app.exit(code)
      return
    }

    if (m5Mode) {
      const code = await runM5Check()
      app.exit(code)
      return
    }

    // 開發模式啟動時驗證 fixtures；--validate-fixtures 只驗證不開窗。
    if (isDev || fixturesOnly) {
      const ok = await validateFixtures()
      if (fixturesOnly) {
        app.exit(ok ? 0 : 1)
        return
      }
    }

    const settings = await readSettings()
    await autoOpenLastDatabase(settings.lastDatabase)

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Spike／M1／M2／M3 檢查期間會反覆開關隱藏視窗，不能因此結束程式
    if (
      !spikeMode &&
      !m1Mode &&
      !m2Mode &&
      !m3Mode &&
      !m4Mode &&
      !m5Mode &&
      process.platform !== 'darwin'
    ) {
      app.quit()
    }
  })
}
