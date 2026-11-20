import sharp from 'sharp'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  AssignmentSchema,
  ClassSchema,
  normalizeSeat,
  type InboxSidecar
} from '@essay-grader/core'
import { readJsonRecovering } from '../data/atomic'
import { readSettings } from '../data/settings'
import { currentRoot } from '../data/repository'
import { ensureInbox } from './watcher'
import { delay, stamp, type UnmatchedMeta } from './shared'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png'])
const MAX_THUMB_BYTES = 64 * 1024 * 1024
const THUMB_EDGE = 320
const STAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T[0-9-]+Z__/

export interface UnmatchedPhoto {
  /** 絕對路徑；只在 main 使用，renderer 不可自行讀檔。 */
  path: string
  /** 去掉時間戳前綴的顯示名稱。 */
  name: string
  originalName: string
  source: 'inbox' | 'drive'
  reason: string
  classId?: string
  assignmentId?: string
  seat?: string
  modifiedAt: string
  size: number
  hasMeta: boolean
}

export interface UnmatchedListing {
  photos: UnmatchedPhoto[]
  internalDir: string
  externalDir: string | null
}

export interface UnmatchedAssignmentResult {
  queued: number
  failed: Array<{ path: string; reason: string }>
  inbox: string
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function requireRoot(): string {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫')
  return root
}

function internalUnmatchedDir(dbRoot: string, classId: string, assignmentId: string): string {
  return join(dbRoot, classId, assignmentId, '_inbox', '_unmatched')
}

async function safeRealpath(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 只接受位於允許 `_unmatched` 根目錄內的圖片。
 * 同時比對 realpath，避免以符號連結或 `..` 跳到根目錄外。
 */
async function validateImagePath(
  path: string,
  roots: string[]
): Promise<{ file: string; ext: string }> {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('檔案路徑不可為空')
  }

  const file = resolve(path)
  const ext = extname(file).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) throw new Error(`不支援的圖片格式：${ext || '無副檔名'}`)
  if (basename(file).startsWith('.')) throw new Error('不接受隱藏檔案')

  const realFile = await safeRealpath(file)
  if (!realFile) throw new Error(`找不到檔案：${basename(file)}`)

  for (const root of roots) {
    const realRoot = await safeRealpath(root)
    if (realRoot && inside(realRoot, realFile)) return { file, ext }
  }

  throw new Error(`路徑不在允許的 _unmatched 資料夾內：${basename(file)}`)
}

async function allowedRoots(
  classId: string,
  assignmentId: string
): Promise<{ roots: string[]; externalDir: string | null }> {
  const dbRoot = requireRoot()
  const internal = internalUnmatchedDir(dbRoot, classId, assignmentId)
  const settings = await readSettings()
  const external = settings.externalInboxRoot
    ? join(settings.externalInboxRoot, '_unmatched')
    : null

  return { roots: external ? [internal, external] : [internal], externalDir: external }
}

async function readMeta(imagePath: string): Promise<Partial<UnmatchedMeta> & { has: boolean }> {
  const path = `${imagePath}.meta.json`
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined

    return {
      has: true,
      ...(text(raw['classId']) ? { classId: text(raw['classId']) } : {}),
      ...(text(raw['assignmentId']) ? { assignmentId: text(raw['assignmentId']) } : {}),
      ...(text(raw['seat']) ? { seat: text(raw['seat']) } : {}),
      ...(text(raw['reason']) ? { reason: text(raw['reason']) } : {}),
      ...(text(raw['originalName']) ? { originalName: text(raw['originalName']) } : {})
    }
  } catch {
    return { has: false }
  }
}

async function readReason(imagePath: string, meta?: { reason?: string }): Promise<string> {
  if (meta?.reason) return meta.reason
  try {
    const text = (await readFile(`${imagePath}.reason.txt`, 'utf8')).trim()
    return text || '未記錄原因'
  } catch {
    return '未記錄原因'
  }
}

function stripStamp(name: string): string {
  return name.replace(STAMP_PREFIX, '')
}

async function collect(
  dir: string,
  source: 'inbox' | 'drive'
): Promise<UnmatchedPhoto[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const photos: UnmatchedPhoto[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!IMAGE_EXTS.has(extname(entry.name).toLowerCase())) continue
    if (entry.name.startsWith('.')) continue

    const path = join(dir, entry.name)
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }

    const meta = await readMeta(path)
    const displayName = stripStamp(entry.name)
    photos.push({
      path,
      name: displayName,
      originalName: meta.originalName ?? displayName,
      source,
      reason: await readReason(path, meta),
      ...(meta.classId ? { classId: meta.classId } : {}),
      ...(meta.assignmentId ? { assignmentId: meta.assignmentId } : {}),
      ...(meta.seat ? { seat: meta.seat } : {}),
      modifiedAt: info.mtime.toISOString(),
      size: info.size,
      hasMeta: meta.has
    })
  }
  return photos
}

/**
 * 列出目前作業的內部 `_inbox/_unmatched`，以及外部 Drive 根目錄的 `_unmatched`。
 * 舊檔沒有 `.meta.json` 時 classId／assignmentId 留空，由 UI 顯示「未指定作業」。
 */
export async function listUnmatched(
  classId: string,
  assignmentId: string
): Promise<UnmatchedListing> {
  const dbRoot = requireRoot()
  const internalDir = internalUnmatchedDir(dbRoot, classId, assignmentId)
  const settings = await readSettings()
  const externalDir = settings.externalInboxRoot
    ? join(settings.externalInboxRoot, '_unmatched')
    : null

  const [internal, external] = await Promise.all([
    collect(internalDir, 'inbox'),
    externalDir ? collect(externalDir, 'drive') : Promise.resolve([])
  ])

  const photos = [...internal, ...external].sort((a, b) => {
    const byTime = a.modifiedAt.localeCompare(b.modifiedAt)
    return byTime !== 0 ? byTime : a.name.localeCompare(b.name)
  })

  return { photos, internalDir, externalDir }
}

/** 以 sharp 產生 320px 縮圖，單張回傳 data URL，避免一次把大圖送進 renderer。 */
export async function getUnmatchedThumbnail(
  classId: string,
  assignmentId: string,
  path: string
): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
  const { roots } = await allowedRoots(classId, assignmentId)
  const { file } = await validateImagePath(path, roots)

  const info = await stat(file)
  if (info.size > MAX_THUMB_BYTES) throw new Error('圖片檔案過大，無法產生縮圖')

  const output = await sharp(file, { failOn: 'none' })
    .rotate()
    .resize({
      width: THUMB_EDGE,
      height: THUMB_EDGE,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 70 })
    .toBuffer({ resolveWithObject: true })

  return {
    dataUrl: `data:image/jpeg;base64,${output.data.toString('base64')}`,
    width: output.info.width,
    height: output.info.height,
    bytes: output.data.length
  }
}

async function removeQuiet(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await unlink(path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      if (attempt === 4) throw error
      await delay(120)
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 等 watcher 把剛放入的圖片與 sidecar 收走（成功、重複或移到失敗資料夾），
 * 再放入下一張，確保多頁照片依選取順序附加。
 */
async function waitUntilConsumed(
  image: string,
  sidecar: string,
  timeoutMs = 20000
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!(await exists(image)) && !(await exists(sidecar))) return true
    await delay(150)
  }
  return false
}

/**
 * 把未匹配照片複製到作業 `_inbox` 並產生 sidecar，交給既有 watcher 匯入。
 * 來源只有在複製成功後才刪除；重複內容仍由 watcher 的 SHA-256 去重。
 */
export async function assignUnmatched(input: {
  classId: string
  assignmentId: string
  seat: string
  paths: string[]
}): Promise<UnmatchedAssignmentResult> {
  const { classId, assignmentId, paths } = input
  const rawSeat = String(input.seat ?? '').trim()
  if (!/^\d{1,2}$/.test(rawSeat)) throw new Error('請選擇有效的座號')
  const seat = normalizeSeat(rawSeat)

  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('請先選取至少一張未匹配照片')
  }

  const dbRoot = requireRoot()

  let classFile
  try {
    classFile = (await readJsonRecovering(join(dbRoot, classId, 'class.json'), ClassSchema))
      .data
  } catch {
    throw new Error(`找不到班級 ${classId}，或 class.json 無法讀取`)
  }

  try {
    await readJsonRecovering(
      join(dbRoot, classId, assignmentId, 'assignment.json'),
      AssignmentSchema
    )
  } catch {
    throw new Error(`找不到作業 ${classId}/${assignmentId}，或 assignment.json 無法讀取`)
  }

  const student = classFile.students.find((item) => item.seat === seat && item.active)
  if (!student) throw new Error(`座號 ${seat} 不在在學名單內`)

  const { roots } = await allowedRoots(classId, assignmentId)
  const unique = [...new Set(paths.map((path) => String(path)))]

  const verified: Array<{ file: string; ext: string; modified: number; name: string }> = []
  for (const path of unique) {
    const { file, ext } = await validateImagePath(path, roots)
    const info = await stat(file)
    verified.push({ file, ext, modified: info.mtimeMs, name: basename(file) })
  }

  verified.sort((a, b) =>
    a.modified !== b.modified
      ? a.modified - b.modified
      : a.name.localeCompare(b.name)
  )

  const inbox = await ensureInbox(classId, assignmentId)
  await mkdir(inbox, { recursive: true })

  const timestamp = stamp()
  const now = new Date().toISOString()
  const failed: Array<{ path: string; reason: string }> = []
  let queued = 0

  for (let index = 0; index < verified.length; index++) {
    const item = verified[index]!
    const stem = `S${seat}__manual__${timestamp}__${String(index + 1).padStart(3, '0')}`
    let target = join(inbox, `${stem}${item.ext}`)
    let sidecarPath = join(inbox, `${stem}.json`)

    let suffix = 2
    while ((await exists(target)) || (await exists(sidecarPath))) {
      target = join(inbox, `${stem}-${suffix}${item.ext}`)
      sidecarPath = join(inbox, `${stem}-${suffix}.json`)
      suffix += 1
    }

    try {
      await copyFile(item.file, target)

      const sidecar: InboxSidecar = {
        schema_version: 1,
        class_id: classId,
        assignment_id: assignmentId,
        seat,
        seq: index + 1,
        session_id: `MANUAL-${timestamp}`,
        captured_at: now
      }
      await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8')
    } catch (error) {
      await removeQuiet(target).catch(() => undefined)
      await removeQuiet(sidecarPath).catch(() => undefined)
      failed.push({ path: item.file, reason: `複製到 inbox 失敗：${messageOf(error)}` })
      continue
    }

    queued += 1

    const consumed = await waitUntilConsumed(target, sidecarPath)
    if (!consumed) {
      failed.push({
        path: item.file,
        reason: '已放入 inbox，但等待 watcher 處理逾時；請稍後確認佇列'
      })
    }

    for (const artifact of [
      item.file,
      `${item.file}.json`,
      `${item.file}.reason.txt`,
      `${item.file}.meta.json`
    ]) {
      try {
        await removeQuiet(artifact)
      } catch (error) {
        failed.push({
          path: artifact,
          reason: `已排入匯入，但刪除來源失敗：${messageOf(error)}`
        })
      }
    }
  }

  return { queued, failed, inbox }
}
