import { z } from 'zod'
import { mkdir, readdir, readFile, rename, rm, copyFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { logInfo, logWarn } from '../logger'
import { loadClass, saveClass } from '../data/repository'
import { readSettings } from '../data/settings'

const RosterSchema = z.object({
  schema_version: z.literal(1),
  class_id: z.string().regex(/^C[0-9A-Za-z-]+$/),
  class_name: z.string().optional(),
  generated_at: z.string().optional(),
  students: z
    .array(
      z.object({
        seat: z.string(),
        name: z.string().min(1)
      })
    )
    .min(1)
})

export interface IncomingRoster {
  path: string
  file: string
  classId: string
  className: string
  count: number
  generatedAt?: string
  valid: boolean
  error?: string
}

export interface RosterImportResult {
  classId: string
  className: string
  added: number
  updated: number
  total: number
}

const normalizeSeat = (value: string): string | null => {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  return digits.padStart(2, '0').slice(-2)
}

async function rosterDir(): Promise<string> {
  const settings = await readSettings()
  const root = settings.externalInboxRoot
  if (!root) throw new Error('尚未設定 Google Drive inbox')
  return join(root, '_roster')
}

/** 列出外部 inbox `_roster/` 內尚未匯入的名條 JSON。 */
export async function listIncomingRosters(): Promise<IncomingRoster[]> {
  let dir: string
  try {
    dir = await rosterDir()
    await readdir(dir)
  } catch {
    return []
  }

  const entries = await readdir(dir, { withFileTypes: true })
  const result: IncomingRoster[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
    const path = join(dir, entry.name)
    try {
      const parsed = RosterSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      const seats = new Set<string>()
      for (const student of parsed.students) {
        const seat = normalizeSeat(student.seat)
        if (seat) seats.add(seat)
      }
      result.push({
        path,
        file: entry.name,
        classId: parsed.class_id,
        className: parsed.class_name ?? parsed.class_id,
        count: seats.size,
        generatedAt: parsed.generated_at,
        valid: true
      })
    } catch (error) {
      result.push({
        path,
        file: entry.name,
        classId: '',
        className: entry.name,
        count: 0,
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return result.sort((a, b) => a.file.localeCompare(b.file))
}

/** 匯入單一名條檔：同座號更新姓名、新座號新增，完成後移到 `_roster/_imported/`。 */
export async function importIncomingRoster(path: string): Promise<RosterImportResult> {
  const dir = await rosterDir()
  const parsed = RosterSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  const { data: classFile } = await loadClass(parsed.class_id)

  const bySeat = new Map<string, string>()
  for (const student of parsed.students) {
    const seat = normalizeSeat(student.seat)
    if (!seat) continue
    bySeat.set(seat, student.name.trim())
  }
  if (bySeat.size === 0) throw new Error('名條檔沒有有效的座號與姓名')

  let added = 0
  let updated = 0
  for (const [seat, name] of bySeat) {
    const existing = classFile.students.find((student) => student.seat === seat)
    if (existing) {
      if (existing.name !== name) {
        existing.name = name
        updated += 1
      }
    } else {
      classFile.students.push({ seat, name, active: true })
      added += 1
    }
  }
  classFile.students.sort((a, b) => a.seat.localeCompare(b.seat))
  await saveClass(classFile)

  const importedDir = join(dir, '_imported')
  await mkdir(importedDir, { recursive: true })
  const target = join(importedDir, `${basename(path)}`)
  try {
    await rename(path, target)
  } catch {
    await copyFile(path, target)
    await rm(path, { force: true })
  }

  logInfo(`[roster] 匯入名條 ${parsed.class_id}：新增 ${added}、更新 ${updated}（${basename(path)}）`)
  return {
    classId: parsed.class_id,
    className: parsed.class_name ?? parsed.class_id,
    added,
    updated,
    total: bySeat.size
  }
}
