import { app, dialog, shell } from 'electron'
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

/** 單一日誌檔上限；超過就輪替為 app.1.log。 */
export const MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_MESSAGE_CHARS = 4000

let directoryOverride: string | null = null
let queue: Promise<void> = Promise.resolve()

/** 驗收時可把日誌導到暫存資料夾，不污染使用者 logs。 */
export function setLogDirectoryForCheck(dir: string | null): void {
  directoryOverride = dir
}

export function logDirectory(): string {
  return directoryOverride ?? join(app.getPath('userData'), 'logs')
}

export function logFilePath(dir = logDirectory()): string {
  return join(dir, 'app.log')
}

/**
 * 日誌只放事件與錯誤訊息；呼叫端不得傳入學生姓名、總評、批注全文或圖片內容。
 * 這裡仍限制單筆長度與換行數，避免意外把整份 JSON 倒進日誌。
 */
function normalizeMessage(message: string): string {
  const text = message.replace(/\r\n?/g, '\n').trim()
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text
}

export function formatLogLine(level: LogLevel, message: string, at = new Date()): string {
  const text = normalizeMessage(message)
  const prefix = `${at.toISOString()} [${level.toUpperCase()}] `
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? `${prefix}${line}` : `    ${line}`))
    .join('\n')
    .concat('\n')
}

/** app.log 超過上限時改名為 app.1.log（舊的 app.1.log 直接覆蓋）。 */
export async function rotateIfNeeded(
  dir = logDirectory(),
  maxBytes = MAX_LOG_BYTES
): Promise<boolean> {
  const file = logFilePath(dir)
  try {
    const info = await stat(file)
    if (info.size < maxBytes) return false
  } catch {
    return false
  }

  try {
    await rm(join(dir, 'app.1.log'), { force: true })
    await rename(file, join(dir, 'app.1.log'))
    return true
  } catch {
    // 輪替失敗不影響後續寫入；下一筆會再試。
    return false
  }
}

async function writeLine(line: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await rotateIfNeeded(dir)
  await appendFile(logFilePath(dir), line, 'utf8')
}

export function log(level: LogLevel, message: string): void {
  let dir: string
  try {
    dir = logDirectory()
  } catch {
    return
  }

  const line = formatLogLine(level, message)
  queue = queue.then(() => writeLine(line, dir)).catch(() => undefined)
}

export function logInfo(message: string): void {
  log('info', message)
}

export function logWarn(message: string): void {
  log('warn', message)
}

export function logError(message: string): void {
  log('error', message)
}

/** m7:check 用；正常流程不需要等待寫入。 */
export async function flushLogs(): Promise<void> {
  await queue
}

export async function openLogsFolder(): Promise<string> {
  const dir = logDirectory()
  await mkdir(dir, { recursive: true })
  const error = await shell.openPath(dir)
  if (error) throw new Error(`無法開啟日誌資料夾：${error}`)
  return dir
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
  }
  // 不把任意物件 JSON 化，避免把作品內容或名單帶進日誌。
  if (typeof error === 'string') return error
  return Object.prototype.toString.call(error)
}

let fatalDialogOpen = false

async function reportFatal(title: string, detail: string): Promise<void> {
  if (fatalDialogOpen || !app.isReady()) return
  fatalDialogOpen = true
  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: '作文批閱',
      message: title,
      detail: `${detail}\n\n詳細資訊已寫入日誌。`,
      buttons: ['開啟日誌資料夾', '結束程式'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (response === 0) await openLogsFolder().catch(() => undefined)
  } finally {
    app.exit(1)
  }
}

/** 捕捉主程序未處理的錯誤；只在正式啟動時安裝，避免驗收模式跳視窗。 */
export function installErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    logError(`uncaughtException：${errorText(error)}`)
    void reportFatal('發生未預期的錯誤，程式即將結束。', '請重新啟動；若持續發生，請把日誌資料夾提供給開發者。')
  })

  process.on('unhandledRejection', (reason) => {
    logError(`unhandledRejection：${errorText(reason)}`)
  })

  app.on('child-process-gone', (_event, details) => {
    logError(
      `子程序結束：type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
    )
  })
}
