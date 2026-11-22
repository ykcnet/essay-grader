import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CustomLibrarySchema,
  isLibraryId,
  type CustomLibraryFile,
  type LibraryEntry,
  type LibraryId
} from '@essay-grader/core'
import { currentRoot } from './repository'
import { readJsonRecovering, writeJsonAtomic } from './atomic'

/** 某版本的擴充條目：自訂 + 匯入的新版內建。 */
export interface LibraryAdditions {
  custom: LibraryEntry[]
  imported: LibraryEntry[]
  importedVersion?: string
}

/** 自訂評語檔案固定放在資料庫根目錄的 `_library/` 下。 */
function customLibraryPath(libraryId: LibraryId): string {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫')
  return join(root, '_library', `${libraryId}.json`)
}

function assertLibraryId(libraryId: LibraryId): void {
  if (!isLibraryId(libraryId)) throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
}

/**
 * 讀取某版本的擴充條目；無資料庫或檔案不存在時回空，不視為錯誤。
 * 檔案存在但內容損壞時由 readJsonRecovering 嘗試 .bak 還原，仍失敗才拋出。
 */
export async function readLibraryAdditions(libraryId: LibraryId): Promise<LibraryAdditions> {
  assertLibraryId(libraryId)
  const root = currentRoot()
  if (!root) return { custom: [], imported: [] }

  const path = join(root, '_library', `${libraryId}.json`)
  try {
    const info = await stat(path)
    if (!info.isFile()) return { custom: [], imported: [] }
  } catch {
    return { custom: [], imported: [] }
  }

  const { data } = await readJsonRecovering(path, CustomLibrarySchema)
  return {
    custom: data.entries,
    imported: data.imported,
    importedVersion: data.imported_version
  }
}

/**
 * 原子寫入某版本的擴充條目；會建立 `_library/` 資料夾。
 * custom 一律 source=custom；imported 一律 source=builtin、disabled=false。
 * importedVersion 未給時不寫入，保留 JSON.stringify 略過 undefined 的行為。
 */
export async function writeLibraryAdditions(
  libraryId: LibraryId,
  additions: LibraryAdditions
): Promise<void> {
  assertLibraryId(libraryId)
  const file: CustomLibraryFile = {
    schema_version: 1,
    library_id: libraryId,
    entries: additions.custom.map((entry) => ({ ...entry, source: 'custom' })),
    imported: additions.imported.map((entry) => ({
      ...entry,
      source: 'builtin',
      disabled: false
    })),
    ...(additions.importedVersion
      ? { imported_version: additions.importedVersion }
      : {}),
    updated_at: new Date().toISOString()
  }
  await writeJsonAtomic(customLibraryPath(libraryId), file)
}

/** 讀取某版本的自訂條目；匯入的新版內建不會被算進自訂。 */
export async function readCustomEntries(libraryId: LibraryId): Promise<LibraryEntry[]> {
  const additions = await readLibraryAdditions(libraryId)
  return additions.custom
}

/** 寫入某版本的自訂條目；保留既有匯入條目與版本，只改自訂。 */
export async function writeCustomEntries(
  libraryId: LibraryId,
  entries: readonly LibraryEntry[]
): Promise<void> {
  assertLibraryId(libraryId)
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error('自訂評語 id 重複。')
    seen.add(entry.id)
  }
  const existing = await readLibraryAdditions(libraryId)
  await writeLibraryAdditions(libraryId, {
    custom: entries.map((entry) => ({ ...entry, source: 'custom' })),
    imported: existing.imported,
    importedVersion: existing.importedVersion
  })
}
