import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Settings {
  lastDatabase?: string
  /** Google Drive 本機同步資料夾，作為外部 inbox 根目錄。 */
  externalInboxRoot?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as Settings
  } catch {
    return {}
  }
}

export async function writeSettings(patch: Partial<Settings>): Promise<void> {
  const current = await readSettings()
  await writeFile(settingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf8')
}

/** 清除外部 inbox 設定；JSON.stringify 會略過 undefined，key 不會留下。 */
export async function clearExternalInboxRoot(): Promise<void> {
  const current = await readSettings()
  delete current.externalInboxRoot
  await writeFile(settingsPath(), JSON.stringify(current, null, 2), 'utf8')
}
