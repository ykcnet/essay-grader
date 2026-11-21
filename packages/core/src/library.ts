import senior from './library/senior.json'
import junior from './library/junior.draft.json'
import { LibrarySchema, type LibraryEntry, type LibraryFile } from './schema'

/** 內建高中職評語庫；由 tools/convert_comment_library.mjs 產生。 */
export const SENIOR_LIBRARY = LibrarySchema.parse(senior)

/** 內建國中評語庫（草稿版，library_version 為 2026.2-draft）。 */
export const JUNIOR_LIBRARY = LibrarySchema.parse(junior)

/** 相容舊呼叫端；預設仍為高中職版。 */
export const BUILTIN_LIBRARY = SENIOR_LIBRARY

export type LibraryId = 'junior' | 'senior'

/** auto 依班級學制選用；其餘為手動指定版本。 */
export type LibraryMode = 'auto' | LibraryId

/** 班級學制，與 class.json 的 grade 一致。 */
export type LibraryGrade = 'junior' | 'senior' | 'vocational'

export const LIBRARY_IDS = ['junior', 'senior'] as const
export const LIBRARY_MODES = ['auto', 'junior', 'senior'] as const

export const LIBRARY_LABELS: Record<LibraryId, string> = {
  junior: '國中版',
  senior: '高中職版'
}

export const LIBRARY_MODE_LABELS: Record<LibraryMode, string> = {
  auto: '自動（依學制）',
  junior: '國中版',
  senior: '高中職版'
}

export function isLibraryId(value: unknown): value is LibraryId {
  return value === 'junior' || value === 'senior'
}

export function isLibraryMode(value: unknown): value is LibraryMode {
  return value === 'auto' || isLibraryId(value)
}

/** 非法值一律回到 auto。 */
export function normalizeLibraryMode(value: unknown): LibraryMode {
  return isLibraryMode(value) ? value : 'auto'
}

export function isLibraryGrade(value: unknown): value is LibraryGrade {
  return value === 'junior' || value === 'senior' || value === 'vocational'
}

export interface LibraryPayload {
  id: LibraryId
  mode: LibraryMode
  grade?: LibraryGrade
  library: LibraryFile
}

/**
 * 依學制與模式挑選評語庫。
 * auto：junior → 國中版；senior／vocational → 高中職版。
 * 手動指定時直接使用該版本，不受學制影響。
 */
export function libraryForGrade(
  grade?: string | null,
  mode: LibraryMode = 'auto'
): LibraryPayload {
  if (!isLibraryMode(mode)) {
    throw new Error(`不支援的評語庫模式：${String(mode)}`)
  }
  const safeMode = mode
  const safeGrade = isLibraryGrade(grade) ? grade : undefined

  const id: LibraryId =
    safeMode === 'junior' || safeMode === 'senior'
      ? safeMode
      : safeGrade === 'junior'
        ? 'junior'
        : 'senior'

  return {
    id,
    mode: safeMode,
    ...(safeGrade ? { grade: safeGrade } : {}),
    library: id === 'junior' ? JUNIOR_LIBRARY : SENIOR_LIBRARY
  }
}

export function entriesByCategory(category: LibraryEntry['category']): LibraryEntry[] {
  return BUILTIN_LIBRARY.entries.filter(
    (entry) => !entry.disabled && entry.category === category
  )
}

/** 評語庫排序偏好；default 保留原順序，usage 依累計次數，unused 以本批未用優先。 */
export const LIBRARY_SORTS = ['default', 'usage', 'unused'] as const
export type LibrarySort = (typeof LIBRARY_SORTS)[number]

export const LIBRARY_SORT_LABELS: Record<LibrarySort, string> = {
  default: '預設',
  usage: '常用（累計）',
  unused: '本批未用優先'
}

export function isLibrarySort(value: unknown): value is LibrarySort {
  return value === 'default' || value === 'usage' || value === 'unused'
}

/** 非法值一律回到 default，避免舊設定或手動編輯造成錯誤。 */
export function normalizeLibrarySort(value: unknown): LibrarySort {
  return isLibrarySort(value) ? value : 'default'
}

/** 使用次數全部由 work.json 的 library_id 即時推導，不另存計數器。 */
export interface LibraryUsage {
  /** 只算目前作業。 */
  current: Record<string, number>
  /** 同班所有作業。 */
  overall: Record<string, number>
}

export interface LibraryPrefs {
  sort: LibrarySort
  pins: string[]
}

export interface SortLibraryOptions {
  sort?: LibrarySort
  pins?: readonly string[]
  usage?: Partial<LibraryUsage> | null
}

const usageCount = (usage: Record<string, number>, id: string): number => {
  const value = usage[id]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 回傳排序後的新陣列，不改動來源。
 *
 * 釘選條目永遠在前；釘選內固定依 overall 使用次數由高到低，
 * 同次數依原順序（三種 sort 都相同）。其餘條目：
 * - default：原順序。
 * - usage：overall 由高到低，同次數依原順序。
 * - unused：current 為 0 的排前面；同群組再依 overall 由高到低，同次數依原順序。
 * 未知的 pin id 會忽略；usage 缺少的 id 視為 0。
 */
export function sortLibraryEntries(
  entries: readonly LibraryEntry[],
  options: SortLibraryOptions = {}
): LibraryEntry[] {
  const sort = normalizeLibrarySort(options.sort)
  const pins = new Set(
    (options.pins ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)
  )
  const current = options.usage?.current ?? {}
  const overall = options.usage?.overall ?? {}

  const indexed = entries.map((entry, index) => ({ entry, index }))
  const byOriginal = (a: { index: number }, b: { index: number }): number => a.index - b.index
  const byOverall = (
    a: { entry: LibraryEntry },
    b: { entry: LibraryEntry }
  ): number => usageCount(overall, b.entry.id) - usageCount(overall, a.entry.id)

  const pinned = indexed
    .filter((item) => pins.has(item.entry.id))
    .sort((a, b) => byOverall(a, b) || byOriginal(a, b))

  const rest = indexed.filter((item) => !pins.has(item.entry.id))
  if (sort === 'usage') {
    rest.sort((a, b) => byOverall(a, b) || byOriginal(a, b))
  } else if (sort === 'unused') {
    const unusedRank = (item: { entry: LibraryEntry }): number =>
      usageCount(current, item.entry.id) === 0 ? 0 : 1
    rest.sort(
      (a, b) => unusedRank(a) - unusedRank(b) || byOverall(a, b) || byOriginal(a, b)
    )
  }

  return [...pinned, ...rest].map((item) => item.entry)
}
