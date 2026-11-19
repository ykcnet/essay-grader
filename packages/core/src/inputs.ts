import { z } from 'zod'
import type { WorkStatus } from './schema'

export const CreateClassInputSchema = z.object({
  classNo: z.string().regex(/^\d{1,3}$/, '班號請填 1–3 位數字'),
  name: z.string().min(1, '請填班級名稱'),
  grade: z.enum(['junior', 'senior', 'vocational']),
  academicYear: z.string().regex(/^\d{2,3}$/, '學年度請填民國年，例如 114'),
  semester: z.union([z.literal(1), z.literal(2)]),
  teacher: z.string().optional()
})
export type CreateClassInput = z.infer<typeof CreateClassInputSchema>

export const CreateAssignmentInputSchema = z.object({
  classId: z.string().min(1),
  title: z.string().min(1, '請填作文題目'),
  prompt: z.string().default(''),
  genre: z.string().optional(),
  wordLimit: z.number().int().positive().optional(),
  dueAt: z.string().optional(),
  rubricPreset: z
    .enum(['balanced', 'content', 'language', 'junior', 'senior', 'vocational'])
    .default('balanced')
})
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentInputSchema>

export interface ClassSummary {
  id: string
  name: string
  grade: 'junior' | 'senior' | 'vocational'
  studentCount: number
}

export interface AssignmentSummary {
  id: string
  title: string
  dueAt?: string
  rubricId: string
}

export interface DatabaseState {
  root: string | null
  classes: ClassSummary[]
  warnings: string[]
}

export interface WorkSummary {
  seat: string
  name: string
  status: WorkStatus
  pages: number
  updatedAt: string
  /** 是否已有分數；調整量規前用來判斷是否需要確認。 */
  hasScores: boolean
}

export type ImportEventType = 'imported' | 'duplicate' | 'unmatched' | 'error' | 'watcher'

export interface ImportEvent {
  id: string
  at: string
  type: ImportEventType
  message: string
  classId?: string
  assignmentId?: string
  seat?: string
  file?: string
}

export interface ImportStatus {
  watching: number
  events: ImportEvent[]
}
