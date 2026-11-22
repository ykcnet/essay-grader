import { z } from 'zod'
import {
  ANNOTATION_CATEGORIES,
  SCHEMA_VERSION,
  type AnnotationCategory
} from './constants'

/** 所有 JSON 都帶版本號，日後遷移才有依據。 */
export { SCHEMA_VERSION, LIBRARY_VERSION } from './constants'

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

/** 座號固定兩位字串，避免 `7` 與 `07` 變成兩個資料夾。 */
export const SeatSchema = z
  .string()
  .regex(/^\d{2}$/, '座號必須是兩位數字，例如 "07"')
export type Seat = z.infer<typeof SeatSchema>

/** ISO 8601 字串（含時區位移），不在此驗證格式細節。 */
const TimestampSchema = z.string().min(1)

/** 0～1 正規化座標，換解析度不跑位。 */
const UnitSchema = z.number().min(0).max(1)

export const AnchorSchema = z.object({
  x: UnitSchema,
  y: UnitSchema
})
export type Anchor = z.infer<typeof AnchorSchema>

// ---------------------------------------------------------------------------
// 班級
// ---------------------------------------------------------------------------

export const StudentSchema = z.object({
  seat: SeatSchema,
  name: z.string().min(1),
  active: z.boolean().default(true)
})
export type Student = z.infer<typeof StudentSchema>

export const ClassSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^C[0-9A-Za-z-]+$/, '班級資料夾需為 C{班號}-{學期}'),
  name: z.string().min(1),
  grade: z.enum(['junior', 'senior', 'vocational']),
  academic_year: z.string().min(1),
  semester: z.union([z.literal(1), z.literal(2)]),
  teacher: z.string().optional(),
  students: z.array(StudentSchema)
})
export type ClassFile = z.infer<typeof ClassSchema>

// ---------------------------------------------------------------------------
// 作業與量規
// ---------------------------------------------------------------------------

export const RubricItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  max: z.number().positive()
})

export const DeductionSchema = z.object({
  /** 每個錯字扣幾分 */
  typo_per: z.number().min(0),
  /** 每處標點錯誤扣幾分 */
  punct_per: z.number().min(0),
  /** 扣分上限，避免總分被扣成負數 */
  cap: z.number().min(0).max(100)
})

export const GradeBandSchema = z.object({
  label: z.string().min(1),
  min: z.number().min(0).max(100)
})
export type GradeBand = z.infer<typeof GradeBandSchema>

export const RubricSchema = z.object({
  id: z.string().min(1),
  items: z.array(RubricItemSchema).min(1),
  deduction: DeductionSchema,
  grades: z.array(GradeBandSchema).min(1)
})
export type Rubric = z.infer<typeof RubricSchema>

export const AssignmentSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^E\d{8}(-\d{2})?$/, '作業資料夾需為 E{YYYYMMDD}，撞名加 -02'),
  title: z.string().min(1),
  prompt: z.string().default(''),
  genre: z.string().optional(),
  word_limit: z.number().int().positive().optional(),
  due_at: TimestampSchema.optional(),
  rubric: RubricSchema,
  rules: z
    .object({
      /** 總評去空白與標點後的最少字數 */
      final_min_chars: z.number().int().min(0).default(30),
      /** 同一份作業總評可重複使用的次數 */
      final_max_reuse: z.number().int().min(1).default(2)
    })
    .default({ final_min_chars: 30, final_max_reuse: 2 })
})
export type AssignmentFile = z.infer<typeof AssignmentSchema>

// ---------------------------------------------------------------------------
// 批注
// ---------------------------------------------------------------------------

export const AnnotationCategorySchema = z.enum(ANNOTATION_CATEGORIES)

export const ShapeSchema = z.object({
  type: z.enum(['pin', 'underline', 'box']),
  x: UnitSchema,
  y: UnitSchema,
  w: UnitSchema,
  h: UnitSchema
})
export type Shape = z.infer<typeof ShapeSchema>

/**
 * 結構化欄位。
 * - 錯字：wrong / correct
 * - 詞句不通順：original / revised / reason
 */
export const AnnotationMetaSchema = z.object({
  wrong: z.string().optional(),
  correct: z.string().optional(),
  original: z.string().optional(),
  revised: z.string().optional(),
  reason: z.string().optional()
})
export type AnnotationMeta = z.infer<typeof AnnotationMetaSchema>

export const AnnotationSchema = z.object({
  id: z.string().min(1),
  page_id: z.string().min(1),
  anchor: AnchorSchema,
  shape: ShapeSchema.optional(),
  category: AnnotationCategorySchema,
  subtype: z.string().optional(),
  text: z.string(),
  library_id: z.string().optional(),
  library_version: z.string().optional(),
  meta: AnnotationMetaSchema.optional(),
  created_at: TimestampSchema
})
export type Annotation = z.infer<typeof AnnotationSchema>

// ---------------------------------------------------------------------------
// 評分
// ---------------------------------------------------------------------------

export const ScoresSchema = z.object({
  items: z.record(z.string(), z.number().min(0)),
  deduction: z.object({
    typo: z.number().min(0),
    punct: z.number().min(0),
    /** 非 null 時覆寫自動扣分 */
    override: z.number().min(0).nullable()
  }),
  total: z.number().min(0).max(100),
  grade: z.string().optional()
})
export type Scores = z.infer<typeof ScoresSchema>

// ---------------------------------------------------------------------------
// 學生作品
// ---------------------------------------------------------------------------

export const PageSchema = z.object({
  id: z.string().regex(/^p\d+$/),
  file: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().length(64).optional(),
  thumb: z.string().min(1).optional()
})
export type Page = z.infer<typeof PageSchema>

export const WorkStatusSchema = z.enum(['pending', 'grading', 'done'])
export type WorkStatus = z.infer<typeof WorkStatusSchema>

export const WorkSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  class_id: z.string().min(1),
  assignment_id: z.string().min(1),
  seat: SeatSchema,
  name: z.string().min(1),
  status: WorkStatusSchema,
  pages: z.array(PageSchema).min(1),
  annotations: z.array(AnnotationSchema).default([]),
  scores: ScoresSchema.optional(),
  final_comment: z
    .object({
      text: z.string(),
      library_id: z.string().optional(),
      library_version: z.string().optional()
    })
    .optional(),
  updated_at: TimestampSchema
})
export type WorkFile = z.infer<typeof WorkSchema>

/** 手機寫入 `_inbox` 時附帶的 sidecar，桌面端靠它配對，不猜檔名。 */
export const InboxSidecarSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  class_id: z.string().min(1),
  assignment_id: z.string().min(1),
  seat: SeatSchema,
  seq: z.number().int().positive().default(1),
  session_id: z.string().min(1),
  captured_at: TimestampSchema
})
export type InboxSidecar = z.infer<typeof InboxSidecarSchema>

// ---------------------------------------------------------------------------
// 評語庫
// ---------------------------------------------------------------------------

export const LibraryEntrySchema = z.object({
  id: z.string().min(1),
  category: AnnotationCategorySchema,
  subtype: z.string().default('general'),
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
  disabled: z.boolean().default(false),
  source: z.enum(['builtin', 'custom']).default('builtin')
})
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>

export const LibrarySchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  library_version: z.string().min(1),
  locale: z.string().min(1),
  entries: z.array(LibraryEntrySchema)
})
export type LibraryFile = z.infer<typeof LibrarySchema>

/**
 * 自訂評語檔案，存在資料庫根目錄的 `_library/{junior|senior}.json`。
 * `entries` 只存自訂條目（source 一律 custom）；`imported` 存匯入的新版內建
 * （source 一律 builtin、disabled=false）；`imported_version` 記錄匯入版本。
 * 舊檔沒有 imported／imported_version 時，imported 為空、版本未設定。
 */
export const CustomLibrarySchema = z.object({
  schema_version: z.literal(1),
  library_id: z.enum(['junior', 'senior']),
  entries: z.array(LibraryEntrySchema),
  imported: z.array(LibraryEntrySchema).default([]),
  imported_version: z.string().optional(),
  updated_at: TimestampSchema
})
export type CustomLibraryFile = z.infer<typeof CustomLibrarySchema>

// ---------------------------------------------------------------------------
// 成績表寫回（E6）
// ---------------------------------------------------------------------------

export const GradebookConfigSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  gradebook: z.object({
    path: z.string().min(1),
    sheet: z.string().min(1),
    header_row: z.number().int().min(1).default(1),
    seat_column: z.string().regex(/^[A-Z]{1,3}$/),
    name_column: z.string().regex(/^[A-Z]{1,3}$/).optional(),
    score_column: z.string().regex(/^[A-Z]{1,3}$/),
    grade_column: z.string().regex(/^[A-Z]{1,3}$/).optional(),
    /** 例："{seat}" 或 "S{seat}" */
    seat_format: z.string().default('{seat}')
  })
})
export type GradebookConfig = z.infer<typeof GradebookConfigSchema>

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

export function parseJson<T extends z.ZodType>(schema: T, raw: string): z.infer<T> {
  return schema.parse(JSON.parse(raw))
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
}
