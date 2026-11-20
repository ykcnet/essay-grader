import chokidar, { type FSWatcher } from 'chokidar'
import { app } from 'electron'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  ClassSchema,
  InboxSidecarSchema,
  WorkSchema,
  formatIssues,
  isIgnoredFileName,
  studentFolderId,
  type ImportStatus,
  type WorkFile
} from '@essay-grader/core'
import { ZodError } from 'zod'
import { readJsonRecovering, writeJsonAtomic } from '../data/atomic'
import { readSettings } from '../data/settings'
import { emitImportEvent, getImportEvents, onImportEvent } from './events'
import { getExternalStatus, startExternalWatcher, stopExternalWatcher } from './external'
import { preprocessImage } from './image'
import {
  findDuplicate,
  moveToSubfolder as moveToFolder,
  sha256File,
  stamp
} from './shared'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png'])
const UNMATCHED_GRACE_MS = 1500

const watchers = new Map<string, FSWatcher>()
const timers = new Set<ReturnType<typeof setTimeout>>()
const inFlight = new Set<string>()

let currentRoot: string | null = null
let chain: Promise<void> = Promise.resolve()

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

const emitEvent = emitImportEvent

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((error) => {
    void emitEvent({ type: 'error', message: messageOf(error) })
  })
}

async function processPair(
  inboxDir: string,
  imagePath: string,
  sidecarPath: string
): Promise<void> {
  const assignmentDir = dirname(inboxDir)
  const classDir = dirname(assignmentDir)
  const classId = basename(classDir)
  const assignmentId = basename(assignmentDir)

  let sidecar
  try {
    sidecar = InboxSidecarSchema.parse(JSON.parse(await readFile(sidecarPath, 'utf8')))
  } catch (error) {
    const reason =
      error instanceof ZodError ? formatIssues(error).join('; ') : messageOf(error)
    await moveToFolder(
      inboxDir,
      '_unmatched',
      imagePath,
      sidecarPath,
      `sidecar 格式錯誤：${reason}`,
      { classId, assignmentId, source: 'inbox' }
    )
    await emitEvent({
      type: 'unmatched',
      classId,
      assignmentId,
      file: basename(imagePath),
      message: 'sidecar 格式錯誤，已移到 _unmatched'
    })
    return
  }

  if (sidecar.class_id !== classId || sidecar.assignment_id !== assignmentId) {
    const reason = `sidecar 指向 ${sidecar.class_id}/${sidecar.assignment_id}`
    await moveToFolder(inboxDir, '_unmatched', imagePath, sidecarPath, reason, {
      classId,
      assignmentId,
      seat: sidecar.seat,
      source: 'inbox'
    })
    await emitEvent({
      type: 'unmatched',
      classId,
      assignmentId,
      seat: sidecar.seat,
      file: basename(imagePath),
      message: reason
    })
    return
  }

  let classFile
  try {
    classFile = (
      await readJsonRecovering(join(classDir, 'class.json'), ClassSchema)
    ).data
  } catch (error) {
    await moveToFolder(inboxDir, '_unmatched', imagePath, sidecarPath, messageOf(error), {
      classId,
      assignmentId,
      seat: sidecar.seat,
      source: 'inbox'
    })
    await emitEvent({
      type: 'unmatched',
      classId,
      assignmentId,
      seat: sidecar.seat,
      file: basename(imagePath),
      message: '班級資料讀取失敗'
    })
    return
  }

  const student = classFile.students.find(
    (item) => item.seat === sidecar.seat && item.active
  )
  if (!student) {
    const reason = `座號 ${sidecar.seat} 不在名單`
    await moveToFolder(inboxDir, '_unmatched', imagePath, sidecarPath, reason, {
      classId,
      assignmentId,
      seat: sidecar.seat,
      source: 'inbox'
    })
    await emitEvent({
      type: 'unmatched',
      classId,
      assignmentId,
      seat: sidecar.seat,
      file: basename(imagePath),
      message: reason
    })
    return
  }

  const sha = await sha256File(imagePath)
  const duplicateSeat = await findDuplicate(assignmentDir, sha)
  if (duplicateSeat) {
    await moveToFolder(
      inboxDir,
      '_duplicates',
      imagePath,
      sidecarPath,
      `重複檔案（與 ${duplicateSeat} 的頁面相同）`,
      {
        classId,
        assignmentId,
        seat: sidecar.seat,
        source: 'inbox'
      }
    )
    await emitEvent({
      type: 'duplicate',
      classId,
      assignmentId,
      seat: sidecar.seat,
      file: basename(imagePath),
      message: `重複檔案，已跳過（來源 ${duplicateSeat}）`
    })
    return
  }

  const seatDir = join(assignmentDir, studentFolderId(sidecar.seat))
  await mkdir(seatDir, { recursive: true })
  const workPath = join(seatDir, 'work.json')

  let work: WorkFile | null = null
  if (await pathExists(workPath)) {
    try {
      work = (await readJsonRecovering(workPath, WorkSchema)).data
    } catch (error) {
      await moveToFolder(
        inboxDir,
        '_unmatched',
        imagePath,
        sidecarPath,
        `work.json 損壞：${messageOf(error)}`,
        {
          classId,
          assignmentId,
          seat: sidecar.seat,
          source: 'inbox'
        }
      )
      await emitEvent({
        type: 'error',
        classId,
        assignmentId,
        seat: sidecar.seat,
        message: 'work.json 損壞，已把新檔移到 _unmatched'
      })
      return
    }
  }

  const extension = '.jpg'
  let pageIndex = (work?.pages.length ?? 0) + 1
  let fileName = `p${pageIndex}${extension}`
  while (await pathExists(join(seatDir, fileName))) {
    pageIndex += 1
    fileName = `p${pageIndex}${extension}`
  }
  const thumbName = `p${pageIndex}_thumb.webp`

  let processed
  try {
    processed = await preprocessImage(
      imagePath,
      join(seatDir, fileName),
      join(seatDir, thumbName)
    )
  } catch (error) {
    const reason = `圖片處理失敗：${messageOf(error)}`
    await moveToFolder(inboxDir, '_unmatched', imagePath, sidecarPath, reason, {
      classId,
      assignmentId,
      seat: sidecar.seat,
      source: 'inbox'
    })
    await emitEvent({
      type: 'unmatched',
      classId,
      assignmentId,
      seat: sidecar.seat,
      file: basename(imagePath),
      message: reason
    })
    return
  }

  try {
    await unlink(imagePath)
  } catch {
    // 原檔已不在就算了
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

  try {
    await unlink(sidecarPath)
  } catch {
    // 已不存在就算了
  }

  await emitEvent({
    type: 'imported',
    classId,
    assignmentId,
    seat: student.seat,
    file: fileName,
    message: `${student.seat} ${student.name} 第 ${pageIndex} 頁已匯入`
  })
}

async function handleAdd(inboxDir: string, file: string): Promise<void> {
  const name = basename(file)
  if (isIgnoredFileName(name)) return

  const extension = extname(name).toLowerCase()
  if (!IMAGE_EXTS.has(extension) && extension !== '.json') return

  const key = join(inboxDir, name.slice(0, -extension.length))
  if (inFlight.has(key)) return
  inFlight.add(key)

  try {
    const imageCandidates = ['.jpg', '.jpeg', '.png'].map((ext) => `${key}${ext}`)
    let image: string | null = null
    for (const candidate of imageCandidates) {
      if (await pathExists(candidate)) {
        image = candidate
        break
      }
    }

    const sidecar = `${key}.json`
    const hasSidecar = await pathExists(sidecar)

    if (image && hasSidecar) {
      enqueue(() => processPair(inboxDir, image!, sidecar))
      return
    }

    if (!image) return

    const timer = setTimeout(() => {
      timers.delete(timer)
      void (async () => {
        if (!(await pathExists(image!))) return
        if (await pathExists(sidecar)) {
          enqueue(() => processPair(inboxDir, image!, sidecar))
        } else {
          const classId = basename(dirname(dirname(inboxDir)))
          const assignmentId = basename(dirname(inboxDir))
          await moveToFolder(inboxDir, '_unmatched', image!, null, '缺少 sidecar', {
            classId,
            assignmentId,
            source: 'inbox'
          })
          await emitEvent({
            type: 'unmatched',
            classId,
            assignmentId,
            file: basename(image!),
            message: '缺少 sidecar，已移到 _unmatched'
          })
        }
      })()
    }, UNMATCHED_GRACE_MS)
    timers.add(timer)
  } finally {
    inFlight.delete(key)
  }
}

async function watchInbox(dir: string): Promise<void> {
  if (watchers.has(dir)) return

  const watcher = chokidar.watch(dir, {
    ignoreInitial: false,
    usePolling: true,
    interval: 250,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    ignored: (path) =>
      path.includes('_unmatched') ||
      path.includes('_duplicates') ||
      basename(path).startsWith('.')
  })

  watcher.on('add', (file) => {
    void handleAdd(dir, file)
  })
  watcher.on('error', (error) => {
    void emitEvent({ type: 'error', message: `監看錯誤：${messageOf(error)}` })
  })

  watchers.set(dir, watcher)
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
}

async function listInboxDirs(root: string): Promise<string[]> {
  const dirs: string[] = []
  const classes = await readdir(root, { withFileTypes: true })

  for (const entry of classes) {
    if (!entry.isDirectory() || !/^C[0-9A-Za-z-]+$/.test(entry.name)) continue
    const classDir = join(root, entry.name)
    const assignments = await readdir(classDir, { withFileTypes: true })

    for (const assignment of assignments) {
      if (!assignment.isDirectory() || !/^E\d{8}(-\d{2})?$/.test(assignment.name)) continue
      const inbox = join(classDir, assignment.name, '_inbox')
      try {
        await readdir(inbox)
        dirs.push(inbox)
      } catch {
        // 沒有 inbox 就跳過
      }
    }
  }
  return dirs
}

export async function startImportWatcher(root: string): Promise<void> {
  await stopImportWatcher()
  currentRoot = root

  let dirs: string[] = []
  try {
    dirs = await listInboxDirs(root)
  } catch (error) {
    await emitEvent({ type: 'error', message: `掃描 inbox 失敗：${messageOf(error)}` })
  }

  await Promise.all(dirs.map((dir) => watchInbox(dir)))
  await emitEvent({ type: 'watcher', message: `開始監看 ${dirs.length} 個 inbox` })

  const settings = await readSettings()
  await startExternalWatcher(settings.externalInboxRoot ?? null, root)
}

export async function refreshImportWatcher(): Promise<void> {
  if (!currentRoot) return
  await startImportWatcher(currentRoot)
}

export async function stopImportWatcher(): Promise<void> {
  for (const timer of timers) clearTimeout(timer)
  timers.clear()

  await Promise.all(
    [...watchers.values()].map((watcher) =>
      watcher.close().catch(() => undefined)
    )
  )
  watchers.clear()
  inFlight.clear()
  currentRoot = null
  await stopExternalWatcher()
}

export function getImportStatus(): ImportStatus {
  const external = getExternalStatus()
  return {
    watching: watchers.size,
    events: getImportEvents(),
    externalRoot: external.root,
    externalWatching: external.watching,
    externalError: external.error
  }
}

export { onImportEvent }


export async function ensureInbox(classId: string, assignmentId: string): Promise<string> {
  if (!currentRoot) throw new Error('尚未開啟資料庫')
  const dir = join(currentRoot, classId, assignmentId, '_inbox')
  await mkdir(dir, { recursive: true })
  await watchInbox(dir)
  return dir
}

async function findSimulationImage(): Promise<string> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const candidates = [
    join(repoRoot, 'spike-assets', 'page-2600.jpg'),
    join(repoRoot, 'fixtures', 'C302-2025F', 'E20250107', 'S07', 'p1.jpg')
  ]
  for (const candidate of candidates) {
    try {
      await readFile(candidate)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error('找不到測試圖片，請先執行 tools/make_spike_page.ps1')
}

/** 開發／驗收用：在 inbox 產生 N 份檔案＋sidecar，模擬手機上傳。 */
export async function simulateImport(
  classId: string,
  assignmentId: string,
  count = 10
): Promise<{ written: number; dir: string }> {
  if (!currentRoot) throw new Error('尚未開啟資料庫')
  const inbox = await ensureInbox(classId, assignmentId)

  const classFile = (
    await readJsonRecovering(join(currentRoot, classId, 'class.json'), ClassSchema)
  ).data
  const students = classFile.students.filter((student) => student.active)
  if (students.length === 0) throw new Error('名單沒有在學學生')

  const source = await findSimulationImage()
  const base = await readFile(source)
  const session = stamp().replace('T', '').slice(0, 15)

  for (let index = 0; index < count; index++) {
    const student = students[index % students.length]!
    const seq = Math.floor(index / students.length) + 1
    const key = `S${student.seat}__${session}__${String(seq).padStart(3, '0')}`

    // 附加可忽略的尾端位元組，讓每頁 SHA-256 不同但仍是合法 JPEG
    await writeFile(join(inbox, `${key}.jpg`), Buffer.concat([base, Buffer.from(`\npage-${index}`)]))
    await writeFile(
      join(inbox, `${key}.json`),
      JSON.stringify(
        {
          schema_version: 1,
          class_id: classId,
          assignment_id: assignmentId,
          seat: student.seat,
          seq,
          session_id: session,
          captured_at: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )
  }

  return { written: count, dir: inbox }
}
