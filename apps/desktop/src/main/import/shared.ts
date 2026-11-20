import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { WorkSchema } from '@essay-grader/core'
import { readJsonRecovering } from '../data/atomic'

/** 未匹配檔案的結構化 metadata，寫在圖片旁的 `<檔名>.meta.json`。 */
export interface UnmatchedMeta {
  schema_version: 1
  classId?: string
  assignmentId?: string
  seat?: string
  reason: string
  source: 'inbox' | 'drive'
  movedAt: string
  originalName: string
}

export type UnmatchedMetaInput = Pick<
  UnmatchedMeta,
  'classId' | 'assignmentId' | 'seat' | 'source'
>

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function moveFile(source: string, target: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EXDEV') {
        await copyFile(source, target)
        await unlink(source)
        return
      }
      if (code !== 'EBUSY' && code !== 'EPERM') throw error
      await delay(150)
    }
  }
  await copyFile(source, target)
  await unlink(source)
}

/** 把來源圖片（與可選 sidecar）移到 baseDir 下的 `_unmatched`／`_duplicates`。 */
export async function moveToSubfolder(
  baseDir: string,
  folder: '_unmatched' | '_duplicates',
  image: string,
  sidecar: string | null,
  reason: string,
  meta?: UnmatchedMetaInput
): Promise<void> {
  const targetDir = join(baseDir, folder)
  await mkdir(targetDir, { recursive: true })

  const name = `${stamp()}__${basename(image)}`
  const target = join(targetDir, name)
  await moveFile(image, target)

  if (sidecar) {
    try {
      await moveFile(sidecar, `${target}.json`)
    } catch {
      // sidecar 可能已被處理或不存在
    }
  }
  await writeFile(`${target}.reason.txt`, `${reason}\n`, 'utf8')

  if (meta) {
    const payload: UnmatchedMeta = {
      schema_version: 1,
      ...(meta.classId ? { classId: meta.classId } : {}),
      ...(meta.assignmentId ? { assignmentId: meta.assignmentId } : {}),
      ...(meta.seat ? { seat: meta.seat } : {}),
      reason,
      source: meta.source,
      movedAt: new Date().toISOString(),
      originalName: basename(image)
    }
    await writeFile(`${target}.meta.json`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
}

/** 以 SHA-256 找同作業是否已有相同頁面，回傳該頁座號。 */
export async function findDuplicate(
  assignmentDir: string,
  sha: string
): Promise<string | null> {
  const entries = await readdir(assignmentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^S\d{2}$/.test(entry.name)) continue

    try {
      const { data } = await readJsonRecovering(
        join(assignmentDir, entry.name, 'work.json'),
        WorkSchema
      )
      if (data.pages.some((page) => page.sha256 === sha)) return data.seat
    } catch {
      continue
    }
  }
  return null
}
