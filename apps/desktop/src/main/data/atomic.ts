import { copyFile, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { formatIssues } from '@essay-grader/core'
import type { ZodType } from 'zod'

export interface ReadResult<T> {
  data: T
  recovered: boolean
  warning?: string
}

/**
 * 原子寫入：先備份舊檔成 .bak，再寫 .tmp → fsync → rename。
 * 任何一步中斷，原檔或 .bak 至少有一份可用。
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const json = `${JSON.stringify(value, null, 2)}\n`

  try {
    await copyFile(path, `${path}.bak`)
  } catch {
    // 第一次寫入，沒有舊檔可備份
  }

  const tmp = `${path}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(json, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmp, path)
}

async function tryRead<T>(
  path: string,
  schema: ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = schema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      return { ok: false, error: formatIssues(parsed.error).join('; ') }
    }
    return { ok: true, data: parsed.data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 主檔壞掉時自動退回 .bak，並用備份把主檔修好。 */
export async function readJsonRecovering<T>(
  path: string,
  schema: ZodType<T>
): Promise<ReadResult<T>> {
  const main = await tryRead(path, schema)
  if (main.ok) {
    return { data: main.data, recovered: false }
  }

  const backup = await tryRead(`${path}.bak`, schema)
  if (!backup.ok) {
    throw new Error(`讀取失敗：${path}\n主檔：${main.error}\n備份：${backup.error}`)
  }

  const json = `${JSON.stringify(backup.data, null, 2)}\n`
  const tmp = `${path}.restore.tmp`
  await writeFile(tmp, json, 'utf8')
  await rename(tmp, path)

  return {
    data: backup.data,
    recovered: true,
    warning: `主檔損壞，已從 .bak 還原：${path}`
  }
}
