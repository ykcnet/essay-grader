import archiver from 'archiver'
import { open as openZipFile, type Entry, type ZipFile } from 'yauzl'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const LOCK_FILE = '.essay-grader.lock'

export interface BackupResult {
  path: string
  files: number
  bytes: number
}

export interface RestoreResult {
  root: string
  files: number
  bytes: number
}

/** 預設檔名不含姓名或班級，只放時間。 */
export function backupFileName(at = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `essay-grader-backup-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(
    at.getDate()
  )}-${pad(at.getHours())}${pad(at.getMinutes())}.zip`
}

/** 備份排除鎖檔與所有暫存檔；.bak、_stats、圖片都會保留。 */
function isExcludedName(name: string): boolean {
  return name === LOCK_FILE || name.endsWith('.tmp')
}

function toZipName(relativePath: string): string {
  return relativePath.split(sep).join('/')
}

/**
 * 把整個資料庫根目錄壓成 zip。
 * 呼叫端可指定任何目標路徑，m7:check 不需經過對話框。
 */
export async function createBackupZip(
  sourceRoot: string,
  targetZip: string
): Promise<BackupResult> {
  const source = resolve(sourceRoot)
  const target = resolve(targetZip)

  const sourceInfo = await stat(source).catch(() => null)
  if (!sourceInfo?.isDirectory()) throw new Error('資料庫資料夾不存在，無法備份')

  await mkdir(dirname(target), { recursive: true })

  const output = createWriteStream(target)
  const archive = archiver('zip', { zlib: { level: 9 } })
  let files = 0

  const finished = new Promise<void>((resolveDone, reject) => {
    output.on('close', () => resolveDone())
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', reject)
  })
  // 先掛一個 no-op，避免 walk 期間的錯誤成為未處理 rejection。
  void finished.catch(() => undefined)

  archive.pipe(output)

  const walk = async (dir: string, relative: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))

    for (const entry of entries) {
      if (isExcludedName(entry.name)) continue

      const absolute = resolve(dir, entry.name)
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name

      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(absolute, nextRelative)
        continue
      }
      if (!entry.isFile()) continue
      if (absolute === target) continue

      archive.file(absolute, { name: toZipName(nextRelative) })
      files += 1
    }
  }

  try {
    await walk(source, '')
    await archive.finalize()
    await finished
  } catch (error) {
    archive.abort()
    output.destroy()
    await rm(target, { force: true }).catch(() => undefined)
    throw error
  }

  const info = await stat(target)
  return { path: target, files, bytes: info.size }
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    openZipFile(path, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) reject(error)
      else resolveZip(zip)
    })
  })
}

function collectEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolveEntries, reject) => {
    const entries: Entry[] = []
    zip.on('entry', (entry: Entry) => {
      entries.push(entry)
      zip.readEntry()
    })
    zip.on('end', () => resolveEntries(entries))
    zip.on('error', reject)
    zip.readEntry()
  })
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolveStream, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error)
      else resolveStream(stream)
    })
  })
}

/**
 * 檢查單一 zip entry 的相對路徑，拒絕絕對路徑、磁碟代號、ADS 與 `..`。
 * 這個函式是 zip slip 防線，m7:check 會直接測試。
 */
export function safeEntryPath(destinationRoot: string, entryName: string): string {
  if (!entryName || entryName.includes('\0')) {
    throw new Error('備份檔含有無效的檔案路徑')
  }

  const normalized = entryName.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`備份檔含有絕對路徑，已拒絕：${entryName}`)
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) throw new Error('備份檔含有空白路徑')
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new Error(`備份檔含有不安全的路徑，已拒絕：${entryName}`)
  }

  const root = resolve(destinationRoot)
  const target = resolve(root, ...segments)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`備份檔試圖寫出目的地，已拒絕：${entryName}`)
  }
  return target
}

function isSymlink(entry: Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
}

/**
 * 解壓到全新的空資料夾。目的地非空一律拒絕；所有 entry 先驗證再寫入，
 * 避免 zip slip 或半途覆寫既有檔案。
 */
export async function restoreBackupZip(
  zipPath: string,
  destination: string
): Promise<RestoreResult> {
  const targetRoot = resolve(destination)
  const zip = await openZip(resolve(zipPath))

  let destinationExisted = true
  try {
    const info = await stat(targetRoot)
    if (!info.isDirectory()) {
      zip.close()
      throw new Error('還原目的地不是資料夾')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    destinationExisted = false
  }

  if (destinationExisted) {
    const existing = await readdir(targetRoot)
    if (existing.length > 0) {
      zip.close()
      throw new Error('還原目的地不是空資料夾，請選擇新的資料夾，以免覆蓋既有資料。')
    }
  }

  try {
    const entries = await collectEntries(zip)

    const seen = new Set<string>()
    let hasDatabaseFile = false

    for (const entry of entries) {
      safeEntryPath(targetRoot, entry.fileName)
      if (entry.isEncrypted()) throw new Error('備份檔已加密，無法還原')
      if (isSymlink(entry)) throw new Error('備份檔含有符號連結，已拒絕還原')

      const key = entry.fileName.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (seen.has(key)) throw new Error(`備份檔含有重複路徑：${entry.fileName}`)
      seen.add(key)

      if (!entry.fileName.endsWith('/')) hasDatabaseFile = true
      if (/^C[0-9A-Za-z-]+\/class\.json$/i.test(key)) hasDatabaseFile = true
    }

    // 空資料庫允許（只有資料夾）；若含檔案，至少要像作文批閱資料庫。
    const hasClassFile = entries.some((entry) =>
      /^C[0-9A-Za-z-]+\/class\.json$/i.test(entry.fileName.replace(/\\/g, '/'))
    )
    if (hasDatabaseFile && !hasClassFile) {
      throw new Error('這個 zip 看起來不是作文批閱資料庫備份，已停止還原。')
    }

    await mkdir(targetRoot, { recursive: true })

    let files = 0
    let bytes = 0

    for (const entry of entries) {
      const target = safeEntryPath(targetRoot, entry.fileName)

      if (entry.fileName.endsWith('/')) {
        await mkdir(target, { recursive: true })
        continue
      }

      await mkdir(dirname(target), { recursive: true })
      const stream = await openEntryStream(zip, entry)
      await pipeline(stream, createWriteStream(target, { flags: 'wx' }))
      files += 1
      bytes += entry.uncompressedSize
    }

    return { root: targetRoot, files, bytes }
  } catch (error) {
    // 目的地原本不存在就整個移除；原本是空資料夾則清空本次寫入的內容。
    try {
      if (destinationExisted) {
        for (const name of await readdir(targetRoot)) {
          await rm(resolve(targetRoot, name), { recursive: true, force: true })
        }
      } else {
        await rm(targetRoot, { recursive: true, force: true })
      }
    } catch {
      // 清理失敗不掩蓋原始錯誤。
    }
    throw error
  } finally {
    zip.close()
  }
}

/** 給 UI 顯示用：只回傳檔名，不把完整路徑寫進日誌或提示。 */
export function backupDisplayName(path: string): string {
  return basename(path)
}
