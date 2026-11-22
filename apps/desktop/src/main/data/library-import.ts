import { readFile } from 'node:fs/promises'
import {
  isLibraryId,
  JUNIOR_LIBRARY,
  LibrarySchema,
  SENIOR_LIBRARY,
  mergeLibraryLayers,
  normalizeComment,
  type LibraryEntry,
  type LibraryFile,
  type LibraryId
} from '@essay-grader/core'
import { readLibraryAdditions, writeLibraryAdditions } from './library-custom'

export interface LibraryImportReport {
  imported: number
  skippedExistingId: number
  skippedDuplicateText: number
  version: string
  total: number
}

/** 目前生效版本：有匯入條目且帶版本時用匯入版本，否則用內建版本。 */
function effectiveVersion(imported: readonly LibraryEntry[], importedVersion: string | undefined, baseVersion: string): string {
  return imported.length > 0 && importedVersion ? importedVersion : baseVersion
}

/**
 * 匯入新版內建評語庫 JSON。
 * 只新增目前缺少的 id 與文字；不覆蓋 base、自訂、停用或舊 work.json。
 */
export async function importLibraryFile(
  libraryId: LibraryId,
  filePath: string
): Promise<LibraryImportReport> {
  if (!isLibraryId(libraryId)) {
    throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
  }

  let file: LibraryFile
  try {
    const raw = await readFile(filePath, 'utf8')
    file = LibrarySchema.parse(JSON.parse(raw))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`評語庫檔案格式不正確：${detail}`)
  }

  const seenIds = new Set<string>()
  for (const entry of file.entries) {
    const id = entry.id.trim()
    if (!id) throw new Error('評語庫檔案含有空白 id。')
    if (seenIds.has(id)) throw new Error(`評語庫檔案 id 重複：${id}。`)
    seenIds.add(id)
  }
  if (file.entries.length === 0) throw new Error('評語庫檔案沒有評語條目。')

  const base = libraryId === 'junior' ? JUNIOR_LIBRARY : SENIOR_LIBRARY
  const additions = await readLibraryAdditions(libraryId)

  const existingIds = new Set<string>()
  const existingTexts = new Set<string>()
  for (const entry of [...base.entries, ...additions.imported, ...additions.custom]) {
    existingIds.add(entry.id)
    existingTexts.add(normalizeComment(entry.text))
  }

  let skippedExistingId = 0
  let skippedDuplicateText = 0
  const newEntries: LibraryEntry[] = []
  for (const entry of file.entries) {
    const id = entry.id.trim()
    if (existingIds.has(id)) {
      skippedExistingId += 1
      continue
    }
    const normalized = normalizeComment(entry.text)
    if (existingTexts.has(normalized)) {
      skippedDuplicateText += 1
      continue
    }
    newEntries.push({ ...entry, id, source: 'builtin', disabled: false })
    existingIds.add(id)
    existingTexts.add(normalized)
  }

  if (newEntries.length === 0) {
    return {
      imported: 0,
      skippedExistingId,
      skippedDuplicateText,
      version: effectiveVersion(
        additions.imported,
        additions.importedVersion,
        base.library_version
      ),
      total: mergeLibraryLayers(base.entries, additions.imported, additions.custom).entries.length
    }
  }

  const imported = [...additions.imported, ...newEntries]
  await writeLibraryAdditions(libraryId, {
    custom: additions.custom,
    imported,
    importedVersion: file.library_version
  })

  return {
    imported: newEntries.length,
    skippedExistingId,
    skippedDuplicateText,
    version: file.library_version,
    total: mergeLibraryLayers(base.entries, imported, additions.custom).entries.length
  }
}
