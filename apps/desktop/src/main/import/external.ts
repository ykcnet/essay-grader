import chokidar, { type FSWatcher } from 'chokidar'
import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import {
  AssignmentSchema,
  ClassSchema,
  InboxSidecarSchema,
  WorkSchema,
  formatIssues,
  isIgnoredFileName,
  parseSeatFromFileName,
  studentFolderId,
  type InboxSidecar,
  type WorkFile
} from '@essay-grader/core'
import { ZodError } from 'zod'
import { readJsonRecovering, writeJsonAtomic } from '../data/atomic'
import { emitImportEvent } from './events'
import { preprocessImage, type ProcessedImage } from './image'
import {
  delay,
  findDuplicate,
  moveToSubfolder,
  sha256File
} from './shared'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png'])
const IGNORED_DIRS = new Set(['_unmatched', '_duplicates', '_imported'])
const CLASS_ID_RE = /^C[0-9A-Za-z-]+$/
const ASSIGNMENT_ID_RE = /^E\d{8}(-\d{2})?$/
/** Google Drive 同步較慢，圖片與 sidecar 可能先後到達。 */
const GRACE_MS = 2500

interface FolderRoute {
  classId: string | null
  assignmentId: string | null
  flat: boolean
}

let watcher: FSWatcher | null = null
let root: string | null = null
let databaseRoot: string | null = null
let watching = false
let error: string | null = null

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const inFlight = new Set<string>()
let chain: Promise<void> = Promise.resolve()

const messageOf = (value: unknown): string =>
  value instanceof Error ? value.message : String(value)

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((value) => {
    void emitImportEvent({
      type: 'error',
      source: 'drive',
      message: `Drive：匯入流程錯誤：${messageOf(value)}`
    })
  })
}

function ignoredPath(base: string, path: string): boolean {
  const rel = relative(base, path)
  if (!rel) return false

  for (const part of rel.split(sep)) {
    if (!part) continue
    if (part.startsWith('.')) return true
    if (IGNORED_DIRS.has(part.toLowerCase())) return true
  }

  const name = basename(path)
  const lower = name.toLowerCase()
  if (lower.endsWith('.gdoc') || lower.endsWith('.gsheet')) return true
  return isIgnoredFileName(name)
}

function folderRoute(driveRoot: string, imagePath: string): FolderRoute {
  const parts = relative(driveRoot, dirname(imagePath)).split(sep).filter(Boolean)
  if (parts.length === 0) return { classId: null, assignmentId: null, flat: true }

  const classId = parts[0] ?? ''
  const assignmentId = parts[1] ?? ''
  if (CLASS_ID_RE.test(classId) && ASSIGNMENT_ID_RE.test(assignmentId)) {
    return { classId, assignmentId, flat: false }
  }
  return { classId: null, assignmentId: null, flat: false }
}

async function reject(
  driveRoot: string,
  imagePath: string,
  sidecarPath: string | null,
  reason: string,
  route?: FolderRoute,
  seat?: string
): Promise<void> {
  await moveToSubfolder(driveRoot, '_unmatched', imagePath, sidecarPath, reason, {
    ...(route?.classId ? { classId: route.classId } : {}),
    ...(route?.assignmentId ? { assignmentId: route.assignmentId } : {}),
    ...(seat ? { seat } : {}),
    source: 'drive'
  })
  await emitImportEvent({
    type: 'unmatched',
    source: 'drive',
    classId: route?.classId ?? undefined,
    assignmentId: route?.assignmentId ?? undefined,
    seat,
    file: basename(imagePath),
    message: `Drive：${reason}`
  })
}

async function removeSource(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await unlink(path)
      return
    } catch (value) {
      if ((value as NodeJS.ErrnoException).code === 'ENOENT') return
      if (attempt === 4) return
      await delay(250)
    }
  }
}

async function processExternalFile(imagePath: string): Promise<void> {
  const driveRoot = root
  const dbRoot = databaseRoot
  if (!driveRoot || !dbRoot) return
  if (!(await pathExists(imagePath))) return

  const key = imagePath.toLowerCase()
  if (inFlight.has(key)) return
  inFlight.add(key)

  try {
    const extension = extname(imagePath).toLowerCase()
    const sidecarPath = `${imagePath.slice(0, -extname(imagePath).length)}.json`
    const hasSidecar = await pathExists(sidecarPath)
    const route = folderRoute(driveRoot, imagePath)

    if (extension === '.pdf') {
      await reject(
        driveRoot,
        imagePath,
        hasSidecar ? sidecarPath : null,
        '目前不支援 PDF，請上傳 JPG／PNG',
        route
      )
      return
    }
    if (!IMAGE_EXTS.has(extension)) return

    let sidecar: InboxSidecar | null = null
    if (hasSidecar) {
      try {
        sidecar = InboxSidecarSchema.parse(
          JSON.parse(await readFile(sidecarPath, 'utf8'))
        )
      } catch (value) {
        const reason =
          value instanceof ZodError ? formatIssues(value).join('; ') : messageOf(value)
        await reject(
          driveRoot,
          imagePath,
          sidecarPath,
          `sidecar 格式錯誤：${reason}`,
          route
        )
        return
      }
    }

    let classId: string
    let assignmentId: string
    let seat: string

    if (sidecar) {
      if (
        route.classId &&
        route.assignmentId &&
        (sidecar.class_id !== route.classId ||
          sidecar.assignment_id !== route.assignmentId)
      ) {
        await reject(
          driveRoot,
          imagePath,
          sidecarPath,
          `sidecar 指向 ${sidecar.class_id}/${sidecar.assignment_id}，與資料夾 ${route.classId}/${route.assignmentId} 不符`,
          route,
          sidecar.seat
        )
        return
      }
      if (!CLASS_ID_RE.test(sidecar.class_id) || !ASSIGNMENT_ID_RE.test(sidecar.assignment_id)) {
        await reject(
          driveRoot,
          imagePath,
          sidecarPath,
          'sidecar 的班級或作業代號格式不正確',
          route,
          sidecar.seat
        )
        return
      }

      classId = sidecar.class_id
      assignmentId = sidecar.assignment_id
      seat = sidecar.seat
    } else {
      if (!route.classId || !route.assignmentId) {
        await reject(
          driveRoot,
          imagePath,
          null,
          route.flat
            ? '扁平模式缺少 sidecar，無法判斷班級與作業'
            : '資料夾不是 <root>/<classId>/<assignmentId>，且缺少 sidecar',
          route
        )
        return
      }

      const parsed = parseSeatFromFileName(basename(imagePath))
      if (!parsed) {
        await reject(
          driveRoot,
          imagePath,
          null,
          '無法從檔名取得座號（需 S07… 或 07 開頭）',
          route
        )
        return
      }

      classId = route.classId
      assignmentId = route.assignmentId
      seat = parsed
    }

    const targetRoute: FolderRoute = { classId, assignmentId, flat: false }
    const dbAssignmentDir = join(dbRoot, classId, assignmentId)

    let classFile
    try {
      classFile = (
        await readJsonRecovering(join(dbRoot, classId, 'class.json'), ClassSchema)
      ).data
    } catch {
      await reject(
        driveRoot,
        imagePath,
        hasSidecar ? sidecarPath : null,
        `資料庫沒有班級 ${classId}，或 class.json 無法讀取`,
        targetRoute,
        seat
      )
      return
    }

    let assignmentOk = true
    try {
      await readJsonRecovering(join(dbAssignmentDir, 'assignment.json'), AssignmentSchema)
    } catch {
      assignmentOk = false
    }
    if (!assignmentOk) {
      await reject(
        driveRoot,
        imagePath,
        hasSidecar ? sidecarPath : null,
        `資料庫沒有作業 ${classId}/${assignmentId}，或 assignment.json 無法讀取`,
        targetRoute,
        seat
      )
      return
    }

    const student = classFile.students.find(
      (item) => item.seat === seat && item.active
    )
    if (!student) {
      await reject(
        driveRoot,
        imagePath,
        hasSidecar ? sidecarPath : null,
        `座號 ${seat} 不在名單或已註記不在學`,
        targetRoute,
        seat
      )
      return
    }

    const sha = await sha256File(imagePath)
    const duplicateSeat = await findDuplicate(dbAssignmentDir, sha)
    if (duplicateSeat) {
      const reason = `重複檔案（與 ${duplicateSeat} 的頁面相同）`
      await moveToSubfolder(
        driveRoot,
        '_duplicates',
        imagePath,
        hasSidecar ? sidecarPath : null,
        reason,
        { classId, assignmentId, seat, source: 'drive' }
      )
      await emitImportEvent({
        type: 'duplicate',
        source: 'drive',
        classId,
        assignmentId,
        seat,
        file: basename(imagePath),
        message: `Drive：重複檔案，未新增頁面（來源 ${duplicateSeat}）`
      })
      return
    }

    const seatDir = join(dbAssignmentDir, studentFolderId(seat))
    await mkdir(seatDir, { recursive: true })
    const workPath = join(seatDir, 'work.json')

    let work: WorkFile | null = null
    if (await pathExists(workPath)) {
      try {
        work = (await readJsonRecovering(workPath, WorkSchema)).data
      } catch (value) {
        await reject(
          driveRoot,
          imagePath,
          hasSidecar ? sidecarPath : null,
          `work.json 損壞：${messageOf(value)}`,
          targetRoute,
          seat
        )
        return
      }
    }

    const extensionOut = '.jpg'
    let pageIndex = (work?.pages.length ?? 0) + 1
    let fileName = `p${pageIndex}${extensionOut}`
    while (await pathExists(join(seatDir, fileName))) {
      pageIndex += 1
      fileName = `p${pageIndex}${extensionOut}`
    }
    const thumbName = `p${pageIndex}_thumb.webp`
    const targetImage = join(seatDir, fileName)
    const targetThumb = join(seatDir, thumbName)

    let processed: ProcessedImage | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        processed = await preprocessImage(imagePath, targetImage, targetThumb)
        break
      } catch {
        if (attempt === 2) break
        // Drive 同步可能暫時 0 byte 或鎖定，重試 2 次。
        await delay(500)
      }
    }

    if (!processed) {
      try {
        await unlink(targetImage)
      } catch {
        // 可能還沒建立
      }
      await reject(
        driveRoot,
        imagePath,
        hasSidecar ? sidecarPath : null,
        '圖片處理失敗（已重試 2 次），請確認檔案完整後重新上傳',
        targetRoute,
        seat
      )
      return
    }

    const page = {
      id: `p${pageIndex}`,
      file: fileName,
      width: processed.width,
      height: processed.height,
      sha256: sha,
      thumb: thumbName
    }

    const nextWork: WorkFile = work
      ? {
          ...work,
          name: student.name,
          pages: [...work.pages, page],
          updated_at: new Date().toISOString()
        }
      : {
          schema_version: 1,
          class_id: classId,
          assignment_id: assignmentId,
          seat: student.seat,
          name: student.name,
          status: 'pending',
          pages: [page],
          annotations: [],
          updated_at: new Date().toISOString()
        }

    await writeJsonAtomic(workPath, nextWork)

    // 成功後刪除雲端來源，作品不長期留在 Google Drive。
    await removeSource(imagePath)
    if (hasSidecar) await removeSource(sidecarPath)

    await emitImportEvent({
      type: 'imported',
      source: 'drive',
      classId,
      assignmentId,
      seat: student.seat,
      file: fileName,
      message: `Drive：座號 ${student.seat} 第 ${pageIndex} 頁已匯入`
    })
  } finally {
    inFlight.delete(key)
  }
}

function scheduleCandidate(path: string): void {
  const key = path.toLowerCase()
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    timers.delete(key)
    enqueue(() => processExternalFile(path))
  }, GRACE_MS)
  timers.set(key, timer)
}

async function considerFile(path: string): Promise<void> {
  const driveRoot = root
  if (!driveRoot) return
  if (ignoredPath(driveRoot, path)) return

  const extension = extname(path).toLowerCase()
  if (IMAGE_EXTS.has(extension) || extension === '.pdf') {
    scheduleCandidate(path)
    return
  }

  if (extension !== '.json') return

  // sidecar 先到時，等圖片出現再一起處理。
  const base = path.slice(0, -extension.length)
  for (const imageExtension of ['.jpg', '.jpeg', '.png', '.pdf']) {
    const candidate = `${base}${imageExtension}`
    if (await pathExists(candidate)) scheduleCandidate(candidate)
  }
}

export async function startExternalWatcher(
  driveRoot: string | null,
  dbRoot: string | null
): Promise<void> {
  await stopExternalWatcher()
  databaseRoot = dbRoot

  if (!driveRoot) {
    root = null
    return
  }
  root = driveRoot

  try {
    await readdir(driveRoot)
  } catch (value) {
    watching = false
    error = `無法讀取 Google Drive inbox：${messageOf(value)}`
    await emitImportEvent({
      type: 'error',
      source: 'drive',
      message: `Drive：${error}`
    })
    return
  }

  const instance = chokidar.watch(driveRoot, {
    ignoreInitial: false,
    usePolling: true,
    interval: 500,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 500 },
    ignored: (path) => ignoredPath(driveRoot, path)
  })
  watcher = instance

  instance.on('add', (path) => {
    void considerFile(path)
  })
  instance.on('change', (path) => {
    void considerFile(path)
  })
  instance.on('error', (value) => {
    watching = false
    error = `Google Drive inbox 監看錯誤：${messageOf(value)}`
    void emitImportEvent({
      type: 'error',
      source: 'drive',
      message: `Drive：${error}`
    })
  })

  await new Promise<void>((resolve) => instance.once('ready', () => resolve()))
  if (watcher !== instance) {
    await instance.close().catch(() => undefined)
    return
  }

  watching = true
  error = null
  await emitImportEvent({
    type: 'watcher',
    source: 'drive',
    message: `Drive：開始監看外部 inbox：${driveRoot}`
  })
}

export async function stopExternalWatcher(): Promise<void> {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()

  const instance = watcher
  watcher = null
  watching = false
  root = null
  databaseRoot = null
  error = null
  inFlight.clear()

  if (instance) await instance.close().catch(() => undefined)
}

export function getExternalStatus(): {
  root: string | null
  watching: boolean
  error: string | null
} {
  return { root, watching, error }
}

/** 在外部根目錄建立 `<classId>/<assignmentId>/`，方便老師直接到 Drive 上傳。 */
export async function ensureExternalAssignmentFolder(
  classId: string,
  assignmentId: string
): Promise<string> {
  if (!root) {
    throw new Error('尚未設定 Google Drive inbox，請先按「設定／變更」選擇資料夾。')
  }
  const dir = join(root, classId, assignmentId)
  await mkdir(dir, { recursive: true })
  return dir
}
