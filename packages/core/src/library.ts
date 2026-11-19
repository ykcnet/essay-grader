import senior from './library/senior.json'
import { LibrarySchema, type LibraryEntry } from './schema'

/** 內建高中職評語庫；由 tools/convert_comment_library.mjs 產生。 */
export const SENIOR_LIBRARY = LibrarySchema.parse(senior)

export const BUILTIN_LIBRARY = SENIOR_LIBRARY

export function entriesByCategory(category: LibraryEntry['category']): LibraryEntry[] {
  return BUILTIN_LIBRARY.entries.filter(
    (entry) => !entry.disabled && entry.category === category
  )
}
