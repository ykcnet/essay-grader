import { shell } from 'electron'
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
  normalizeComment,
  sortGradeBands,
  validateGradeBands,
  appendMissingPageIssues,
  auditWorks,
  buildAssignmentStats,
  statsToCsvFiles,
  type AssignmentAudit,
  type AssignmentFile,
  type AssignmentStats,
  type AssignmentSummary,
  type ClassFile,
  type ClassSummary,
  type CreateAssignmentInput,
  type CreateClassInput,
  type DatabaseState,
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
): Promise<{ count: number; seats: string[] }> {
  const root = requireRoot()
  const normalized = normalizeComment(text)
  if (!normalized) return { count: 0, seats: [] }

  const dir = join(root, classId, assignmentId)
  const entries = await readdir(dir, { withFileTypes: true })
  const seats: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^S\d{2}$/.test(entry.name)) continue
    if (entry.name === `S${seat}`) continue

    try {
      const { data } = await readJsonRecovering(
        join(dir, entry.name, 'work.json'),
        WorkSchema
      )
      if (normalizeComment(data.final_comment?.text ?? '') === normalized) {
        seats.push(data.seat)
      }
    } catch {
      continue
    }
  }

  seats.sort()
  return { count: seats.length, seats }
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
