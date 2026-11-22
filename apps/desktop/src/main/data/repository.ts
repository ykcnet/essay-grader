import { shell } from 'electron'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import {
  AssignmentSchema,
  ClassSchema,
  CreateAssignmentInputSchema,
  CreateClassInputSchema,
  RUBRIC_PRESETS,
  RubricSchema,
  WorkSchema,
  assignmentCollisionId,
  assignmentFolderId,
  classFolderId,
  formatIssues,
  FINAL_SIMILARITY_THRESHOLD,
  findSimilarFinalComments,
  normalizeComment,
  sortGradeBands,
  validateGradeBands,
  appendMissingPageIssues,
  auditWorks,
  buildAssignmentStats,
  buildPraiseBank,
  compareAssignmentStats,
  statsToCsvFiles,
  type AssignmentAudit,
  type AssignmentComparison,
  type AssignmentFile,
  type AssignmentStats,
  type AssignmentSummary,
  type ClassFile,
  type ClassSummary,
  type CreateAssignmentInput,
  type CreateClassInput,
  type DatabaseState,
  type FinalReuseResult,
  type LibraryUsage,
  type PraiseAssignmentInfo,
  type PraiseBank,
  type Rubric,
  type WorkFile,
  type WorkSummary
} from '@essay-grader/core'
import { ZodError } from 'zod'
import { startImportWatcher, stopImportWatcher } from '../import/watcher'
import { logInfo, logWarn } from '../logger'
import { readJsonRecovering, writeJsonAtomic } from './atomic'
import { acquireLock, type DatabaseLock } from './lock'
import { writeSettings } from './settings'

const CLASS_DIR = /^C[0-9A-Za-z-]+$/
const ASSIGNMENT_DIR = /^E\d{8}(-\d{2})?$/

interface OpenDatabase {
  root: string
  lock: DatabaseLock
}

let current: OpenDatabase | null = null

function toMessage(error: unknown): string {
  if (error instanceof ZodError) return formatIssues(error).join('\n')
  return error instanceof Error ? error.message : String(error)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function requireRoot(): string {
  if (!current) throw new Error('尚未開啟資料庫')
  return current.root
}

export function currentRoot(): string | null {
  return current?.root ?? null
}

export async function openDatabase(
  root: string,
  options: { remember?: boolean } = {}
): Promise<DatabaseState> {
  const normalized = resolve(root)
  if (current?.root === normalized) return getState()

  if (current) await closeDatabase()

  await mkdir(normalized, { recursive: true })
  const lock = await acquireLock(normalized)
  current = { root: normalized, lock }
  if (options.remember !== false) {
    await writeSettings({ lastDatabase: normalized })
  }

  try {
    await startImportWatcher(normalized)
  } catch (error) {
    logWarn(`[import] watcher 啟動失敗：${toMessage(error)}`)
  }

  logInfo('資料庫已開啟，鎖已取得')
  return getState()
}

export async function closeDatabase(): Promise<void> {
  if (!current) return
  const { lock } = current
  current = null
  await stopImportWatcher()
  await lock.release()
  logInfo('資料庫已關閉，鎖已釋放')
}

export async function autoOpenLastDatabase(last: string | undefined): Promise<void> {
  if (!last) return
  try {
    await openDatabase(last)
  } catch (error) {
    logWarn(`[db] 無法自動開啟上次的資料庫：${toMessage(error)}`)
  }
}

export async function revealDatabase(): Promise<void> {
  await shell.openPath(requireRoot())
}

export async function getState(): Promise<DatabaseState> {
  if (!current) return { root: null, classes: [], warnings: [] }

  const { root } = current
  const entries = await readdir(root, { withFileTypes: true })
  const warnings: string[] = []
  const classes: ClassSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !CLASS_DIR.test(entry.name)) continue

    try {
      const { data, recovered } = await readJsonRecovering(
        join(root, entry.name, 'class.json'),
        ClassSchema
      )
      if (recovered) warnings.push(`${entry.name}：主檔損壞，已從 .bak 還原`)
      classes.push({
        id: data.id,
        name: data.name,
        grade: data.grade,
        studentCount: data.students.length
      })
    } catch (error) {
      warnings.push(`${entry.name}：${toMessage(error)}`)
    }
  }

  classes.sort((a, b) => a.id.localeCompare(b.id))
  return { root, classes, warnings }
}

export async function listClasses(): Promise<ClassSummary[]> {
  return (await getState()).classes
}

export async function createClass(input: CreateClassInput): Promise<ClassSummary> {
  const root = requireRoot()
  const parsed = CreateClassInputSchema.parse(input)

  const gregorianYear = Number(parsed.academicYear) + 1911
  const id = classFolderId(parsed.classNo, String(gregorianYear), parsed.semester)
  const dir = join(root, id)

  if (await pathExists(dir)) {
    throw new Error(`班級 ${id} 已存在，請改用其他班號或學年度。`)
  }

  const file: ClassFile = ClassSchema.parse({
    schema_version: 1,
    id,
    name: parsed.name,
    grade: parsed.grade,
    academic_year: parsed.academicYear,
    semester: parsed.semester,
    teacher: parsed.teacher,
    students: []
  })

  await mkdir(dir, { recursive: true })
  await writeJsonAtomic(join(dir, 'class.json'), file)

  return {
    id: file.id,
    name: file.name,
    grade: file.grade,
    studentCount: file.students.length
  }
}

export async function loadClass(id: string): Promise<{ data: ClassFile; warning?: string }> {
  const root = requireRoot()
  const result = await readJsonRecovering(join(root, id, 'class.json'), ClassSchema)
  return { data: result.data, warning: result.warning }
}

export async function saveClass(input: ClassFile): Promise<ClassSummary> {
  const root = requireRoot()
  const parsed = ClassSchema.parse(input)
  await writeJsonAtomic(join(root, parsed.id, 'class.json'), parsed)
  return {
    id: parsed.id,
    name: parsed.name,
    grade: parsed.grade,
    studentCount: parsed.students.length
  }
}

export async function listAssignments(classId: string): Promise<AssignmentSummary[]> {
  const root = requireRoot()
  const classDir = join(root, classId)
  const entries = await readdir(classDir, { withFileTypes: true })
  const assignments: AssignmentSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !ASSIGNMENT_DIR.test(entry.name)) continue

    try {
      const { data } = await readJsonRecovering(
        join(classDir, entry.name, 'assignment.json'),
        AssignmentSchema
      )
      assignments.push({
        id: data.id,
        title: data.title,
        dueAt: data.due_at,
        rubricId: data.rubric.id
      })
    } catch (error) {
      logWarn(`[db] 略過 ${entry.name}：${toMessage(error)}`)
    }
  }

  assignments.sort((a, b) => a.id.localeCompare(b.id))
  return assignments
}

export async function createAssignment(input: CreateAssignmentInput): Promise<AssignmentSummary> {
  const root = requireRoot()
  const parsed = CreateAssignmentInputSchema.parse(input)
  const classDir = join(root, parsed.classId)

  if (!(await pathExists(join(classDir, 'class.json')))) {
    throw new Error(`找不到班級 ${parsed.classId}`)
  }

  const due = parsed.dueAt ? new Date(parsed.dueAt) : new Date()
  const base = assignmentFolderId(Number.isNaN(due.getTime()) ? new Date() : due)

  let id = base
  let index = 1
  while (await pathExists(join(classDir, id))) {
    index += 1
    id = assignmentCollisionId(base, index)
  }

  const file: AssignmentFile = AssignmentSchema.parse({
    schema_version: 1,
    id,
    title: parsed.title,
    prompt: parsed.prompt,
    genre: parsed.genre,
    word_limit: parsed.wordLimit,
    due_at: parsed.dueAt,
    rubric: RUBRIC_PRESETS[parsed.rubricPreset],
    rules: { final_min_chars: 30, final_max_reuse: 2 }
  })

  await mkdir(join(classDir, id), { recursive: true })
  await writeJsonAtomic(join(classDir, id, 'assignment.json'), file)

  return {
    id: file.id,
    title: file.title,
    dueAt: file.due_at,
    rubricId: file.rubric.id
  }
}

export async function loadAssignment(
  classId: string,
  assignmentId: string
): Promise<{ data: AssignmentFile; warning?: string }> {
  const root = requireRoot()
  const result = await readJsonRecovering(
    join(root, classId, assignmentId, 'assignment.json'),
    AssignmentSchema
  )
  return { data: result.data, warning: result.warning }
}

/**
 * 只更新作業量規，不動任何 work.json。
 * 分項合計必須為 100；等第門檻需通過共用驗證，寫入前依最低分由高到低排序。
 * 既有分數與等第由呼叫端自行決定是否重算。
 */
export async function updateAssignmentRubric(
  classId: string,
  assignmentId: string,
  rubric: Rubric
): Promise<AssignmentFile> {
  const root = requireRoot()

  const rawGrades = Array.isArray(rubric?.grades) ? rubric.grades : []
  const gradeErrors = validateGradeBands(rawGrades)
  if (gradeErrors.length > 0) {
    throw new Error(`等第門檻設定有誤：${gradeErrors.join('；')}`)
  }

  const grades = sortGradeBands(rawGrades).map((grade) => ({
    label: grade.label.trim(),
    min: grade.min
  }))
  const parsed = RubricSchema.parse({ ...rubric, grades })
  const total = parsed.items.reduce((sum, item) => sum + item.max, 0)

  if (Math.abs(total - 100) > 1e-6) {
    throw new Error(`量規分項合計必須為 100（目前 ${total}）`)
  }

  const assignmentPath = join(root, classId, assignmentId, 'assignment.json')
  const { data } = await readJsonRecovering(assignmentPath, AssignmentSchema)
  const next = AssignmentSchema.parse({ ...data, rubric: parsed })

  await writeJsonAtomic(assignmentPath, next)
  return next
}

export async function listWorks(
  classId: string,
  assignmentId: string
): Promise<WorkSummary[]> {
  const root = requireRoot()
  const dir = join(root, classId, assignmentId)
  const entries = await readdir(dir, { withFileTypes: true })
  const works: WorkSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^S\d{2}$/.test(entry.name)) continue

    try {
      const workPath = join(dir, entry.name, 'work.json')
      if (!(await pathExists(workPath))) continue
      const { data } = await readJsonRecovering(workPath, WorkSchema)
      works.push({
        seat: data.seat,
        name: data.name,
        status: data.status,
        pages: data.pages.length,
        updatedAt: data.updated_at,
        hasScores: Boolean(data.scores)
      })
    } catch (error) {
      logWarn(`[db] 略過 ${entry.name}/work.json：${toMessage(error)}`)
    }
  }

  works.sort((a, b) => a.seat.localeCompare(b.seat))
  return works
}

export async function loadWork(
  classId: string,
  assignmentId: string,
  seat: string
): Promise<WorkFile> {
  const root = requireRoot()
  const result = await readJsonRecovering(
    join(root, classId, assignmentId, `S${seat}`, 'work.json'),
    WorkSchema
  )
  return result.data
}

export async function saveWork(
  classId: string,
  assignmentId: string,
  seat: string,
  input: WorkFile
): Promise<WorkSummary> {
  const root = requireRoot()
  const work = WorkSchema.parse(input)

  if (
    work.class_id !== classId ||
    work.assignment_id !== assignmentId ||
    work.seat !== seat
  ) {
    throw new Error('作品路徑與內容不符')
  }

  await writeJsonAtomic(
    join(root, classId, assignmentId, `S${seat}`, 'work.json'),
    work
  )

  return {
    seat: work.seat,
    name: work.name,
    status: work.status,
    pages: work.pages.length,
    updatedAt: work.updated_at,
    hasScores: Boolean(work.scores)
  }
}

export async function readWorkPage(
  classId: string,
  assignmentId: string,
  seat: string,
  pageId: string
): Promise<{ dataUrl: string; width: number; height: number }> {
  const root = requireRoot()
  const work = await loadWork(classId, assignmentId, seat)
  const page = work.pages.find((item) => item.id === pageId)
  if (!page) throw new Error(`找不到頁面 ${pageId}`)

  const buffer = await readFile(
    join(root, classId, assignmentId, `S${seat}`, page.file)
  )
  const mime = extname(page.file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'

  return {
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    width: page.width,
    height: page.height
  }
}

export async function countFinalReuse(
  classId: string,
  assignmentId: string,
  seat: string,
  text: string
): Promise<FinalReuseResult> {
  const root = requireRoot()
  const normalized = normalizeComment(text)
  if (!normalized) return { count: 0, seats: [], matches: [] }

  const dir = join(root, classId, assignmentId)
  const entries = await readdir(dir, { withFileTypes: true })
  const candidates: { seat: string; text: string }[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^S\d{2}$/.test(entry.name)) continue
    if (entry.name === `S${seat}`) continue

    try {
      const { data } = await readJsonRecovering(
        join(dir, entry.name, 'work.json'),
        WorkSchema
      )
      candidates.push({ seat: data.seat, text: data.final_comment?.text ?? '' })
    } catch {
      continue
    }
  }

  const matches = findSimilarFinalComments(
    text,
    candidates,
    FINAL_SIMILARITY_THRESHOLD
  )

  return {
    count: matches.length,
    seats: matches.map((match) => match.seat),
    matches
  }
}

/**
 * 評語使用次數與最後使用時間：只讀 work.json，不寫檔也不維護計數器。
 * annotation.library_id 每出現一次算 1 次，時間用 annotation.created_at；
 * final_comment.library_id 算 1 次，時間用該 work.updated_at。
 * 同一條取最新的時間（max）；current 只算目前作業，overall 掃同班所有作業；
 * 損壞的 work.json 略過並記錄 warning，時間不合法時忽略、不讓統計失敗。
 */
export async function getLibraryUsage(
  classId: string,
  assignmentId: string
): Promise<LibraryUsage> {
  const root = requireRoot()
  const classDir = join(root, classId)
  const entries = await readdir(classDir, { withFileTypes: true })
  const current: Record<string, number> = {}
  const overall: Record<string, number> = {}
  const currentLastUsed: Record<string, string> = {}
  const overallLastUsed: Record<string, string> = {}

  const assignmentDirs = entries
    .filter((entry) => entry.isDirectory() && ASSIGNMENT_DIR.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const toMs = (value: unknown): number | null => {
    if (typeof value !== 'string' || value.length === 0) return null
    const ts = Date.parse(value)
    return Number.isFinite(ts) ? ts : null
  }

  /** 取兩者中較新（毫秒較大）的原始字串；無效時間視為不存在。 */
  const maxTime = (a: string | undefined, b: string | undefined): string | undefined => {
    const aMs = toMs(a)
    const bMs = toMs(b)
    if (aMs === null) return bMs === null ? undefined : b
    if (bMs === null) return a
    return aMs >= bMs ? a : b
  }

  const mergeCount = (
    target: Record<string, number>,
    source: Record<string, number>
  ): void => {
    for (const [id, count] of Object.entries(source)) {
      target[id] = (target[id] ?? 0) + count
    }
  }

  const mergeTime = (
    target: Record<string, string>,
    source: Record<string, string>
  ): void => {
    for (const [id, at] of Object.entries(source)) {
      target[id] = maxTime(target[id], at) as string
    }
  }

  const readUsageWork = async (path: string, label: string): Promise<WorkFile | null> => {
    try {
      const parsed = WorkSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      if (!parsed.success) {
        logWarn(`[library] 略過 ${label}：格式不符`)
        return null
      }
      return parsed.data
    } catch (error) {
      logWarn(`[library] 略過 ${label}：${toMessage(error)}`)
      return null
    }
  }

  for (const name of assignmentDirs) {
    const dir = join(classDir, name)
    let seats: Dirent[]
    try {
      seats = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      logWarn(`[library] 略過作業 ${name}：${toMessage(error)}`)
      continue
    }

    const workSeats = seats
      .filter((entry) => entry.isDirectory() && /^S\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()

    for (const seat of workSeats) {
      const label = `${name}/${seat}/work.json`
      const work = await readUsageWork(join(dir, seat, 'work.json'), label)
      if (!work) continue

      const counts: Record<string, number> = {}
      const times: Record<string, string> = {}
      const track = (id: string | undefined, at: string | undefined): void => {
        if (!id) return
        counts[id] = (counts[id] ?? 0) + 1
        times[id] = maxTime(times[id], at) as string
      }

      for (const annotation of work.annotations) {
        track(annotation.library_id, annotation.created_at)
      }
      track(work.final_comment?.library_id, work.updated_at)

      mergeCount(overall, counts)
      mergeTime(overallLastUsed, times)
      if (name === assignmentId) {
        mergeCount(current, counts)
        mergeTime(currentLastUsed, times)
      }
    }
  }

  return { current, overall, currentLastUsed, overallLastUsed }
}

/**
 * G6 佳句庫：只讀不寫，跨作業收集 category='praise' 批注並去識別。
 * classId 有值時只掃該班所有作業；否則掃資料庫根目錄下所有合法班級與作業。
 * 讀不到 assignment.json 的作業會跳過並記 warning；work.json 損壞同樣略過。
 * 只收集 status='done' 的作品（由 core 的 buildPraiseBank 處理）。
 */
export async function getPraiseBank(classId?: string): Promise<PraiseBank> {
  const root = requireRoot()

  const classIds: string[] = []
  if (classId) {
    if (!CLASS_DIR.test(classId)) throw new Error(`班級 id 格式不正確：${classId}`)
    if (!(await pathExists(join(root, classId, 'class.json')))) {
      throw new Error(`找不到班級 ${classId}`)
    }
    classIds.push(classId)
  } else {
    const classEntries = await readdir(root, { withFileTypes: true })
    for (const entry of classEntries) {
      if (!entry.isDirectory() || !CLASS_DIR.test(entry.name)) continue
      if (await pathExists(join(root, entry.name, 'class.json'))) classIds.push(entry.name)
    }
  }

  const works: WorkFile[] = []
  const assignments = new Map<string, PraiseAssignmentInfo>()

  for (const cid of classIds) {
    const classDir = join(root, cid)
    const entries = await readdir(classDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory() || !ASSIGNMENT_DIR.test(entry.name)) continue

      let info: PraiseAssignmentInfo
      try {
        const { data } = await readJsonRecovering(
          join(classDir, entry.name, 'assignment.json'),
          AssignmentSchema
        )
        info = { title: data.title, ...(data.due_at ? { due_at: data.due_at } : {}) }
        assignments.set(data.id, info)
      } catch (error) {
        logWarn(`[praise] 略過作業 ${cid}/${entry.name}：${toMessage(error)}`)
        continue
      }

      const workEntries = await readdir(join(classDir, entry.name), { withFileTypes: true })
      for (const workEntry of workEntries) {
        if (!workEntry.isDirectory() || !/^S\d{2}$/.test(workEntry.name)) continue

        const workPath = join(classDir, entry.name, workEntry.name, 'work.json')
        if (!(await pathExists(workPath))) continue

        try {
          const { data } = await readJsonRecovering(workPath, WorkSchema)
          works.push(data)
        } catch (error) {
          logWarn(`[praise] 略過 ${cid}/${entry.name}/${workEntry.name}/work.json：${toMessage(error)}`)
        }
      }
    }
  }

  return buildPraiseBank(works, assignments)
}

/**
 * 作業層級的批次檢查：讀班級、作業與所有 work.json，
 * 由 core 跑規則，再用 fs 補「有頁面紀錄但圖片不存在」。
 */
export async function auditAssignment(
  classId: string,
  assignmentId: string
): Promise<AssignmentAudit> {
  const root = requireRoot()
  const [classResult, assignmentResult] = await Promise.all([
    loadClass(classId),
    loadAssignment(classId, assignmentId)
  ])

  const dir = join(root, classId, assignmentId)
  const entries = await readdir(dir, { withFileTypes: true })
  const works: WorkFile[] = []
  const missingBySeat = new Map<string, string[]>()

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^S\d{2}$/.test(entry.name)) continue

    const workPath = join(dir, entry.name, 'work.json')
    if (!(await pathExists(workPath))) continue

    try {
      const { data } = await readJsonRecovering(workPath, WorkSchema)
      works.push(data)

      const missing: string[] = []
      for (const page of data.pages) {
        if (!(await pathExists(join(dir, entry.name, page.file)))) {
          missing.push(page.file)
        }
      }
      if (missing.length > 0) missingBySeat.set(data.seat, missing)
    } catch (error) {
      logWarn(`[audit] 略過 ${entry.name}/work.json：${toMessage(error)}`)
    }
  }

  const audit = auditWorks(assignmentResult.data, classResult.data.students, works)
  return appendMissingPageIssues(audit, missingBySeat)
}

/**
 * 作業層級統計：只讀資料，不改任何檔案。
 * 統計範圍由 core 決定（已批作品），未完成與未匯入仍會列在個人表。
 */
export async function getAssignmentStats(
  classId: string,
  assignmentId: string
): Promise<AssignmentStats> {
  const root = requireRoot()
  const [classResult, assignmentResult] = await Promise.all([
    loadClass(classId),
    loadAssignment(classId, assignmentId)
  ])

  const dir = join(root, classId, assignmentId)
  const entries = await readdir(dir, { withFileTypes: true })
  const works: WorkFile[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^S\d{2}$/.test(entry.name)) continue

    const workPath = join(dir, entry.name, 'work.json')
    if (!(await pathExists(workPath))) continue

    try {
      const { data } = await readJsonRecovering(workPath, WorkSchema)
      works.push(data)
    } catch (error) {
      logWarn(`[stats] 略過 ${entry.name}/work.json：${toMessage(error)}`)
    }
  }

  return buildAssignmentStats(assignmentResult.data, classResult.data.students, works)
}

async function requireAssignmentForCompare(
  root: string,
  classId: string,
  assignmentId: string,
  label: string
): Promise<AssignmentFile> {
  if (!ASSIGNMENT_DIR.test(assignmentId)) {
    throw new Error(`${label}作業 id 格式不正確：${assignmentId}`)
  }

  const assignmentPath = join(root, classId, assignmentId, 'assignment.json')
  if (!(await pathExists(assignmentPath))) {
    throw new Error(`找不到${label}作業 ${assignmentId}`)
  }

  const { data } = await loadAssignment(classId, assignmentId)
  if (data.id !== assignmentId) {
    throw new Error(`${label}作業 ${assignmentId} 的內容與資料夾不符`)
  }
  return data
}

/**
 * G4：比較同班兩份作業的統計。
 * 兩份作業都必須存在且位於同一班級資料夾；不允許拿同一份跟自己比。
 */
export async function compareAssignments(
  classId: string,
  currentId: string,
  previousId: string
): Promise<AssignmentComparison> {
  const root = requireRoot()

  if (!CLASS_DIR.test(classId)) throw new Error(`班級 id 格式不正確：${classId}`)
  if (!(await pathExists(join(root, classId, 'class.json')))) {
    throw new Error(`找不到班級 ${classId}`)
  }
  if (!currentId || !previousId) throw new Error('請選擇目前作業與上次作業')
  if (currentId === previousId) {
    throw new Error('目前作業與上次作業不能是同一份')
  }

  await Promise.all([
    requireAssignmentForCompare(root, classId, currentId, '目前'),
    requireAssignmentForCompare(root, classId, previousId, '上次')
  ])

  const [currentStats, previousStats] = await Promise.all([
    getAssignmentStats(classId, currentId),
    getAssignmentStats(classId, previousId)
  ])

  return compareAssignmentStats(currentStats, previousStats)
}

export interface StatsExportResult {
  dir: string
  files: string[]
  generatedAt: string
}

/** 把統計寫成四個 CSV，固定放在作業資料夾的 `_stats/`。 */
export async function exportAssignmentStats(
  classId: string,
  assignmentId: string
): Promise<StatsExportResult> {
  const root = requireRoot()
  const stats = await getAssignmentStats(classId, assignmentId)
  const dir = join(root, classId, assignmentId, '_stats')

  await mkdir(dir, { recursive: true })

  const files = statsToCsvFiles(stats)
  for (const file of files) {
    const path = join(dir, file.name)
    const tmp = `${path}.tmp`
    await writeFile(tmp, file.content, 'utf8')
    await rename(tmp, path)
  }

  return {
    dir,
    files: files.map((file) => file.name),
    generatedAt: stats.generatedAt
  }
}
