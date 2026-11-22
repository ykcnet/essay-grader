import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { registerDataIpc } from './data/ipc'
import { runCrudCheck } from './data/crud-check'
import { runM1Check } from './data/m1-check'
import { runM3Check } from './data/m3-check'
import { runM4Check } from './data/m4-check'
import { runM5Check } from './data/m5-check'
import { runM6Check } from './data/m6-check'
import { runM7Check } from './data/m7-check'
import { runSimilarityCheck } from './data/similarity-check'
import { autoOpenLastDatabase } from './data/repository'
import { readSettings } from './data/settings'
import { registerFeedbackIpc } from './feedback/ipc'
import { runBatchCheck } from './feedback/batch-check'
import { runCompareCheck } from './data/compare-check'
import { runPraiseCheck } from './data/praise-check'
import { runLibraryImportCheck } from './data/library-import-check'
import { runDriveCheck } from './import/drive-check'
import { runManifestCheck } from './import/manifest-check'
import { runMatchCheck } from './import/match-check'
import { runM2Check } from './import/m2-check'
import { runExcelCheck } from './data/gradebook-check'
import { installErrorHandlers, logError, logInfo, logWarn, openLogsFolder } from './logger'
import { registerSpikeIpc, runSpike } from './spike'
import { runSoak } from './soak'
import { validateFixtures } from './validate-fixtures'

const isDev = !app.isPackaged
const fixturesOnly = process.argv.includes('--validate-fixtures')
const spikeMode = process.argv.includes('--spike')
const crudMode = process.argv.includes('--crud-check')
const m1Mode = process.argv.includes('--m1-check')
const m2Mode = process.argv.includes('--m2-check')
const m3Mode = process.argv.includes('--m3-check')
const m4Mode = process.argv.includes('--m4-check')
const m5Mode = process.argv.includes('--m5-check')
const m6Mode = process.argv.includes('--m6-check')
const m7Mode = process.argv.includes('--m7-check')
const similarityMode = process.argv.includes('--similarity-check')
const driveMode = process.argv.includes('--drive-check')
const manifestMode = process.argv.includes('--manifest-check')
const excelMode = process.argv.includes('--excel-check')
const matchMode = process.argv.includes('--match-check')
const batchMode = process.argv.includes('--batch-check')
const compareMode = process.argv.includes('--compare-check')
const praiseMode = process.argv.includes('--praise-check')
const libraryImportMode = process.argv.includes('--library-import-check')
const soakMode = process.argv.includes('--soak')
const checkMode =
  crudMode ||
  m1Mode ||
  m2Mode ||
  m3Mode ||
  m4Mode ||
  m5Mode ||
  m6Mode ||
  m7Mode ||
  similarityMode ||
  driveMode ||
  manifestMode ||
  excelMode ||
  matchMode ||
  batchMode ||
  compareMode ||
  praiseMode ||
  libraryImportMode ||
  soakMode ||
  spikeMode ||
  fixturesOnly

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

  let crashDialogShown = false
  win.webContents.on('did-finish-load', () => {
    crashDialogShown = false
  })

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    logError(`畫面載入失敗：code=${code} ${description} url=${url}`)
  })

  win.webContents.on('unresponsive', () => {
    logWarn('主視窗沒有回應')
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    logError(`畫面程序結束：reason=${details.reason} exitCode=${details.exitCode}`)
    if (crashDialogShown || win.isDestroyed()) return
    crashDialogShown = true

    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: '作文批閱',
        message: '畫面發生錯誤並已停止。',
        detail: '可以先重新載入；若持續發生，請開啟日誌資料夾，把最近的 app.log 提供給開發者。',
        buttons: ['重新載入', '開啟日誌資料夾', '關閉'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return
        if (response === 0) win.reload()
        if (response === 1) void openLogsFolder().catch(() => undefined)
      })
  })

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

// 驗收模式不跳錯誤視窗，避免自動測試卡住。
if (!checkMode) installErrorHandlers()

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
    logInfo(`應用程式啟動 v${app.getVersion()}（${isDev ? 'dev' : 'packaged'}）`)

    if (spikeMode) {
      const code = await runSpike()
      app.exit(code)
      return
    }

    if (crudMode) {
      const code = await runCrudCheck()
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

    if (m6Mode) {
      const code = await runM6Check()
      app.exit(code)
      return
    }

    if (m7Mode) {
      const code = await runM7Check()
      app.exit(code)
      return
    }

    if (similarityMode) {
      const code = await runSimilarityCheck()
      app.exit(code)
      return
    }

    if (driveMode) {
      const code = await runDriveCheck()
      app.exit(code)
      return
    }

    if (manifestMode) {
      const code = await runManifestCheck()
      app.exit(code)
      return
    }

    if (excelMode) {
      const code = await runExcelCheck()
      app.exit(code)
      return
    }

    if (matchMode) {
      const code = await runMatchCheck()
      app.exit(code)
      return
    }

    if (batchMode) {
      const code = await runBatchCheck()
      app.exit(code)
      return
    }

    if (compareMode) {
      const code = await runCompareCheck()
      app.exit(code)
      return
    }

    if (praiseMode) {
      const code = await runPraiseCheck()
      app.exit(code)
      return
    }

    if (libraryImportMode) {
      const code = await runLibraryImportCheck()
      app.exit(code)
      return
    }

    if (soakMode) {
      const code = await runSoak()
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
      !crudMode &&
      !m1Mode &&
      !m2Mode &&
      !m3Mode &&
      !m4Mode &&
      !m5Mode &&
      !m6Mode &&
      !m7Mode &&
      !driveMode &&
      !manifestMode &&
      !excelMode &&
      !matchMode &&
      !batchMode &&
      !compareMode &&
      !praiseMode &&
      !libraryImportMode &&
      !soakMode &&
      process.platform !== 'darwin'
    ) {
      app.quit()
    }
  })
}
