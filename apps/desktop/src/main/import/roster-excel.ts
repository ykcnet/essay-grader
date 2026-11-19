import { dialog } from 'electron'
import ExcelJS from 'exceljs'
import { join } from 'node:path'
import { ClassSchema, type Student } from '@essay-grader/core'
import { readJsonRecovering, writeJsonAtomic } from '../data/atomic'
import { currentRoot } from '../data/repository'

export interface RosterImportResult {
  canceled: boolean
  added: number
  updated: number
  total: number
  warnings: string[]
  path?: string
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString()

  const object = value as {
    text?: unknown
    richText?: Array<{ text: string }>
    result?: unknown
  }
  if (Array.isArray(object.richText)) {
    return object.richText.map((part) => part.text).join('').trim()
  }
  if (object.text !== undefined) return String(object.text).trim()
  if (object.result !== undefined) return cellText(object.result as ExcelJS.CellValue)
  return ''
}

function normalizeSeat(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  return digits.padStart(2, '0').slice(-2)
}

interface ParsedRow {
  seat: string
  name: string
}

export async function parseRosterWorkbook(
  path: string
): Promise<{ students: ParsedRow[]; warnings: string[] }> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('Excel 沒有工作表')

  const warnings: string[] = []
  let headerRow = 0
  let seatColumn = 0
  let nameColumn = 0

  for (let row = 1; row <= Math.min(sheet.rowCount, 10); row++) {
    let seat = 0
    let name = 0
    sheet.getRow(row).eachCell((cell, column) => {
      const text = cellText(cell.value)
      if (!seat && /座號/.test(text)) seat = column
      if (!name && /(姓名|名字)/.test(text)) name = column
    })
    if (seat && name) {
      headerRow = row
      seatColumn = seat
      nameColumn = name
      break
    }
  }

  if (!headerRow) {
    seatColumn = 1
    nameColumn = 2
    warnings.push('找不到「座號／姓名」表頭，改用 A、B 欄並從第 1 列開始讀')
  }

  const bySeat = new Map<string, string>()
  for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
    const sheetRow = sheet.getRow(row)
    const seatText = cellText(sheetRow.getCell(seatColumn).value)
    const nameText = cellText(sheetRow.getCell(nameColumn).value)
    if (!seatText && !nameText) continue

    const seat = normalizeSeat(seatText)
    if (!seat) {
      warnings.push(`第 ${row} 列座號無效：${seatText || '(空白)'}`)
      continue
    }
    if (!nameText) {
      warnings.push(`第 ${row} 列缺少姓名（座號 ${seat}）`)
      continue
    }
    if (bySeat.has(seat)) {
      warnings.push(`座號 ${seat} 重複，取最後一筆`)
    }
    bySeat.set(seat, nameText)
  }

  const students = [...bySeat.entries()]
    .map(([seat, name]) => ({ seat, name }))
    .sort((a, b) => a.seat.localeCompare(b.seat))

  return { students, warnings }
}

/** 讀 Excel 並合併到既有名單：新座號新增、同座號更新姓名。 */
export async function importRosterFile(
  path: string,
  classId: string
): Promise<RosterImportResult> {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫')

  const classPath = join(root, classId, 'class.json')
  const { data: classFile } = await readJsonRecovering(classPath, ClassSchema)
  const { students, warnings } = await parseRosterWorkbook(path)

  if (students.length === 0) {
    throw new Error('Excel 裡找不到可用的座號與姓名')
  }

  let added = 0
  let updated = 0

  for (const row of students) {
    const existing = classFile.students.find((student) => student.seat === row.seat)
    if (existing) {
      if (existing.name !== row.name) {
        existing.name = row.name
        updated += 1
      }
    } else {
      const student: Student = { seat: row.seat, name: row.name, active: true }
      classFile.students.push(student)
      added += 1
    }
  }

  classFile.students.sort((a, b) => a.seat.localeCompare(b.seat))
  await writeJsonAtomic(classPath, classFile)

  return {
    canceled: false,
    added,
    updated,
    total: students.length,
    warnings,
    path
  }
}

export async function importRosterViaDialog(classId: string): Promise<RosterImportResult> {
  const result = await dialog.showOpenDialog({
    title: '匯入名單 Excel',
    buttonLabel: '匯入',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, added: 0, updated: 0, total: 0, warnings: [] }
  }

  return importRosterFile(result.filePaths[0], classId)
}
