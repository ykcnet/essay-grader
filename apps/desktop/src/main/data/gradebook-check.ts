import { app, BrowserWindow } from 'electron'
import ExcelJS from 'exceljs'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { flushLogs, setLogDirectoryForCheck } from '../logger'
import {
  closeDatabase,
  createAssignment,
  createClass,
  currentRoot,
  loadWork,
  openDatabase,
  saveClass,
  saveWork
} from './repository'
import {
  inspectGradebook,
  loadGradebookConfig,
  saveGradebookConfig,
  writeGradebook,
  writeGradebookCsv
} from './gradebook'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const NOW = '2026-11-20T09:00:00.000Z'
const CLASS_NAME = '高中302'
const SHEET = '作文'

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  const object = value as { text?: unknown; richText?: Array<{ text: string }>; result?: unknown }
  if (Array.isArray(object.richText)) return object.richText.map((part) => part.text).join('')
  if (object.text !== undefined) return String(object.text)
  if (object.result !== undefined) return cellText(object.result as ExcelJS.CellValue)
  return ''
}

async function createTestWorkbook(path: string, duplicate = false): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(SHEET)
  sheet.addRow(['編號', '座號', '姓名', '作文一', '等第'])
  if (duplicate) {
    sheet.addRow([1, 7, '王小明', 0, ''])
    sheet.addRow([2, '07', '王小明', 0, ''])
    sheet.addRow([3, '08', '陳大華', 0, ''])
  } else {
    sheet.addRow([1, 7, '王小明', 0, ''])
    sheet.addRow([2, '08', '陳大華', 0, ''])
    sheet.addRow([3, 'S12', '林小華', 0, ''])
    sheet.addRow([4, 99, '測試生', 0, ''])
  }
  await workbook.xlsx.writeFile(path)
}

interface SheetValues {
  rowCount: number
  rows: string[][]
}

async function readSheet(path: string, name: string): Promise<SheetValues> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const sheet = workbook.getWorksheet(name)
  if (!sheet) throw new Error(`找不到工作表 ${name}`)
  const rows: string[][] = []
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const values: string[] = []
    for (let column = 1; column <= 5; column += 1) {
      values.push(cellText(sheet.getRow(row).getCell(column).value))
    }
    rows.push(values)
  }
  return { rowCount: sheet.rowCount, rows }
}

function waitFor(win: BrowserWindow, expression: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  return (async () => {
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = (await win.webContents.executeJavaScript(`Boolean(${expression})`)) as boolean
        if (ok) return true
      } catch {
        // 頁面還在下載
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    return false
  })()
}

async function runUiSmoke(): Promise<{ ok: boolean; detail: string }> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const mainReady = await waitFor(
      win,
      "document.body.innerText.includes('作文批閱') && !document.body.innerText.includes('載入中')",
      8000
    )
    if (!mainReady) return { ok: false, detail: '主畫面未渲染' }

    const assignmentReady = await waitFor(win, "document.querySelector('.assignment-row')", 8000)
    if (!assignmentReady) return { ok: false, detail: '找不到作業列' }
    await win.webContents.executeJavaScript(
      "document.querySelector('.assignment-row')?.click()"
    )

    const buttonReady = await waitFor(
      win,
      `[...document.querySelectorAll('.import-panel .card-head button')].some(
        (item) => item.textContent?.trim() === '成績寫回'
      )`,
      8000
    )
    if (!buttonReady) return { ok: false, detail: '找不到「成績寫回」按鈕' }

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.import-panel .card-head button')]
        .find((item) => item.textContent?.trim() === '成績寫回')?.click()`
    )

    const panelReady = await waitFor(win, "document.querySelector('.gradebook-panel')", 8000)
    const configReady = panelReady
      ? await waitFor(
          win,
          `document.querySelector('.gradebook-panel')?.textContent?.includes('${SHEET}')`,
          8000
        )
      : false
    if (!panelReady || !configReady) {
      return { ok: false, detail: `面板 ${panelReady ? '有' : '無'}、設定 ${configReady ? '有' : '無'}` }
    }

    const text = (await win.webContents.executeJavaScript(
      "document.querySelector('.gradebook-panel')?.innerText ?? ''"
    )) as string

    const buttons = ['選擇成績表', '自動偵測', '儲存設定', '寫回成績', '匯出 CSV', '開啟輸出資料夾']
    const missing = buttons.filter((label) => !text.includes(label))

    const apiReady = (await win.webContents.executeJavaScript(
      `Boolean(
        window.electronAPI &&
        typeof window.electronAPI.gradebook?.getConfig === 'function' &&
        typeof window.electronAPI.gradebook?.chooseFile === 'function' &&
        typeof window.electronAPI.gradebook?.inspect === 'function' &&
        typeof window.electronAPI.gradebook?.saveConfig === 'function' &&
        typeof window.electronAPI.gradebook?.write === 'function' &&
        typeof window.electronAPI.gradebook?.exportCsv === 'function' &&
        typeof window.electronAPI.gradebook?.reveal === 'function'
      )`
    )) as boolean

    return {
      ok: missing.length === 0 && apiReady,
      detail: `按鈕 ${missing.length === 0 ? '齊全' : `缺 ${missing.join('、')}`}、preload ${
        apiReady ? '是' : '否'
      }`
    }
  } finally {
    win.destroy()
  }
}

/** `--excel-check`：成績寫回 Excel 的副本、驗證、重複、匯出模式、CSV 與 UI。 */
export async function runExcelCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'e6')
  const root = join(work, 'db')
  const sourcePath = join(work, 'gradebook.xlsx')
  const duplicatePath = join(work, 'duplicate.xlsx')
  const macroPath = join(work, 'gradebook.xlsm')
  const chartPath = join(work, 'chart.xlsx')
  const logsDir = join(work, 'logs')

  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  setLogDirectoryForCheck(logsDir)

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    // ---- 測試資料庫 ----------------------------------------------------
    await openDatabase(root, { remember: false })
    const created = await createClass({
      classNo: '302',
      name: CLASS_NAME,
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: '王老師'
    })

    await saveClass({
      schema_version: 1,
      id: created.id,
      name: CLASS_NAME,
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: '王老師',
      students: [
        { seat: '07', name: '王小明', active: true },
        { seat: '08', name: '陳大華', active: true },
        { seat: '12', name: '林小華', active: true },
        { seat: '15', name: '張小美', active: true },
        { seat: '20', name: '李大同', active: true }
      ]
    })

    const assignment = (await createAssignment({
      classId: created.id,
      title: '作文一',
      prompt: '',
      rubricPreset: 'balanced'
    })) as { id: string }

    const addWork = async (
      seat: string,
      name: string,
      status: 'done' | 'grading',
      total: number,
      grade: string
    ): Promise<void> => {
      const dir = join(root, created.id, assignment.id, `S${seat}`)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'p1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
      await saveWork(created.id, assignment.id, seat, {
        schema_version: 1,
        class_id: created.id,
        assignment_id: assignment.id,
        seat,
        name,
        status,
        pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
        annotations: [],
        scores: {
          items: { content: 30, structure: 25, language: 25 },
          deduction: { typo: 0, punct: 0, override: null },
          total,
          grade
        },
        updated_at: NOW
      })
    }

    await addWork('07', '王小明', 'done', 81, 'A-')
    await addWork('08', '陳大華', 'done', 74, 'B++')
    await addWork('12', '林小華', 'done', 90, 'A++')
    await addWork('15', '張小美', 'done', 66, 'B+')
    await addWork('20', '李大同', 'grading', 55, 'C')

    await createTestWorkbook(sourcePath)
    await createTestWorkbook(duplicatePath, true)
    await copyFile(sourcePath, macroPath)
    const chartBytes = await readFile(sourcePath)
    await writeFile(chartPath, Buffer.concat([chartBytes, Buffer.from('xl/charts/chart1.xml')]))

    add('建立暫存資料庫與測試 xlsx', currentRoot() === root, `${created.id}／${assignment.id}`)

    // ---- 設定 ----------------------------------------------------------
    await saveGradebookConfig(created.id, assignment.id, {
      path: sourcePath,
      sheet: SHEET,
      header_row: 1,
      seat_column: 'B',
      name_column: 'C',
      score_column: 'D',
      grade_column: 'E',
      seat_format: '{seat}'
    })
    const loaded = await loadGradebookConfig(created.id, assignment.id)
    const configPath = join(root, created.id, assignment.id, 'gradebook.json')
    const configInfo = await stat(configPath).catch(() => null)
    add(
      '設定存到 gradebook.json 並可重讀',
      Boolean(configInfo?.isFile()) &&
        loaded?.gradebook.path === sourcePath &&
        loaded?.gradebook.sheet === SHEET &&
        loaded?.gradebook.seat_column === 'B' &&
        loaded?.gradebook.score_column === 'D',
      `${configInfo?.size ?? 0} bytes`
    )

    const inspection = await inspectGradebook(sourcePath)
    add(
      '讀取工作表與自動偵測',
      inspection.sheets.some((sheet) => sheet.name === SHEET) &&
        inspection.detection?.headerRow === 1 &&
        inspection.detection?.seatColumn === 'B' &&
        inspection.detection?.nameColumn === 'C' &&
        inspection.detection?.scoreColumn === 'D' &&
        inspection.detection?.gradeColumn === 'E' &&
        inspection.preview.length >= 4,
      `建議 ${inspection.detection?.seatColumn ?? '—'}／${inspection.detection?.scoreColumn ?? '—'}，預覽 ${inspection.preview.length} 列`
    )

    // ---- 第一次寫回 ----------------------------------------------------
    const originalBefore = await readFile(sourcePath)
    const first = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      now: new Date(2026, 10, 20, 10, 0, 0)
    })
    const originalAfter = await readFile(sourcePath)
    const firstExists = first.outputPath
      ? await stat(first.outputPath).then((info) => info.isFile()).catch(() => false)
      : false

    add(
      '寫回成功且 verified=true',
      first.ok && first.verified && first.written === 3,
      `ok=${first.ok}、verified=${first.verified}、written=${first.written}`
    )
    add(
      '原檔位元組完全不變',
      originalBefore.equals(originalAfter),
      `${originalBefore.length} bytes`
    )
    add(
      '副本存在且檔名含 graded-時間',
      firstExists &&
        basename(first.outputPath ?? '') === 'gradebook.graded-20261120-100000.xlsx',
      basename(first.outputPath ?? '（無）')
    )
    add(
      '報告含 changes 前後值',
      first.changes.length === 3 &&
        first.changes.every(
          (change) => change.scoreBefore === 0 && Number.isFinite(change.scoreAfter)
        ) &&
        first.changes.some((change) => change.seat === '07' && change.scoreAfter === 81) &&
        first.changes.some((change) => change.seat === '08' && change.scoreAfter === 74) &&
        first.changes.some((change) => change.seat === '12' && change.scoreAfter === 90),
      first.changes.map((change) => `${change.seat}:${change.scoreBefore}→${change.scoreAfter}`).join('、')
    )
    add(
      'S15 未匹配、S20 未完成未寫入',
      first.unmatched.some((item) => item.seat === '15') &&
        first.incomplete.some((item) => item.seat === '20' && item.reason.includes('未完成')),
      `unmatched ${first.unmatched.length}、incomplete ${first.incomplete.length}`
    )

    const copySheet = await readSheet(first.outputPath ?? sourcePath, SHEET)
    const row = (seat: string): string[] => {
      const index = copySheet.rows.findIndex((values) => values[1] === seat)
      return index >= 0 ? copySheet.rows[index] : []
    }
    add(
      '副本分數與等第正確、列數不變',
      copySheet.rowCount === 5 &&
        row('7')[3] === '81' &&
        row('7')[4] === 'A-' &&
        row('08')[3] === '74' &&
        row('08')[4] === 'B++' &&
        row('S12')[3] === '90' &&
        row('S12')[4] === 'A++',
      `列數 ${copySheet.rowCount}`
    )
    add(
      '副本座號與姓名未被改、未寫入列保持空白',
      row('7')[2] === '王小明' &&
        row('08')[2] === '陳大華' &&
        row('S12')[2] === '林小華' &&
        row('99')[3] === '0' &&
        row('99')[4] === '',
      '99 列未動'
    )

    // ---- 重複寫回 ------------------------------------------------------
    const second = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      now: new Date(2026, 10, 20, 10, 0, 1)
    })
    const originalThird = await readFile(sourcePath)
    add(
      '重複寫回產生新副本、原檔仍不變',
      second.ok &&
        second.verified &&
        Boolean(second.outputPath) &&
        second.outputPath !== first.outputPath &&
        basename(second.outputPath ?? '') === 'gradebook.graded-20261120-100001.xlsx' &&
        originalBefore.equals(originalThird),
      basename(second.outputPath ?? '（無）')
    )

    // ---- 檔名碰撞 ------------------------------------------------------
    const collision = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      now: new Date(2026, 10, 20, 10, 0, 0)
    })
    const originalAfterCollision = await readFile(sourcePath)
    add(
      '檔名碰撞自動加 -02',
      collision.ok &&
        basename(collision.outputPath ?? '') === 'gradebook.graded-20261120-100000-02.xlsx' &&
        originalBefore.equals(originalAfterCollision),
      basename(collision.outputPath ?? '（無）')
    )

    // ---- 座號重複 ------------------------------------------------------
    await saveGradebookConfig(created.id, assignment.id, {
      path: duplicatePath,
      sheet: SHEET,
      header_row: 1,
      seat_column: 'B',
      name_column: 'C',
      score_column: 'D',
      grade_column: 'E',
      seat_format: '{seat}'
    })
    const duplicateBefore = await readFile(duplicatePath)
    const duplicate = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      now: new Date(2026, 10, 20, 10, 0, 2)
    })
    const duplicateAfter = await readFile(duplicatePath)
    add(
      '座號重複會中止並回報列號',
      !duplicate.ok &&
        duplicate.duplicates.length === 1 &&
        duplicate.duplicates[0].seat === '07' &&
        duplicate.duplicates[0].rows.join(',') === '2,3' &&
        duplicate.outputPath === null &&
        duplicateBefore.equals(duplicateAfter) &&
        Boolean(duplicate.csvPath),
      duplicate.duplicates.map((item) => `${item.seat}:${item.rows.join('/')}`).join('、')
    )

    // ---- 錯誤訊息 ------------------------------------------------------
    let columnRejected = ''
    try {
      await saveGradebookConfig(created.id, assignment.id, {
        path: sourcePath,
        sheet: SHEET,
        header_row: 1,
        seat_column: '1',
        score_column: 'D',
        seat_format: '{seat}'
      })
    } catch (error) {
      columnRejected = message(error)
    }
    add(
      '欄位格式錯誤給繁中訊息',
      columnRejected.includes('座號欄位格式錯誤'),
      columnRejected || '（未拒絕）'
    )

    await saveGradebookConfig(created.id, assignment.id, {
      path: join(work, 'no-such.xlsx'),
      sheet: SHEET,
      header_row: 1,
      seat_column: 'B',
      score_column: 'D',
      seat_format: '{seat}'
    })
    const missingFile = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      now: new Date(2026, 10, 20, 10, 0, 6)
    })
    add(
      '檔案不存在給繁中錯誤並保留 CSV',
      !missingFile.ok &&
        (missingFile.error ?? '').includes('找不到成績表') &&
        Boolean(missingFile.csvPath),
      missingFile.error ?? '（無錯誤）'
    )

    await saveGradebookConfig(created.id, assignment.id, {
      path: sourcePath,
      sheet: '不存在的工作表',
      header_row: 1,
      seat_column: 'B',
      score_column: 'D',
      seat_format: '{seat}'
    })
    const missingSheet = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      now: new Date(2026, 10, 20, 10, 0, 7)
    })
    add(
      '工作表不存在給繁中錯誤',
      !missingSheet.ok && (missingSheet.error ?? '').includes('找不到工作表'),
      missingSheet.error ?? '（無錯誤）'
    )

    const blankPath = join(work, 'blank-seat.xlsx')
    const blankWorkbook = new ExcelJS.Workbook()
    const blankSheet = blankWorkbook.addWorksheet(SHEET)
    blankSheet.addRow(['編號', '座號', '姓名', '作文一', '等第'])
    blankSheet.addRow([1, '', '王小明', 0, ''])
    blankSheet.addRow([2, '', '陳大華', 0, ''])
    await blankWorkbook.xlsx.writeFile(blankPath)
    await saveGradebookConfig(created.id, assignment.id, {
      path: blankPath,
      sheet: SHEET,
      header_row: 1,
      seat_column: 'B',
      name_column: 'C',
      score_column: 'D',
      grade_column: 'E',
      seat_format: '{seat}'
    })
    const blankSeat = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      now: new Date(2026, 10, 20, 10, 0, 8)
    })
    add(
      '座號欄空白給繁中錯誤',
      !blankSeat.ok && (blankSeat.error ?? '').includes('沒有可辨識的座號'),
      blankSeat.error ?? '（無錯誤）'
    )

    // ---- 匯出模式：巨集與圖表 ------------------------------------------
    await saveGradebookConfig(created.id, assignment.id, {
      path: sourcePath,
      sheet: SHEET,
      header_row: 1,
      seat_column: 'B',
      name_column: 'C',
      score_column: 'D',
      grade_column: 'E',
      seat_format: '{seat}'
    })

    const macroBefore = await readFile(macroPath)
    const macro = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      sourcePath: macroPath,
      now: new Date(2026, 10, 20, 10, 0, 3)
    })
    const macroAfter = await readFile(macroPath)
    const macroLayout = macro.outputPath
      ? await readSheet(macro.outputPath, '成績')
      : { rowCount: 0, rows: [] }
    add(
      '.xlsm 走匯出模式、原檔不變',
      macro.ok &&
        macro.mode === 'export' &&
        macro.verified &&
        Boolean(macro.outputPath?.endsWith('.xlsx')) &&
        macro.written === 4 &&
        macroBefore.equals(macroAfter) &&
        macroLayout.rowCount === 5 &&
        macroLayout.rows[0].slice(0, 4).join(',') === '座號,姓名,分數,等第' &&
        macroLayout.rows.some((values) => values[0] === '07' && values[2] === '81'),
      `${macro.mode}、${basename(macro.outputPath ?? '（無）')}`
    )

    const chartBefore = await readFile(chartPath)
    const chart = await writeGradebook({
      classId: created.id,
      assignmentId: assignment.id,
      sourcePath: chartPath,
      now: new Date(2026, 10, 20, 10, 0, 4)
    })
    const chartAfter = await readFile(chartPath)
    add(
      '含 chart 字樣走匯出模式並警告',
      chart.mode === 'export' &&
        chart.ok &&
        chart.verified &&
        chart.warnings.some((warning) => warning.includes('xl/charts/')) &&
        chartBefore.equals(chartAfter) &&
        Boolean(chart.outputPath && (await stat(chart.outputPath).then(() => true).catch(() => false))),
      chart.warnings[0] ?? '無警告'
    )

    // ---- 沒有可寫作品 --------------------------------------------------
    const emptyAssignment = (await createAssignment({
      classId: created.id,
      title: '空白作業',
      prompt: '',
      rubricPreset: 'balanced'
    })) as { id: string }
    await saveGradebookConfig(created.id, emptyAssignment.id, {
      path: sourcePath,
      sheet: SHEET,
      header_row: 1,
      seat_column: 'B',
      name_column: 'C',
      score_column: 'D',
      grade_column: 'E',
      seat_format: '{seat}'
    })
    const empty = await writeGradebook({
      classId: created.id,
      assignmentId: emptyAssignment.id,
      now: new Date(2026, 10, 20, 10, 0, 5)
    })
    add(
      '沒有可寫作品時給繁中錯誤並保留 CSV',
      !empty.ok &&
        (empty.error ?? '').includes('沒有可寫回的作品') &&
        Boolean(empty.csvPath),
      empty.error ?? '（無錯誤）'
    )

    // ---- CSV -----------------------------------------------------------
    const csv = await writeGradebookCsv(created.id, assignment.id, new Date(2026, 10, 20, 10, 1, 0))
    const csvText = (await readFile(csv.path, 'utf8')).replace(/^\uFEFF/, '')
    const csvLines = csvText.trim().split(/\r?\n/)
    add(
      'CSV 匯出內容正確',
      csv.rows === 5 &&
        csvLines[0] === '座號,姓名,分數,等第,狀態' &&
        csvLines.includes('07,王小明,81,A-,已批') &&
        csvLines.includes('20,李大同,55,C,批閱中') &&
        csv.path.includes('_gradebook'),
      `${csv.rows} 列、${basename(csv.path)}`
    )

    // ---- 失敗仍保留 CSV ------------------------------------------------
    add(
      '失敗流程都有 CSV 路徑',
      Boolean(duplicate.csvPath) && Boolean(empty.csvPath),
      '重複座號與無作品皆已匯出'
    )

    // ---- 寫回後作品未變 ------------------------------------------------
    const workAfter = await loadWork(created.id, assignment.id, '07')
    add(
      '寫回不改 work.json 分數',
      workAfter.scores?.total === 81 && workAfter.status === 'done',
      `總分 ${workAfter.scores?.total}`
    )

    // ---- UI ------------------------------------------------------------
    const ui = await runUiSmoke()
    add('成績寫回按鈕、面板與 preload API（隱藏視窗）', ui.ok, ui.detail)

    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已經關閉或從未開啟
    }
  }

  await flushLogs()

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[e6] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((check) => check.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
