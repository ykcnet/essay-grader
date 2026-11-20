import { dialog, shell } from 'electron'
import ExcelJS from 'exceljs'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  GradebookConfigSchema,
  formatIssues,
  type GradebookConfig,
  type WorkSummary
} from '@essay-grader/core'
import { ZodError } from 'zod'
import { logInfo, logWarn } from '../logger'
import { readJsonRecovering, writeJsonAtomic } from './atomic'
import { currentRoot, listWorks, loadWork } from './repository'

const SUPPORTED = new Set(['.xlsx', '.xlsm', '.xltm', '.xlsb', '.xls'])
const DIRECT_WRITE = new Set(['.xlsx'])
const DANGEROUS_PARTS = ['xl/charts/', 'xl/pivotTables/', 'xl/pivotCache/', 'vbaProject.bin']
const STATUS_LABELS: Record<string, string> = {
  pending: '待批',
  grading: '批閱中',
  done: '已批'
}

export type GradebookMode = 'copy' | 'export'

export interface GradebookSheetInfo {
  name: string
  rowCount: number
  columnCount: number
}

export interface GradebookDetection {
  headerRow: number
  seatColumn: string
  nameColumn?: string
  scoreColumn: string
  gradeColumn?: string
  seatFormat: string
  headers: Record<string, string>
}

export interface GradebookInspection {
  path: string
  sheets: GradebookSheetInfo[]
  sheet: string | null
  preview: string[][]
  detection: GradebookDetection | null
  exportOnly: boolean
  exportReason?: string
  warning?: string
}

export interface GradebookChooseResult extends Partial<GradebookInspection> {
  canceled: boolean
  path?: string
}

export interface GradebookChange {
  seat: string
  name: string
  row: number
  scoreBefore: number | null
  scoreAfter: number
  gradeBefore: string | null
  gradeAfter: string | null
}

export interface GradebookUnmatched {
  seat: string
  name: string
  reason: string
}

export interface GradebookIncomplete {
  seat: string
  name: string
  status: string
  reason: string
}

export interface GradebookDuplicate {
  seat: string
  rows: number[]
}

export interface GradebookVerification {
  rowCountBefore: number
  rowCountAfter: number
  checked: number
  unchangedSeatAndName: boolean
  failures: string[]
}

export interface GradebookWriteReport {
  ok: boolean
  mode: GradebookMode
  sourcePath: string
  outputPath: string | null
  csvPath: string | null
  sheet: string
  headerRow: number
  written: number
  verified: boolean
  changes: GradebookChange[]
  unmatched: GradebookUnmatched[]
  incomplete: GradebookIncomplete[]
  duplicates: GradebookDuplicate[]
  warnings: string[]
  verification: GradebookVerification | null
  error?: string
  elapsedMs: number
}

export interface GradebookCsvResult {
  path: string
  rows: number
}

export interface GradebookWriteOptions {
  classId: string
  assignmentId: string
  /** 不給就用 gradebook.json 設定的路徑。 */
  sourcePath?: string
  /** 不給就依原檔名產生 graded 副本；主要供自動驗收指定。 */
  outputPath?: string
  /** 固定時間戳，讓驗收可預期檔名。 */
  now?: Date
}

interface ResolvedGradebook {
  path: string
  sheet: string
  headerRow: number
  seatColumn: string
  nameColumn?: string
  scoreColumn: string
  gradeColumn?: string
  seatFormat: string
}

class VerificationError extends Error {
  constructor(
    message: string,
    readonly failures: string[],
    readonly verification: GradebookVerification
  ) {
    super(message)
    this.name = 'VerificationError'
  }
}

function toMessage(error: unknown): string {
  if (error instanceof ZodError) return formatIssues(error).join('；')
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' ? code : ''
}

function isLocked(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'EBUSY' || code === 'EPERM'
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * 檔案被 Excel 鎖住時重試 2 次；仍失敗就給老師看得懂的訊息。
 * 其他錯誤直接拋出，由外層轉成繁體中文。
 */
async function withRetry<T>(label: string, action: () => Promise<T>): Promise<T> {
  let last: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      last = error
      if (!isLocked(error)) throw error
      if (attempt < 2) await sleep(250)
    }
  }
  throw new Error(
    `檔案被其他程式鎖定（${label}），請先關閉 Excel 後再試；已自動重試 2 次。`
  )
}

/** 檢查檔案存在，並把常見 fs 錯誤轉成繁體中文。 */
async function requireFile(path: string, label: string): Promise<void> {
  try {
    const info = await withRetry(`讀取${label}`, () => stat(path))
    if (!info.isFile()) throw new Error(`${label}不是檔案：${path}`)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new Error(`找不到${label}：${path}`)
    if (isLocked(error)) {
      throw new Error(`檔案被其他程式鎖定，請先關閉 Excel 後再試。`)
    }
    if (errorCode(error) === 'EACCES') {
      throw new Error(`權限不足，無法讀取${label}。`)
    }
    throw error
  }
}

function friendly(error: unknown): string {
  if (error instanceof VerificationError) return error.message
  if (errorCode(error) === 'ENOENT') return '找不到檔案，請確認路徑是否正確。'
  if (errorCode(error) === 'EACCES') return '權限不足，無法存取檔案；請確認資料夾可寫入。'
  if (isLocked(error)) return '檔案被其他程式鎖定，請先關閉 Excel 後再試。'
  return toMessage(error)
}

export function normalizeSeat(value: string): string | null {
  const text = value.trim()
  const match = /^[Ss]?\s*0*(\d{1,2})$/.exec(text)
  if (!match) return null
  const number = Number(match[1])
  if (!Number.isInteger(number) || number < 1 || number > 99) return null
  return String(number).padStart(2, '0')
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
    formula?: unknown
  }
  if (Array.isArray(object.richText)) {
    return object.richText.map((part) => part.text).join('').trim()
  }
  if (object.text !== undefined) return String(object.text).trim()
  if (object.result !== undefined) return cellText(object.result as ExcelJS.CellValue)
  return ''
}

function columnToNumber(letter: string): number {
  let value = 0
  for (const char of letter.toUpperCase()) {
    value = value * 26 + (char.charCodeAt(0) - 64)
  }
  return value
}

function numberToColumn(index: number): string {
  let value = index
  let result = ''
  while (value > 0) {
    const rest = (value - 1) % 26
    result = String.fromCharCode(65 + rest) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function gradedPath(source: string, now: Date, extension = extname(source)): string {
  const ext = extension.toLowerCase() === '.xlsx' ? '.xlsx' : extension
  const base = basename(source, extname(source))
  const dir = dirname(source)
  const stem = `${base}.graded-${stamp(now)}`
  let candidate = join(dir, `${stem}${ext}`)
  for (let index = 2; index < 1000; index += 1) {
    // 同步檢查只用於命名，不讀內容；避免檔名競爭。
    if (!existsSync(candidate)) return candidate
    candidate = join(dir, `${stem}-${String(index).padStart(2, '0')}${ext}`)
  }
  return join(dir, `${stem}-99${ext}`)
}

function gradebookPath(classId: string, assignmentId: string): string {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫。')
  return join(root, classId, assignmentId, 'gradebook.json')
}

function outputDir(classId: string, assignmentId: string): string {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫。')
  return join(root, classId, assignmentId, '_gradebook')
}

async function uniqueFile(base: string, extension: string): Promise<string> {
  let candidate = `${base}${extension}`
  for (let index = 2; index < 1000; index += 1) {
    try {
      await stat(candidate)
      candidate = `${base}-${String(index).padStart(2, '0')}${extension}`
    } catch {
      return candidate
    }
  }
  return `${base}-99${extension}`
}

async function inspectZipMarkers(path: string): Promise<string[]> {
  const buffer = await withRetry('讀取成績表', () => readFile(path))
  return DANGEROUS_PARTS.filter((part) => buffer.includes(Buffer.from(part, 'latin1')))
}

/** 判斷是否只能匯出新檔：舊格式、巨集、圖表、樞紐、VBA。 */
async function assessSource(path: string): Promise<{
  exportOnly: boolean
  reason?: string
  markers: string[]
}> {
  const ext = extname(path).toLowerCase()
  if (!SUPPORTED.has(ext)) {
    throw new Error('只支援 Excel 成績表（.xlsx／.xlsm／.xltm／.xlsb／.xls）。')
  }
  if (!DIRECT_WRITE.has(ext)) {
    return {
      exportOnly: true,
      reason: `${ext} 格式不會直接修改，已改走「匯出新檔」模式。`,
      markers: []
    }
  }

  const markers = await inspectZipMarkers(path)
  if (markers.length > 0) {
    return {
      exportOnly: true,
      reason: `偵測到 ${markers.join('、')}，為避免破壞圖表／樞紐／巨集，已改走「匯出新檔」模式。`,
      markers
    }
  }
  return { exportOnly: false, markers: [] }
}

function detectHeader(
  sheet: ExcelJS.Worksheet
): { detection: GradebookDetection; warning?: string } | null {
  const maxRow = Math.min(10, sheet.rowCount)
  const maxColumn = Math.min(60, Math.max(sheet.columnCount, 1))
  let best:
    | {
        score: number
        row: number
        seat: number
        name?: number
        scoreColumn?: number
        grade?: number
        headers: Record<string, string>
      }
    | null = null

  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const texts = new Map<number, string>()
    const headers: Record<string, string> = {}

    for (let column = 1; column <= maxColumn; column += 1) {
      const text = cellText(row.getCell(column).value)
      if (!text) continue
      texts.set(column, text)
      headers[numberToColumn(column)] = text
    }

    let seat = 0
    let name = 0
    let score = 0
    let grade = 0
    for (const [column, text] of texts) {
      if (!seat && /座號/.test(text)) seat = column
      else if (!name && /(姓名|名字)/.test(text)) name = column
      else if (!score && /(分數|成績|總分|得分)/.test(text)) score = column
      else if (!grade && /(等第|等級|評等)/.test(text)) grade = column
    }
    if (!seat) continue

    if (!score) {
      const excluded = new Set([seat, name, grade])
      for (const [column, text] of texts) {
        if (excluded.has(column)) continue
        if (/(編號|序號|學號|班號|備註)/.test(text)) continue
        let numeric = 0
        let filled = 0
        for (let offset = 1; offset <= 5; offset += 1) {
          const value = cellText(sheet.getRow(rowNumber + offset).getCell(column).value)
          if (!value) continue
          filled += 1
          if (Number.isFinite(Number(value.replace(/,/g, '')))) numeric += 1
        }
        if (filled > 0 && numeric / filled >= 0.5) {
          score = column
          break
        }
      }
    }

    const rank = 2 + (name ? 1 : 0) + (score ? 1.5 : 0) + (grade ? 1 : 0)
    if (!best || rank > best.score) {
      best = {
        score: rank,
        row: rowNumber,
        seat,
        name: name || undefined,
        scoreColumn: score || undefined,
        grade: grade || undefined,
        headers
      }
    }
  }

  if (!best) return null

  const detection: GradebookDetection = {
    headerRow: best.row,
    seatColumn: numberToColumn(best.seat),
    nameColumn: best.name ? numberToColumn(best.name) : undefined,
    scoreColumn: best.scoreColumn ? numberToColumn(best.scoreColumn) : 'D',
    gradeColumn: best.grade ? numberToColumn(best.grade) : undefined,
    seatFormat: '{seat}',
    headers: best.headers
  }

  const warning = best.scoreColumn
    ? undefined
    : '找不到分數欄，暫用 D 欄；請手動確認欄位。'

  return { detection, warning }
}

function previewRows(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = []
  const maxRow = Math.min(6, Math.max(sheet.rowCount, 1))
  const maxColumn = Math.min(12, Math.max(sheet.columnCount, 1))
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const values: string[] = []
    for (let column = 1; column <= maxColumn; column += 1) {
      values.push(cellText(row.getCell(column).value))
    }
    if (values.some(Boolean)) rows.push(values)
  }
  return rows
}

/** 讀取工作表清單、前幾列與表頭建議；不寫入任何檔案。 */
export async function inspectGradebook(
  path: string,
  sheetName?: string
): Promise<GradebookInspection> {
  const resolved = resolve(path)
  const ext = extname(resolved).toLowerCase()
  if (!SUPPORTED.has(ext)) {
    throw new Error('只支援 Excel 成績表（.xlsx；舊格式與巨集檔請用匯出模式）。')
  }

  const info = await requireFile(resolved, '成績表檔案')

  const assessment = await assessSource(resolved)
  const workbook = new ExcelJS.Workbook()
  try {
    await withRetry('讀取成績表', () => workbook.xlsx.readFile(resolved))
  } catch (error) {
    if (assessment.exportOnly) {
      return {
        path: resolved,
        sheets: [],
        sheet: sheetName ?? null,
        preview: [],
        detection: null,
        exportOnly: true,
        exportReason: assessment.reason,
        warning: '此格式無法讀取工作表，仍可用「匯出新檔」模式寫入乾淨的 xlsx。'
      }
    }
    throw new Error(`無法讀取成績表：${friendly(error)}`)
  }

  const sheets: GradebookSheetInfo[] = workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount
  }))
  if (sheets.length === 0) throw new Error('這個 Excel 沒有工作表。')

  const selected =
    (sheetName && workbook.getWorksheet(sheetName)) || workbook.worksheets[0]
  if (sheetName && !workbook.getWorksheet(sheetName)) {
    throw new Error(`找不到工作表「${sheetName}」。`)
  }

  const detected = detectHeader(selected)
  const warnings: string[] = []
  if (assessment.reason) warnings.push(assessment.reason)
  if (detected?.warning) warnings.push(detected.warning)
  if (!detected) warnings.push('前 10 列找不到「座號」表頭，請手動設定欄位。')

  return {
    path: resolved,
    sheets,
    sheet: selected.name,
    preview: previewRows(selected),
    detection: detected?.detection ?? null,
    exportOnly: assessment.exportOnly,
    exportReason: assessment.reason,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined
  }
}

export async function chooseGradebook(
  classId: string,
  assignmentId: string
): Promise<GradebookChooseResult> {
  const current = await loadGradebookConfig(classId, assignmentId).catch(() => null)
  const result = await dialog.showOpenDialog({
    title: '選擇成績表',
    buttonLabel: '選擇',
    defaultPath: current?.gradebook.path,
    properties: ['openFile'],
    filters: [{ name: 'Excel 成績表', extensions: ['xlsx'] }]
  })

  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  const inspection = await inspectGradebook(result.filePaths[0])
  return { canceled: false, ...inspection }
}

export async function loadGradebookConfig(
  classId: string,
  assignmentId: string
): Promise<GradebookConfig | null> {
  const path = gradebookPath(classId, assignmentId)
  try {
    await stat(path)
  } catch {
    return null
  }
  try {
    const result = await readJsonRecovering(path, GradebookConfigSchema)
    return result.data
  } catch {
    throw new Error('成績表設定檔損壞，請重新按「選擇成績表」並儲存設定。')
  }
}

function requireColumn(label: string, value: string): string {
  const trimmed = value.trim().toUpperCase()
  if (!/^[A-Z]{1,3}$/.test(trimmed)) {
    throw new Error(`${label}欄位格式錯誤：請填 Excel 欄位代號，例如 B、D、AA。`)
  }
  return trimmed
}

export async function saveGradebookConfig(
  classId: string,
  assignmentId: string,
  gradebook: GradebookConfig['gradebook']
): Promise<GradebookConfig> {
  const path = (gradebook.path ?? '').trim()
  const sheet = (gradebook.sheet ?? '').trim()
  const headerRow = Number(gradebook.header_row)
  if (!path) throw new Error('請選擇成績表檔案。')
  if (!SUPPORTED.has(extname(path).toLowerCase())) {
    throw new Error('成績表只接受 Excel 檔案（.xlsx；.xlsm／.xltm／.xlsb／.xls 會走匯出模式）。')
  }
  if (!sheet) throw new Error('請選擇或填寫工作表名稱。')
  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new Error('表頭列格式錯誤：請填 1 以上的整數。')
  }

  const parsed = GradebookConfigSchema.parse({
    schema_version: 1,
    gradebook: {
      ...gradebook,
      path,
      sheet,
      header_row: headerRow,
      seat_column: requireColumn('座號', gradebook.seat_column),
      name_column: gradebook.name_column
        ? requireColumn('姓名', gradebook.name_column)
        : undefined,
      score_column: requireColumn('分數', gradebook.score_column),
      grade_column: gradebook.grade_column
        ? requireColumn('等第', gradebook.grade_column)
        : undefined,
      seat_format: (gradebook.seat_format ?? '').trim() || '{seat}'
    }
  })
  await writeJsonAtomic(gradebookPath(classId, assignmentId), parsed)
  logInfo(`[gradebook] 設定已儲存：sheet=${parsed.gradebook.sheet}`)
  return parsed
}

function resolvedFromConfig(config: GradebookConfig, overrides?: string): ResolvedGradebook {
  const gradebook = config.gradebook
  return {
    path: overrides ?? gradebook.path,
    sheet: gradebook.sheet,
    headerRow: gradebook.header_row,
    seatColumn: gradebook.seat_column,
    nameColumn: gradebook.name_column,
    scoreColumn: gradebook.score_column,
    gradeColumn: gradebook.grade_column,
    seatFormat: gradebook.seat_format
  }
}

interface RowIndex {
  rows: Map<string, number>
  duplicates: GradebookDuplicate[]
  invalid: number
  blank: number
  snapshot: Map<number, { seat: string; name: string }>
}

function buildIndex(sheet: ExcelJS.Worksheet, config: ResolvedGradebook): RowIndex {
  const seatColumn = columnToNumber(config.seatColumn)
  const nameColumn = config.nameColumn ? columnToNumber(config.nameColumn) : null
  const rows = new Map<string, number>()
  const duplicateRows = new Map<string, number[]>()
  const snapshot = new Map<number, { seat: string; name: string }>()
  let invalid = 0
  let blank = 0

  for (let rowNumber = config.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const rawSeat = cellText(row.getCell(seatColumn).value)
    const name = nameColumn ? cellText(row.getCell(nameColumn).value) : ''
    if (!rawSeat) {
      blank += 1
      continue
    }

    const seat = normalizeSeat(rawSeat)
    if (!seat) {
      invalid += 1
      continue
    }

    const existing = duplicateRows.get(seat) ?? []
    existing.push(rowNumber)
    duplicateRows.set(seat, existing)
    if (!rows.has(seat)) {
      rows.set(seat, rowNumber)
      snapshot.set(rowNumber, { seat: rawSeat, name })
    }
  }

  const duplicates = [...duplicateRows.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([seat, list]) => ({ seat, rows: list.sort((a, b) => a - b) }))
    .sort((a, b) => a.seat.localeCompare(b.seat))

  return { rows, duplicates, invalid, blank, snapshot }
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

/** 匯出待寫回清單；任何失敗流程都會呼叫，確保分數不會卡在程式裡。 */
export async function writeGradebookCsv(
  classId: string,
  assignmentId: string,
  now: Date = new Date()
): Promise<GradebookCsvResult> {
  const works = await listWorks(classId, assignmentId)
  const rows: string[][] = [['座號', '姓名', '分數', '等第', '狀態']]

  for (const work of works) {
    const full = await loadWork(classId, assignmentId, work.seat)
    rows.push([
      full.seat,
      full.name,
      full.scores ? String(full.scores.total) : '',
      full.scores?.grade ?? '',
      statusLabel(full.status)
    ])
  }

  const dir = outputDir(classId, assignmentId)
  await mkdir(dir, { recursive: true })
  const path = await uniqueFile(join(dir, `grades-${stamp(now)}`), '.csv')
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  await withRetry('寫入 CSV', async () => {
    const tmp = `${path}.tmp`
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  })

  return { path, rows: rows.length - 1 }
}

function emptyReport(sourcePath: string): GradebookWriteReport {
  return {
    ok: false,
    mode: 'copy',
    sourcePath,
    outputPath: null,
    csvPath: null,
    sheet: '',
    headerRow: 1,
    written: 0,
    verified: false,
    changes: [],
    unmatched: [],
    incomplete: [],
    duplicates: [],
    warnings: [],
    verification: null,
    elapsedMs: 0
  }
}

async function safeCsv(
  classId: string,
  assignmentId: string,
  report: GradebookWriteReport,
  now: Date
): Promise<void> {
  if (report.csvPath) return
  try {
    const csv = await writeGradebookCsv(classId, assignmentId, now)
    report.csvPath = csv.path
  } catch (error) {
    logWarn(`[gradebook] CSV 匯出失敗：${toMessage(error)}`)
    report.warnings.push('CSV 匯出也失敗，請確認作業資料夾可寫入。')
  }
}

async function collectWorks(
  classId: string,
  assignmentId: string,
  summaries: WorkSummary[],
  report: GradebookWriteReport
): Promise<Array<{ seat: string; name: string; total: number; grade: string | null }>> {
  const candidates: Array<{ seat: string; name: string; total: number; grade: string | null }> = []

  for (const summary of summaries) {
    if (summary.status !== 'done') {
      report.incomplete.push({
        seat: summary.seat,
        name: summary.name,
        status: summary.status,
        reason: '未完成，未寫入'
      })
      continue
    }

    const work = await loadWork(classId, assignmentId, summary.seat)
    if (!work.scores) {
      report.incomplete.push({
        seat: work.seat,
        name: work.name,
        status: work.status,
        reason: '已批但沒有分數，未寫入'
      })
      continue
    }

    candidates.push({
      seat: work.seat,
      name: work.name,
      total: work.scores.total,
      grade: work.scores.grade ?? null
    })
  }

  return candidates
}

function buildExportSheet(
  workbook: ExcelJS.Workbook,
  candidates: Array<{ seat: string; name: string; total: number; grade: string | null }>
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet('成績')
  sheet.addRow(['座號', '姓名', '分數', '等第'])
  sheet.getRow(1).font = { bold: true }
  sheet.columns = [{ width: 10 }, { width: 18 }, { width: 10 }, { width: 10 }]

  for (const candidate of candidates) {
    sheet.addRow([candidate.seat, candidate.name, candidate.total, candidate.grade ?? ''])
  }
  return sheet
}

async function verifyExport(
  outputPath: string,
  candidates: Array<{ seat: string; name: string; total: number; grade: string | null }>
): Promise<GradebookVerification> {
  const workbook = new ExcelJS.Workbook()
  await withRetry('驗證匯出檔', () => workbook.xlsx.readFile(outputPath))
  const sheet = workbook.getWorksheet('成績')
  if (!sheet) {
    throw new VerificationError('驗證失敗：匯出檔找不到「成績」工作表。', ['缺少工作表'], {
      rowCountBefore: candidates.length + 1,
      rowCountAfter: 0,
      checked: 0,
      unchangedSeatAndName: false,
      failures: ['缺少工作表']
    })
  }

  const failures: string[] = []
  for (let index = 0; index < candidates.length; index += 1) {
    const row = sheet.getRow(index + 2)
    const seat = cellText(row.getCell(1).value)
    const name = cellText(row.getCell(2).value)
    const score = row.getCell(3).value
    if (normalizeSeat(seat) !== candidates[index].seat) failures.push(`第 ${index + 2} 列座號不符`)
    if (name !== candidates[index].name) failures.push(`第 ${index + 2} 列姓名不符`)
    if (Number(score) !== candidates[index].total) failures.push(`第 ${index + 2} 列分數不符`)
    const grade = cellText(row.getCell(4).value)
    if (grade !== (candidates[index].grade ?? '')) failures.push(`第 ${index + 2} 列等第不符`)
  }

  return {
    rowCountBefore: candidates.length + 1,
    rowCountAfter: sheet.rowCount,
    checked: candidates.length,
    unchangedSeatAndName: true,
    failures
  }
}

/**
 * 成績寫回主流程：只寫 done 且有分數的作品。
 * 先建索引與檢查重複，再複製原檔、寫副本、重新開啟驗證。
 */
export async function writeGradebook(
  options: GradebookWriteOptions
): Promise<GradebookWriteReport> {
  const started = Date.now()
  const now = options.now ?? new Date()
  const { classId, assignmentId } = options
  const report = emptyReport(options.sourcePath ?? '')
  report.csvPath = null

  try {
    const config = await loadGradebookConfig(classId, assignmentId)
    if (!config && !options.sourcePath) {
      throw new Error('尚未設定成績表，請先按「選擇成績表」並儲存設定。')
    }

    const sourcePath = resolve(options.sourcePath ?? config!.gradebook.path)
    report.sourcePath = sourcePath
    if (!SUPPORTED.has(extname(sourcePath).toLowerCase())) {
      throw new Error('只支援 Excel 成績表（.xlsx／.xlsm／.xltm／.xlsb／.xls）。')
    }

    await requireFile(sourcePath, '成績表')

    const resolved: ResolvedGradebook | null = config
      ? resolvedFromConfig(config, sourcePath)
      : null
    const assessment = await assessSource(sourcePath)

    // 作品名單先讀，沒有可寫作品就不必碰 Excel。
    const summaries = await listWorks(classId, assignmentId)
    const candidates = await collectWorks(classId, assignmentId, summaries, report)
    if (candidates.length === 0) {
      throw new Error('沒有可寫回的作品；需要狀態為「已批」且已有分數。')
    }

    if (assessment.exportOnly || !resolved) {
      if (!assessment.exportOnly && !resolved) {
        throw new Error('尚未設定成績表欄位，請先完成設定再寫回。')
      }
      report.mode = 'export'
      report.sheet = '成績'
      report.headerRow = 1
      if (assessment.reason) report.warnings.push(assessment.reason)

      const outputPath = resolve(options.outputPath ?? gradedPath(sourcePath, now, '.xlsx'))
      if (outputPath.toLowerCase() === sourcePath.toLowerCase()) {
        throw new Error('輸出路徑不可與原檔相同，原檔永遠不會被覆蓋。')
      }

      const workbook = new ExcelJS.Workbook()
      buildExportSheet(workbook, candidates)
      const buffer = await workbook.xlsx.writeBuffer()
      await withRetry('寫入匯出檔', async () => {
        const tmp = `${outputPath}.tmp`
        await writeFile(tmp, Buffer.from(buffer))
        await rename(tmp, outputPath)
      })
      report.outputPath = outputPath

      const verification = await verifyExport(outputPath, candidates)
      report.verification = verification
      report.written = candidates.length
      report.changes = candidates.map((candidate, index) => ({
        seat: candidate.seat,
        name: candidate.name,
        row: index + 2,
        scoreBefore: null,
        scoreAfter: candidate.total,
        gradeBefore: null,
        gradeAfter: candidate.grade
      }))

      if (verification.failures.length > 0) {
        throw new VerificationError(
          `匯出檔驗證失敗：${verification.failures.join('；')}`,
          verification.failures,
          verification
        )
      }

      report.verified = true
      report.ok = true
      logInfo(`[gradebook] 匯出模式完成：written=${report.written}`)
      report.elapsedMs = Date.now() - started
      return report
    }

    report.sheet = resolved.sheet
    report.headerRow = resolved.headerRow
    if (!resolved.gradeColumn) {
      report.warnings.push('未設定等第欄，只寫分數。')
    }

    // 先讀原檔建索引；重複座號必須在複製前中止。
    const sourceWorkbook = new ExcelJS.Workbook()
    await withRetry('讀取成績表', () => sourceWorkbook.xlsx.readFile(sourcePath))
    const sourceSheet = sourceWorkbook.getWorksheet(resolved.sheet)
    if (!sourceSheet) throw new Error(`找不到工作表「${resolved.sheet}」。`)

    const index = buildIndex(sourceSheet, resolved)
    if (index.duplicates.length > 0) {
      report.duplicates = index.duplicates
      const detail = index.duplicates
        .map((item) => `座號 ${item.seat}（第 ${item.rows.join('、')} 列）`)
        .join('；')
      throw new Error(`成績表座號重複，已中止寫回：${detail}`)
    }
    if (index.rows.size === 0) {
      throw new Error(
        `座號欄 ${resolved.seatColumn} 從第 ${resolved.headerRow + 1} 列起沒有可辨識的座號。`
      )
    }
    if (index.invalid > 0) {
      report.warnings.push(`有 ${index.invalid} 列座號格式無法辨識，已略過。`)
    }

    const outputPath = resolve(options.outputPath ?? gradedPath(sourcePath, now))
    if (outputPath.toLowerCase() === sourcePath.toLowerCase()) {
      throw new Error('輸出路徑不可與原檔相同，原檔永遠不會被覆蓋。')
    }

    // 先複製原檔；原檔位元組從頭到尾都不會被寫入。
    await withRetry('複製成績表', () => copyFile(sourcePath, outputPath))

    report.outputPath = outputPath
    const rowCountBefore = sourceSheet.rowCount

    const matched: Array<{
      candidate: (typeof candidates)[number]
      row: number
      scoreBefore: number | null
      gradeBefore: string | null
    }> = []

    for (const candidate of candidates) {
      const row = index.rows.get(candidate.seat)
      if (!row) {
        report.unmatched.push({
          seat: candidate.seat,
          name: candidate.name,
          reason: '座號不在成績表'
        })
        continue
      }

      const sheetRow = sourceSheet.getRow(row)
      const scoreCell = sheetRow.getCell(columnToNumber(resolved.scoreColumn))
      const gradeCell = resolved.gradeColumn
        ? sheetRow.getCell(columnToNumber(resolved.gradeColumn))
        : null
      const scoreBefore =
        scoreCell.value === null || scoreCell.value === undefined || scoreCell.value === ''
          ? null
          : Number(scoreCell.value)
      const gradeBefore = gradeCell ? cellText(gradeCell.value) || null : null

      matched.push({
        candidate,
        row,
        scoreBefore: Number.isFinite(scoreBefore as number) ? (scoreBefore as number) : null,
        gradeBefore
      })
    }

    const copyWorkbook = new ExcelJS.Workbook()
    await withRetry('讀取副本', () => copyWorkbook.xlsx.readFile(outputPath))
    const copySheet = copyWorkbook.getWorksheet(resolved.sheet)
    if (!copySheet) throw new Error(`副本找不到工作表「${resolved.sheet}」。`)

    const expected: Array<{
      row: number
      seat: string
      name: string
      score: number
      grade: string | null
    }> = []

    for (const item of matched) {
      const sheetRow = copySheet.getRow(item.row)
      sheetRow.getCell(columnToNumber(resolved.scoreColumn)).value = item.candidate.total
      if (resolved.gradeColumn) {
        const gradeCell = sheetRow.getCell(columnToNumber(resolved.gradeColumn))
        if (item.candidate.grade !== null) gradeCell.value = item.candidate.grade
      }
      const before = index.snapshot.get(item.row)
      expected.push({
        row: item.row,
        seat: before?.seat ?? '',
        name: before?.name ?? '',
        score: item.candidate.total,
        grade: resolved.gradeColumn ? item.candidate.grade : null
      })
      report.changes.push({
        seat: item.candidate.seat,
        name: item.candidate.name,
        row: item.row,
        scoreBefore: item.scoreBefore,
        scoreAfter: item.candidate.total,
        gradeBefore: item.gradeBefore,
        gradeAfter: resolved.gradeColumn ? item.candidate.grade : null
      })
    }

    report.written = matched.length

    const buffer = await copyWorkbook.xlsx.writeBuffer()
    await withRetry('寫入副本', async () => {
      const tmp = `${outputPath}.tmp`
      await writeFile(tmp, Buffer.from(buffer))
      await rename(tmp, outputPath)
    })

    // 重新開啟副本驗證：列數、每一列分數與等第、座號與姓名未變。
    const verifyWorkbook = new ExcelJS.Workbook()
    await withRetry('驗證副本', () => verifyWorkbook.xlsx.readFile(outputPath))
    const verifySheet = verifyWorkbook.getWorksheet(resolved.sheet)
    const failures: string[] = []
    let verified = Boolean(verifySheet)
    let rowCountAfter = 0
    let unchangedSeatAndName = true

    if (!verifySheet) {
      failures.push('副本找不到原來的工作表')
    } else {
      rowCountAfter = verifySheet.rowCount
      if (rowCountAfter !== rowCountBefore) {
        failures.push(`列數改變（${rowCountBefore} → ${rowCountAfter}）`)
      }

      const seatColumn = columnToNumber(resolved.seatColumn)
      const nameColumn = resolved.nameColumn ? columnToNumber(resolved.nameColumn) : null
      for (const [rowNumber, snapshot] of index.snapshot) {
        const row = verifySheet.getRow(rowNumber)
        if (cellText(row.getCell(seatColumn).value) !== snapshot.seat) {
          unchangedSeatAndName = false
          failures.push(`第 ${rowNumber} 列座號被改動`)
        }
        if (nameColumn && cellText(row.getCell(nameColumn).value) !== snapshot.name) {
          unchangedSeatAndName = false
          failures.push(`第 ${rowNumber} 列姓名被改動`)
        }
      }

      for (const item of expected) {
        const row = verifySheet.getRow(item.row)
        const scoreValue = row.getCell(columnToNumber(resolved.scoreColumn)).value
        if (Number(scoreValue) !== item.score) {
          failures.push(`第 ${item.row} 列分數不符`)
        }
        if (resolved.gradeColumn && item.grade !== null) {
          const gradeValue = cellText(row.getCell(columnToNumber(resolved.gradeColumn)).value)
          if (gradeValue !== item.grade) failures.push(`第 ${item.row} 列等第不符`)
        }
      }
    }

    const verification: GradebookVerification = {
      rowCountBefore,
      rowCountAfter,
      checked: expected.length,
      unchangedSeatAndName,
      failures
    }
    report.verification = verification
    if (failures.length > 0) verified = false

    if (!verified) {
      throw new VerificationError(
        `副本驗證失敗：${failures.join('；')}`,
        failures,
        verification
      )
    }

    report.verified = true
    report.ok = true
    logInfo(`[gradebook] 寫回完成：written=${report.written} unmatched=${report.unmatched.length}`)
  } catch (error) {
    report.ok = false
    report.error = friendly(error)
    if (error instanceof VerificationError) {
      report.verification = error.verification
    }
    // 任何失敗都不留下半成品；只有原檔與 CSV 可以保留。
    if (report.outputPath) {
      try {
        await rm(report.outputPath, { force: true })
      } catch {
        report.warnings.push('無法刪除失敗的輸出檔，請勿使用該檔案。')
      }
      report.outputPath = null
    }
    logWarn(`[gradebook] 寫回失敗：${report.error}`)
  }

  await safeCsv(classId, assignmentId, report, now)
  report.elapsedMs = Date.now() - started
  return report
}

export async function revealGradebook(path?: string): Promise<{ opened: boolean }> {
  if (!path) throw new Error('尚無可開啟的輸出檔案。')
  const info = await stat(path).catch(() => null)
  if (info?.isFile()) {
    shell.showItemInFolder(resolve(path))
  } else {
    await shell.openPath(resolve(path))
  }
  return { opened: true }
}
