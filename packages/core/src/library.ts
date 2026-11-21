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
