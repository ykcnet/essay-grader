import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import {
  AssignmentSchema,
  ClassSchema,
  WorkSchema,
  formatIssues
} from '@essay-grader/core'
import type { ZodType } from 'zod'

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function check<T extends ZodType>(label: string, path: string, schema: T): Promise<boolean> {
  try {
    const parsed = schema.safeParse(await readJson(path))
    if (!parsed.success) {
      console.error(`[fixtures] ${label} 驗證失敗\n${formatIssues(parsed.error).join('\n')}`)
      return false
    }
    return true
  } catch (error) {
    console.error(`[fixtures] ${label} 讀取失敗：`, error)
    return false
  }
}

/**
 * 開發模式啟動時驗證 fixtures，順便當成 core schema 的煙霧測試。
 * 正式版不執行，也不會碰使用者的資料庫。
 */
export async function validateFixtures(): Promise<boolean> {
  const root = join(app.getAppPath(), '../../fixtures', 'C302-2025F')
  const assignmentRoot = join(root, 'E20250107')

  const results = await Promise.all([
    check('class.json', join(root, 'class.json'), ClassSchema),
    check('assignment.json', join(assignmentRoot, 'assignment.json'), AssignmentSchema),
    check('S07/work.json', join(assignmentRoot, 'S07', 'work.json'), WorkSchema),
    check('S08/work.json', join(assignmentRoot, 'S08', 'work.json'), WorkSchema),
    check('S12/work.json', join(assignmentRoot, 'S12', 'work.json'), WorkSchema)
  ])

  const students = ['S07', 'S08', 'S12']
  const pages = ['p1.jpg', 'p2.jpg']
  const missing: string[] = []
  for (const seat of students) {
    for (const page of pages) {
      const path = join(assignmentRoot, seat, page)
      try {
        await access(path)
      } catch {
        missing.push(path)
      }
    }
  }

  if (missing.length > 0) {
    console.warn(`[fixtures] 缺少頁面圖 ${missing.length} 張，請執行 tools/make_fixture_pages.ps1`)
  }

  const passed = results.filter(Boolean).length
  const ok = passed === results.length && missing.length === 0
  if (ok) {
    console.info(`[fixtures] ${passed} 份 JSON 與 6 張頁面圖都通過`)
  }
  return ok
}
