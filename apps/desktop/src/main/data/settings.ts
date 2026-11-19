import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface Settings {
  lastDatabase?: string
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
