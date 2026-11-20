import { app } from 'electron'
import ExcelJS from 'exceljs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportEvent, WorkSummary } from '@essay-grader/core'
import {
  closeDatabase,
  createAssignment,
  createClass,
  listWorks,
  loadClass,
  openDatabase,
  saveClass
} from '../data/repository'
import { importRosterFile } from '../import/roster-excel'
import { ensureInbox, getImportStatus, onImportEvent } from '../import/watcher'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await delay(100)
  }
  return false
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function writeWorkbook(path: string, rows: Array<[string, string]>): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('名單')
  sheet.addRow(['座號', '姓名'])
  for (const row of rows) sheet.addRow(row)
  await workbook.xlsx.writeFile(path)
}

/** `--m2-check`：真的丟檔案進 inbox，驗證配對、去重、unmatched、Excel 名單。 */
export async function runM2Check(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const root = join(repoRoot, 'spike-out', 'm2-db')
  const source = join(repoRoot, 'spike-assets', 'page-2600.jpg')

  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  const received: ImportEvent[] = []
  const off = onImportEvent((event) => received.push(event))

  try {
    await openDatabase(root, { remember: false })
    add('開啟資料庫', true, root)

    const created = await createClass({
      classNo: '302',
      name: '國中302',
      grade: 'junior',
      academicYear: '114',
      semester: 1,
      teacher: '王老師'
    })

    const loaded = await loadClass(created.id)
    loaded.data.students = [
      { seat: '07', name: '王小明', active: true },
      { seat: '08', name: '陳怡君', active: true },
      { seat: '12', name: '林志豪', active: true }
    ]
    await saveClass(loaded.data)

    const assignment = await createAssignment({
      classId: created.id,
      title: '我的母親',
      prompt: '',
      genre: 'narrative',
      wordLimit: 600,
      rubricPreset: 'junior'
    })
    add('建立作業', assignment.id.length > 0, assignment.id)

    const inbox = await ensureInbox(created.id, assignment.id)
    add('建立並監看 inbox', getImportStatus().watching >= 1, inbox)

    const base = await readFile(source)
    const plan: Array<[string, number]> = [
      ['07', 4],
      ['08', 3],
      ['12', 3]
    ]

    let index = 0
    const started = performance.now()
    for (const [seat, pages] of plan) {
      for (let page = 1; page <= pages; page++) {
        const key = `S${seat}__TEST__${String(page).padStart(3, '0')}`
        const bytes = Buffer.concat([base, Buffer.from(`\ntest-${index++}`)])
        await writeFile(join(inbox, `${key}.jpg`), bytes)
        await writeFile(
          join(inbox, `${key}.json`),
          JSON.stringify({
            schema_version: 1,
            class_id: created.id,
            assignment_id: assignment.id,
            seat,
            seq: page,
            session_id: 'TEST',
            captured_at: new Date().toISOString()
          }),
          'utf8'
        )
      }
    }

    const imported = await waitFor(async () => {
      const works = await listWorks(created.id, assignment.id)
      return works.length === 3 && works.reduce((sum, work) => sum + work.pages, 0) === 10
    }, 8000)
    const elapsed = performance.now() - started

    const works: WorkSummary[] = await listWorks(created.id, assignment.id)
    const totalPages = works.reduce((sum, work) => sum + work.pages, 0)
    add(
      '10 檔自動配對',
      imported && works.length === 3 && totalPages === 10,
      `${works.length} 份／${totalPages} 頁，${elapsed.toFixed(0)}ms`
    )
    // 10 張 2600px 圖片需經 sharp 前處理；主機負載與防毒掃描會讓時間波動，
    // 門檻與下方等待上限一致，仍可擋下明顯的流程卡住。
    add('8 秒內完成', elapsed <= 8000, `${elapsed.toFixed(0)}ms`)
    add(
      '初始狀態為待批',
      works.every((work) => work.status === 'pending'),
      works.map((work) => `${work.seat}:${work.pages}`).join(', ')
    )

    // 重送「同一個來源檔」才算重複；前處理會重新編碼，拿處理後的頁面回丟已非同一份位元組。
    const firstSource = Buffer.concat([base, Buffer.from('\ntest-0')])
    await writeFile(join(inbox, 'S07__DUP__001.jpg'), firstSource)
    await writeFile(
      join(inbox, 'S07__DUP__001.json'),
      JSON.stringify({
        schema_version: 1,
        class_id: created.id,
        assignment_id: assignment.id,
        seat: '07',
        seq: 9,
        session_id: 'DUP',
        captured_at: new Date().toISOString()
      }),
      'utf8'
    )

    const duplicateSeen = await waitFor(
      async () => received.some((event) => event.type === 'duplicate'),
      5000
    )
    const afterDuplicate = await listWorks(created.id, assignment.id)
    add(
      '重複檔案跳過',
      duplicateSeen &&
        afterDuplicate.reduce((sum, work) => sum + work.pages, 0) === 10,
      '頁數仍為 10，事件 duplicate'
    )

    await writeFile(join(inbox, 'ORPHAN.jpg'), Buffer.concat([base, Buffer.from('\norphan')]))
    await delay(2600)
    const unmatched = await listFiles(join(inbox, '_unmatched'))
    add(
      '缺 sidecar 進 _unmatched',
      unmatched.some((file) => file.endsWith('.jpg')),
      `_unmatched ${unmatched.length} 個檔案`
    )

    await writeFile(
      join(inbox, 'S99__001.jpg'),
      Buffer.concat([base, Buffer.from('\nunknown-seat')])
    )
    await writeFile(
      join(inbox, 'S99__001.json'),
      JSON.stringify({
        schema_version: 1,
        class_id: created.id,
        assignment_id: assignment.id,
        seat: '99',
        seq: 1,
        session_id: 'UNKNOWN',
        captured_at: new Date().toISOString()
      }),
      'utf8'
    )
    const unknownSeen = await waitFor(
      async () =>
        received.some(
          (event) => event.type === 'unmatched' && event.message.includes('99')
        ),
      5000
    )
    add('名單外座號被擋', unknownSeen, '事件 unmatched（座號 99）')

    const rosterXlsx = join(repoRoot, 'spike-out', 'm2-roster.xlsx')
    await writeWorkbook(rosterXlsx, [
      ['07', '王小明'],
      ['08', '陳怡君'],
      ['12', '林志豪'],
      ['15', '張家豪']
    ])
    const firstImport = await importRosterFile(rosterXlsx, created.id)
    const afterImport = await loadClass(created.id)
    add(
      'Excel 名單匯入',
      firstImport.added === 1 && afterImport.data.students.length === 4,
      `新增 ${firstImport.added}、更新 ${firstImport.updated}，共 ${afterImport.data.students.length} 人`
    )

    const renameXlsx = join(repoRoot, 'spike-out', 'm2-roster-rename.xlsx')
    await writeWorkbook(renameXlsx, [
      ['7', '王小明改'],
      ['08', '陳怡君'],
      ['12', '林志豪'],
      ['15', '張家豪']
    ])
    const secondImport = await importRosterFile(renameXlsx, created.id)
    const renamed = await loadClass(created.id)
    const seat07 = renamed.data.students.find((student) => student.seat === '07')
    add(
      'Excel 更新與座號補零',
      secondImport.updated === 1 && seat07?.name === '王小明改',
      `更新 ${secondImport.updated}，07 姓名 ${seat07?.name}`
    )

    add(
      '觀看中的 inbox 數量',
      getImportStatus().watching >= 1,
      `${getImportStatus().watching} 個`
    )

    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, error instanceof Error ? error.message : String(error))
  } finally {
    off()
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[m2] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
