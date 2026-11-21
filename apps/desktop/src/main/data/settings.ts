import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isCooldownDays,
  isLibrarySort,
  normalizeCooldownDays,
  normalizeLibraryMode,
  normalizeLibrarySort,
  type LibraryMode,
  type LibraryPrefs,
  type LibrarySort
} from '@essay-grader/core'

export interface Settings {
  lastDatabase?: string
  /** Google Drive 本機同步資料夾，作為外部 inbox 根目錄。 */
  externalInboxRoot?: string
  /** 評語庫版本偏好；auto 依班級學制選用，非法值一律視為 auto。 */
  libraryMode?: LibraryMode
  /** 評語庫排序偏好；非法值一律視為 default。 */
  librarySort?: LibrarySort
  /** 釘選的評語 id；只留字串並去重，切換版本時未知 id 會保留。 */
  libraryPins?: string[]
  /** 冷卻輪替天數；非法值一律視為預設 30。 */
  libraryCooldownDays?: number
}

/** 只留字串、去空白、去重，並保留第一次出現的順序。 */
export function normalizeLibraryPins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const pins: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    pins.push(id)
  }
  return pins
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<Settings> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8')) as Settings
    return {
      ...parsed,
      libraryMode: normalizeLibraryMode(parsed.libraryMode),
      librarySort: normalizeLibrarySort(parsed.librarySort),
      libraryPins: normalizeLibraryPins(parsed.libraryPins),
      libraryCooldownDays: normalizeCooldownDays(parsed.libraryCooldownDays)
    }
  } catch {
    return {
      libraryMode: 'auto',
      librarySort: 'default',
      libraryPins: [],
      libraryCooldownDays: normalizeCooldownDays(undefined)
    }
  }
}

export async function writeSettings(patch: Partial<Settings>): Promise<void> {
  const current = await readSettings()
  const next: Settings = { ...current, ...patch }
  next.libraryMode = normalizeLibraryMode(next.libraryMode)
  next.librarySort = normalizeLibrarySort(next.librarySort)
  next.libraryPins = normalizeLibraryPins(next.libraryPins)
  next.libraryCooldownDays = normalizeCooldownDays(next.libraryCooldownDays)
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
}

export async function readLibraryPrefs(): Promise<LibraryPrefs> {
  const settings = await readSettings()
  return {
    sort: normalizeLibrarySort(settings.librarySort),
    pins: normalizeLibraryPins(settings.libraryPins),
    cooldownDays: normalizeCooldownDays(settings.libraryCooldownDays)
  }
}

/**
 * 寫入評語庫偏好；只處理有給的欄位。
 * sort 僅接受 default／usage／unused／rotation，pins 會去重且只留字串，
 * cooldownDays 必須是 1–365 的整數。
 */
export async function writeLibraryPrefs(patch: {
  sort?: unknown
  pins?: unknown
  cooldownDays?: unknown
}): Promise<LibraryPrefs> {
  const next: Partial<Settings> = {}

  if (patch.sort !== undefined) {
    if (!isLibrarySort(patch.sort)) {
      throw new Error('評語庫排序不合法，請選擇預設、常用（累計）、本批未用優先或冷卻輪替。')
    }
    next.librarySort = patch.sort
  }

  if (patch.pins !== undefined) {
    if (!Array.isArray(patch.pins)) throw new Error('釘選清單格式不正確。')
    next.libraryPins = normalizeLibraryPins(patch.pins)
  }

  if (patch.cooldownDays !== undefined) {
    if (!isCooldownDays(patch.cooldownDays)) {
      throw new Error('冷卻天數必須是 1–365 的整數。')
    }
    next.libraryCooldownDays = patch.cooldownDays
  }

  if (Object.keys(next).length > 0) await writeSettings(next)
  return readLibraryPrefs()
}

/** 清除外部 inbox 設定；JSON.stringify 會略過 undefined，key 不會留下。 */
export async function clearExternalInboxRoot(): Promise<void> {
  const current = await readSettings()
  delete current.externalInboxRoot
  await writeFile(settingsPath(), JSON.stringify(current, null, 2), 'utf8')
}
