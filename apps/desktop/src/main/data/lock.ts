import { app } from 'electron'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

const LOCK_FILE = '.essay-grader.lock'

interface LockInfo {
  schema_version: 1
  pid: number
  host: string
  started_at: string
  app_version: string
}

export interface DatabaseLock {
  path: string
  release: () => Promise<void>
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readLock(path: string): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as LockInfo
  } catch {
    return null
  }
}

/**
 * 同一時間只允許一個 writer。
 * 同機但行程已死 → 視為殘留鎖，直接接手。
 * 不同主機 → 擋下，避免雲端同步同時寫入。
 */
export async function acquireLock(root: string): Promise<DatabaseLock> {
  const path = join(root, LOCK_FILE)
  const existing = await readLock(path)

  if (existing) {
    const sameHost = existing.host === hostname()
    if (!sameHost || isProcessAlive(existing.pid)) {
      const who = sameHost ? '另一個程式' : `另一台電腦（${existing.host}）`
      throw new Error(`資料庫已被${who}開啟，請先關閉後再試。`)
    }
  }

  const info: LockInfo = {
    schema_version: 1,
    pid: process.pid,
    host: hostname(),
    started_at: new Date().toISOString(),
    app_version: app.getVersion()
  }
  await writeFile(path, `${JSON.stringify(info, null, 2)}\n`, 'utf8')

  return {
    path,
    release: async () => {
      const current = await readLock(path)
      if (current?.pid === process.pid) {
        await unlink(path).catch(() => undefined)
      }
    }
  }
}
