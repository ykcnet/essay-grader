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

/** 自訂評語檔案固定放在資料庫根目錄的 `_library/` 下。 */
function customLibraryPath(libraryId: LibraryId): string {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫')
  return join(root, '_library', `${libraryId}.json`)
}

/**
 * 讀取某版本的自訂條目；無資料庫或檔案不存在時回空清單，不視為錯誤。
 * 檔案存在但內容損壞時由 readJsonRecovering 嘗試 .bak 還原，仍失敗才拋出。
 */
export async function readCustomEntries(libraryId: LibraryId): Promise<LibraryEntry[]> {
  if (!isLibraryId(libraryId)) throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
  const root = currentRoot()
  if (!root) return []

  const path = join(root, '_library', `${libraryId}.json`)
  try {
    const info = await stat(path)
    if (!info.isFile()) return []
  } catch {
    return []
  }

  const { data } = await readJsonRecovering(path, CustomLibrarySchema)
  return data.entries
}

/** 寫入某版本的自訂條目；會建立 `_library/` 資料夾並原子寫入。 */
export async function writeCustomEntries(
  libraryId: LibraryId,
  entries: readonly LibraryEntry[]
): Promise<void> {
  if (!isLibraryId(libraryId)) throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error('自訂評語 id 重複。')
    seen.add(entry.id)
  }
  const file: CustomLibraryFile = {
    schema_version: 1,
    library_id: libraryId,
    entries: entries.map((entry) => ({ ...entry, source: 'custom' })),
    updated_at: new Date().toISOString()
  }
  await writeJsonAtomic(customLibraryPath(libraryId), file)
}
