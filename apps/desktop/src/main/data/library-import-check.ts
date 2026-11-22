import { app, BrowserWindow, dialog } from 'electron'
import sharp from 'sharp'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  JUNIOR_LIBRARY,
  SENIOR_LIBRARY,
  applyLibraryDisabled,
  libraryForGrade,
  mergeLibraryLayers,
  type LibraryEntry,
  type LibraryFile,
  type WorkFile
} from '@essay-grader/core'
import { importLibraryFile } from './library-import'
import {
  readLibraryAdditions,
  writeCustomEntries,
  writeLibraryAdditions
} from './library-custom'
import {
  closeDatabase,
  createAssignment,
  createClass,
  openDatabase,
  saveClass,
  saveWork
} from './repository'
import { readLibraryDisabled, writeLibraryDisabled } from './settings'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const now = (): string => new Date().toISOString()
const HAS_CHINESE = /[\u4e00-\u9fff]/

const CLASS_NAME = '高中 D21'
const SEAT = '01'
const STUDENT = '測試學生'

/** 建立測試用評語條目；預設為內建來源、未停用。 */
function entry(id: string, text: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id,
    category: 'typo',
    subtype: 'general',
    text,
    tags: ['D21'],
    disabled: false,
    source: 'builtin',
    ...extra
  }
}

function libraryFile(version: string, entries: LibraryEntry[]): LibraryFile {
  return { schema_version: 1, library_version: version, locale: 'zh-TW', entries }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

interface ErrorProbe {
  rejected: boolean
  chinese: boolean
  text: string
}

async function probeError(fn: () => Promise<unknown>): Promise<ErrorProbe> {
  try {
    await fn()
    return { rejected: false, chinese: false, text: '未被拒絕' }
  } catch (error) {
    const text = message(error)
    return { rejected: true, chinese: HAS_CHINESE.test(text), text }
  }
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

interface UiResult {
  ok: boolean
  detail: string
  buttonOk: boolean
  buttonDetail: string
  reloadOk: boolean
  reloadDetail: string
}

/** 隱藏視窗：管理模式的「匯入新版」、preload API 與匯入後重新載入。 */
async function runUiSmoke(
  classId: string,
  fixturePath: string,
  expectedVersion: string
): Promise<UiResult> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 系統檔案選擇器無法自動化，這裡只替換回傳值，其餘 IPC 流程照常。
  const stub = async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: false,
    filePaths: [fixturePath]
  })
  let dialogPatched = false
  try {
    const original = dialog.showOpenDialog
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      writable: true,
      value: stub
    })
    dialogPatched = (dialog.showOpenDialog as unknown) === stub
    if (!dialogPatched) {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        writable: true,
        value: original
      })
    }
  } catch {
    dialogPatched = false
  }

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const ready = await waitFor(
      win,
      "document.body.innerText.includes('作文批閱') && document.querySelector('.assignment-row') !== null",
      15000
    )
    if (!ready) {
      return {
        ok: false,
        detail: '主畫面或作業列未渲染',
        buttonOk: false,
        buttonDetail: '未進入批閱畫面',
        reloadOk: false,
        reloadDetail: '未進入批閱畫面'
      }
    }

    await win.webContents.executeJavaScript("document.querySelector('.assignment-row')?.click()")
    const reviewReady = await waitFor(
      win,
      `[...document.querySelectorAll('.import-panel button')].some(
        (item) => item.textContent?.trim() === '批閱'
      )`,
      12000
    )
    if (reviewReady) {
      await win.webContents.executeJavaScript(
        `(() => {
          const button = [...document.querySelectorAll('.import-panel button')]
            .find((item) => item.textContent?.trim() === '批閱')
          button?.click()
          return Boolean(button)
        })()`
      )
    }
    const mounted =
      reviewReady &&
      (await waitFor(
        win,
        "document.querySelector('.rv') && document.querySelector('.rv-lib-sort')",
        12000
      ))
    if (!mounted) {
      return {
        ok: false,
        detail: '批閱畫面或評語庫面板未載入',
        buttonOk: false,
        buttonDetail: '未進入批閱畫面',
        reloadOk: false,
        reloadDetail: '未進入批閱畫面'
      }
    }

    const preloadOk = (await win.webContents.executeJavaScript(
      `typeof window.electronAPI?.library?.importFile === 'function'`
    )) as boolean
    const manageClicked = (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll('.rv-card-head-actions button')]
          .find((item) => item.textContent?.trim() === '管理')
        button?.click()
        return Boolean(button)
      })()`
    )) as boolean
    const importButtonReady =
      manageClicked &&
      (await waitFor(
        win,
        `[...document.querySelectorAll('.rv-card-head-actions button')].some(
          (item) => item.textContent?.trim() === '匯入新版'
        )`,
        6000
      ))
    const beforeVersion = (await win.webContents.executeJavaScript(
      `document.querySelector('.rv-lib-current')?.innerText ?? ''`
    )) as string
    const beforeList = (await win.webContents.executeJavaScript(
      `document.querySelectorAll('.rv-lib-item').length`
    )) as number
    const buttonOk =
      preloadOk &&
      importButtonReady &&
      beforeVersion.includes(expectedVersion) &&
      beforeList > 0
    const buttonDetail = `preload importFile ${preloadOk ? '有' : '缺'}；管理模式「匯入新版」${
      importButtonReady ? '有' : '缺'
    }；匯入前版本「${beforeVersion.trim() || '—'}」、清單 ${beforeList} 條`

    // 輸入搜尋字串後再匯入，確認重新載入不會清掉管理模式與搜尋條件。
    await win.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector('.rv-lib-search')
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set
        setter?.call(input, '介面匯入')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`
    )
    const filteredBefore = (await win.webContents.executeJavaScript(
      `document.querySelectorAll('.rv-lib-item').length`
    )) as number

    let clicked = false
    if (dialogPatched) {
      clicked = (await win.webContents.executeJavaScript(
        `(() => {
          const button = [...document.querySelectorAll('.rv-card-head-actions button')]
            .find((item) => item.textContent?.trim() === '匯入新版')
          button?.click()
          return Boolean(button)
        })()`
      )) as boolean
    }

    const reloaded =
      clicked &&
      (await waitFor(
        win,
        `document.querySelector('.rv-import-result')?.innerText?.includes('新增 1 條') === true &&
         document.querySelectorAll('.rv-lib-item').length === 1`,
        15000
      ))
    const after = (await win.webContents.executeJavaScript(
      `(async () => {
        const classId = ${JSON.stringify(classId)}
        const payload = await window.electronAPI.library.get(classId)
        const entry = payload.library.entries.find((item) => item.id === 'D21-UI-1')
        return {
          version: document.querySelector('.rv-lib-current')?.innerText ?? '',
          result: document.querySelector('.rv-import-result')?.innerText ?? '',
          query: document.querySelector('.rv-lib-search')?.value ?? '',
          manage: [...document.querySelectorAll('.rv-card-head-actions button')]
            .some((item) => item.textContent?.trim() === '完成管理'),
          items: document.querySelectorAll('.rv-lib-item').length,
          count: payload.library.entries.length,
          payloadVersion: payload.library.library_version,
          entrySource: entry?.source ?? '',
          entryDisabled: entry?.disabled,
          entryText: entry?.text ?? ''
        }
      })()`
    )) as {
      version: string
      result: string
      query: string
      manage: boolean
      items: number
      count: number
      payloadVersion: string
      entrySource: string
      entryDisabled?: boolean
      entryText: string
    }
    const reloadOk =
      dialogPatched &&
      reloaded &&
      filteredBefore === 0 &&
      after.query === '介面匯入' &&
      after.manage &&
      after.items === 1 &&
      after.version.includes('2099.3-ui') &&
      after.payloadVersion === '2099.3-ui' &&
      after.count === 143 &&
      after.entrySource === 'builtin' &&
      after.entryDisabled === false
    const reloadDetail = dialogPatched
      ? reloadOk
        ? `搜尋「介面匯入」由 ${filteredBefore} → ${after.items} 條；版本「${after.version.trim()}」；管理模式與搜尋保留；library:get ${after.count} 條`
        : `重新載入不符（搜尋前 ${filteredBefore}、重載 ${reloaded ? '完成' : '逾時'}、查詢「${
            after.query
          }」、管理 ${after.manage ? '保留' : '遺失'}、清單 ${after.items}、版本「${
            after.version.trim()
          }」、API ${after.count}／${after.payloadVersion}、來源 ${after.entrySource || '—'}）`
      : `無法替換系統檔案選擇器，未實際點擊匯入（搜尋前 ${filteredBefore} 條）`

    return {
      ok: buttonOk && reloadOk,
      detail: `${buttonDetail}；${reloadDetail}`,
      buttonOk,
      buttonDetail,
      reloadOk,
      reloadDetail
    }
  } finally {
    win.destroy()
  }
}

/** `--library-import-check`：D21 評語庫版本更新的核心、儲存、IPC 與 UI 驗收。 */
export async function runLibraryImportCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'library-import-check')
  const root = join(work, 'db')
  const assets = join(work, 'assets')

  await rm(work, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  await mkdir(assets, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  const base = SENIOR_LIBRARY
  const juniorBase = JUNIOR_LIBRARY
  const customEntry = entry('CUSTOM-D21-1', 'D21 自訂評語，匯入新版後必須原樣保留。', {
    source: 'custom'
  })
  const existingBuiltin = base.entries[0]
  const duplicateTextSource = base.entries[1]
  const disabledBuiltinId = base.entries[2]?.id ?? existingBuiltin.id
  const disabledBefore = await readLibraryDisabled('senior')
  let databaseOpened = false

  try {
    // ---- 無資料庫與非法版本 ------------------------------------------------
    const noDbFile = join(assets, 'no-db.json')
    await writeJson(noDbFile, libraryFile('2099.0-nodb', [entry('D21-NODB-1', '無資料庫測試文字。')]))
    const noDb = await probeError(() => importLibraryFile('senior', noDbFile))
    const badId = await probeError(() =>
      importLibraryFile('kindergarten' as never, noDbFile)
    )
    add(
      '錯誤：無資料庫與非法 libraryId 被拒且訊息繁中',
      noDb.rejected &&
        noDb.chinese &&
        noDb.text.includes('尚未開啟資料庫') &&
        badId.rejected &&
        badId.chinese &&
        badId.text.includes('評語庫版本不合法'),
      `無資料庫「${noDb.text}」；非法版本「${badId.text}」`
    )

    await openDatabase(root, { remember: false })
    databaseOpened = true
    add('開啟暫存資料庫', true, root)

    // ---- 資料庫、班級、作業與作品 -----------------------------------------
    const created = await createClass({
      classNo: '901',
      name: CLASS_NAME,
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: '測試老師'
    })
    await saveClass({
      schema_version: 1,
      id: created.id,
      name: CLASS_NAME,
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: '測試老師',
      students: [{ seat: SEAT, name: STUDENT, active: true }]
    })
    const assignment = await createAssignment({
      classId: created.id,
      title: 'D21 匯入測試',
      prompt: '',
      rubricPreset: 'balanced'
    })
    const seatDir = join(root, created.id, assignment.id, `S${SEAT}`)
    await mkdir(seatDir, { recursive: true })
    await sharp({
      create: {
        width: 800,
        height: 1100,
        channels: 3,
        background: { r: 250, g: 248, b: 242 }
      }
    })
      .jpeg()
      .toFile(join(seatDir, 'p1.jpg'))
    const workFile: WorkFile = {
      schema_version: 1,
      class_id: created.id,
      assignment_id: assignment.id,
      seat: SEAT,
      name: STUDENT,
      status: 'grading',
      pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
      annotations: [],
      updated_at: now()
    }
    await saveWork(created.id, assignment.id, SEAT, workFile)

    await writeCustomEntries('senior', [customEntry])
    await writeLibraryDisabled('senior', [disabledBuiltinId, customEntry.id])
    const customBefore = await readLibraryAdditions('senior')
    const disabledSaved = await readLibraryDisabled('senior')
    add(
      '建立自訂評語與 D23 停用清單',
      customBefore.custom.length === 1 &&
        customBefore.custom[0]?.id === customEntry.id &&
        customBefore.custom[0]?.source === 'custom' &&
        customBefore.imported.length === 0 &&
        disabledSaved.includes(disabledBuiltinId) &&
        disabledSaved.includes(customEntry.id),
      `自訂 ${customBefore.custom.length} 條、imported ${customBefore.imported.length} 條；停用 ${disabledSaved.join(
        '、'
      )}`
    )

    // ---- 匯入新版 ----------------------------------------------------------
    const importFile = join(assets, 'senior-new.json')
    const importVersion = '2099.1-test'
    await writeJson(
      importFile,
      libraryFile(importVersion, [
        entry('D21-NEW-1', 'D21 全新評語一，既有庫中沒有這句。'),
        entry(existingBuiltin.id, '這條文字若寫入就代表覆蓋了內建，必須略過。'),
        entry('D21-NEW-DUP-TEXT', `${duplicateTextSource.text}，  `),
        entry('D21-NEW-CUSTOM-SRC', 'D21 新評語二，來源標為 custom 也應改回 builtin。', {
          source: 'custom',
          disabled: true,
          tags: ['匯入', '來源']
        }),
        entry('D21-NEW-2', 'D21 全新評語三，用來確認可一次新增多條。')
      ])
    )
    const report = await importLibraryFile('senior', importFile)
    add(
      '匯入結果：新增 3、既有 id 1、重複文字 1、版本與總數正確',
      report.imported === 3 &&
        report.skippedExistingId === 1 &&
        report.skippedDuplicateText === 1 &&
        report.version === importVersion &&
        report.total === 142,
      `新增 ${report.imported}、略過既有 ${report.skippedExistingId}、略過重複文字 ${report.skippedDuplicateText}、版本 ${report.version}、總數 ${report.total}`
    )

    const afterImport = await readLibraryAdditions('senior')
    const rawAfterImport = JSON.parse(
      await readFile(join(root, '_library', 'senior.json'), 'utf8')
    ) as {
      entries?: LibraryEntry[]
      imported?: LibraryEntry[]
      imported_version?: string
    }
    const storedImportedOk = afterImport.imported.every(
      (item) => item.source === 'builtin' && item.disabled === false
    )
    add(
      '匯入檔案：只寫 imported、來源改 builtin、停用一律 false、自訂保留',
      afterImport.imported.length === 3 &&
        afterImport.importedVersion === importVersion &&
        afterImport.custom.length === 1 &&
        afterImport.custom[0]?.id === customEntry.id &&
        afterImport.custom[0]?.text === customEntry.text &&
        storedImportedOk &&
        rawAfterImport.entries?.length === 1 &&
        rawAfterImport.imported?.length === 3 &&
        rawAfterImport.imported_version === importVersion,
      `imported ${afterImport.imported.length} 條（來源／停用${
        storedImportedOk ? '正確' : '錯誤'
      }）、自訂 ${afterImport.custom.length} 條、檔案版本 ${rawAfterImport.imported_version ?? '—'}`
    )

    const merged = mergeLibraryLayers(
      base.entries,
      afterImport.imported,
      afterImport.custom
    )
    const builtinStillSame =
      merged.entries.find((item) => item.id === existingBuiltin.id)?.text ===
      existingBuiltin.text
    const orderOk =
      merged.entries[0]?.id === base.entries[0]?.id &&
      merged.entries[base.entries.length - 1]?.id === base.entries[base.entries.length - 1]?.id &&
      merged.entries[base.entries.length]?.id === 'D21-NEW-1' &&
      merged.entries[base.entries.length + 1]?.id === 'D21-NEW-CUSTOM-SRC' &&
      merged.entries[base.entries.length + 2]?.id === 'D21-NEW-2' &&
      merged.entries[merged.entries.length - 1]?.id === customEntry.id
    const effectiveVersion =
      afterImport.imported.length > 0 && afterImport.importedVersion
        ? afterImport.importedVersion
        : base.library_version
    const newEntriesVisible = ['D21-NEW-1', 'D21-NEW-CUSTOM-SRC', 'D21-NEW-2'].every((id) =>
      merged.entries.some((item) => item.id === id)
    )
    add(
      '合併順序 base→imported→custom、版本更新、新條目可見、舊內建文字不變',
      merged.entries.length === 142 &&
        merged.duplicateIds.length === 0 &&
        orderOk &&
        builtinStillSame &&
        newEntriesVisible &&
        effectiveVersion === importVersion,
      `${merged.entries.length} 條（base ${base.entries.length}、imported ${afterImport.imported.length}、custom ${afterImport.custom.length}）、版本 ${effectiveVersion}；內建 ${
        existingBuiltin.id
      } 文字${builtinStillSame ? '不變' : '被改寫'}`
    )

    const disabledAfterImport = await readLibraryDisabled('senior')
    add(
      '匯入不影響自訂評語與 D23 停用清單',
      JSON.stringify(customBefore.custom) === JSON.stringify(afterImport.custom) &&
        JSON.stringify(disabledSaved) === JSON.stringify(disabledAfterImport) &&
        disabledAfterImport.includes(disabledBuiltinId) &&
        disabledAfterImport.includes(customEntry.id),
      `自訂 ${afterImport.custom.length} 條原樣；停用 ${disabledAfterImport.join('、')}`
    )

    const payload = libraryForGrade('senior')
    await writeLibraryDisabled('senior', [
      ...new Set([...disabledAfterImport, 'D21-NEW-1'])
    ])
    const disabledForPayload = await readLibraryDisabled('senior')
    const disabledPayload = applyLibraryDisabled(
      {
        ...payload,
        library: {
          ...payload.library,
          library_version: effectiveVersion,
          entries: merged.entries
        }
      },
      disabledForPayload
    )
    const importEntryDisabled = disabledPayload.library.entries.find(
      (item) => item.id === 'D21-NEW-1'
    )
    const customEntryDisabled = disabledPayload.library.entries.find(
      (item) => item.id === customEntry.id
    )
    const untouchedImported = disabledPayload.library.entries.find(
      (item) => item.id === 'D21-NEW-2'
    )
    add(
      '停用 imported 與自訂 id 生效，其他新增條目未受影響',
      importEntryDisabled?.disabled === true &&
        customEntryDisabled?.disabled === true &&
        untouchedImported?.disabled === false &&
        disabledPayload.library.library_version === importVersion,
      `D21-NEW-1 disabled ${importEntryDisabled?.disabled}、自訂 disabled ${customEntryDisabled?.disabled}、D21-NEW-2 disabled ${untouchedImported?.disabled}；停用清單 ${disabledForPayload.join(
        '、'
      )}`
    )

    // ---- 重複匯入與只影響目前版本 -----------------------------------------
    const filePath = join(root, '_library', 'senior.json')
    const rawBeforeRepeat = await readFile(filePath, 'utf8')
    const repeat = await importLibraryFile('senior', importFile)
    const rawAfterRepeat = await readFile(filePath, 'utf8')
    const repeatAdditions = await readLibraryAdditions('senior')
    add(
      '再次匯入同一檔：不新增、不寫檔、版本與條目不變',
      repeat.imported === 0 &&
        repeat.skippedExistingId === 4 &&
        repeat.skippedDuplicateText === 1 &&
        repeat.version === importVersion &&
        repeat.total === 142 &&
        rawBeforeRepeat === rawAfterRepeat &&
        repeatAdditions.imported.length === 3,
      `新增 ${repeat.imported}、略過既有 ${repeat.skippedExistingId}、略過重複文字 ${repeat.skippedDuplicateText}、版本 ${repeat.version}、總數 ${repeat.total}；檔案位元組${
        rawBeforeRepeat === rawAfterRepeat ? '不變' : '被改寫'
      }`
    )

    const noNewFile = join(assets, 'senior-no-new.json')
    await writeJson(
      noNewFile,
      libraryFile('2099.2-no-new', [
        entry(existingBuiltin.id, '再次使用既有 id，應略過。'),
        entry('D21-NO-NEW-DUP', `${duplicateTextSource.text}！`)
      ])
    )
    const rawBeforeNoNew = await readFile(filePath, 'utf8')
    const noNew = await importLibraryFile('senior', noNewFile)
    const rawAfterNoNew = await readFile(filePath, 'utf8')
    add(
      '無新增時版本不變、不寫檔',
      noNew.imported === 0 &&
        noNew.skippedExistingId === 1 &&
        noNew.skippedDuplicateText === 1 &&
        noNew.version === importVersion &&
        noNew.total === 142 &&
        rawBeforeNoNew === rawAfterNoNew,
      `新增 ${noNew.imported}、版本維持 ${noNew.version}（檔案宣告 2099.2-no-new）、位元組${
        rawBeforeNoNew === rawAfterNoNew ? '不變' : '被改寫'
      }`
    )

    const juniorFile = join(assets, 'junior-new.json')
    const juniorVersion = '2099.1-junior'
    await writeJson(
      juniorFile,
      libraryFile(juniorVersion, [entry('JD21-NEW-1', 'D21 國中版全新評語，只影響國中版。')])
    )
    const juniorReport = await importLibraryFile('junior', juniorFile)
    const juniorAdditions = await readLibraryAdditions('junior')
    const seniorAfterJunior = await readLibraryAdditions('senior')
    add(
      '只影響目前版本：國中版匯入不動高中職版',
      juniorReport.imported === 1 &&
        juniorReport.total === juniorBase.entries.length + 1 &&
        juniorAdditions.imported.length === 1 &&
        juniorAdditions.importedVersion === juniorVersion &&
        seniorAfterJunior.imported.length === 3 &&
        seniorAfterJunior.importedVersion === importVersion,
      `國中版新增 ${juniorReport.imported}、總數 ${juniorReport.total}、版本 ${juniorReport.version}；高中職仍 ${seniorAfterJunior.imported.length} 條／${seniorAfterJunior.importedVersion}`
    )

    // ---- UI／preload --------------------------------------------------------
    const uiFile = join(assets, 'senior-ui.json')
    await writeJson(
      uiFile,
      libraryFile('2099.3-ui', [
        entry('D21-UI-1', 'D21 介面匯入測試，這句只從畫面匯入。', {
          category: 'typo'
        })
      ])
    )
    const ui = await runUiSmoke(created.id, uiFile, importVersion)
    add('UI：管理模式有「匯入新版」、preload library.importFile', ui.buttonOk, ui.buttonDetail)
    add(
      'UI：匯入後重新載入、版本更新、新條目出現、管理與搜尋保留',
      ui.reloadOk,
      ui.reloadDetail
    )

    // ---- 舊檔相容與 .bak 還原 ---------------------------------------------
    const additionsBeforeLegacy = await readLibraryAdditions('senior')
    const legacyPath = join(root, '_library', 'senior.json')
    await writeJson(legacyPath, {
      schema_version: 1,
      library_id: 'senior',
      entries: [customEntry],
      updated_at: now()
    })
    let legacyOk = false
    let legacyDetail = ''
    try {
      const legacy = await readLibraryAdditions('senior')
      const legacyVersion =
        legacy.imported.length > 0 && legacy.importedVersion
          ? legacy.importedVersion
          : base.library_version
      legacyOk =
        legacy.custom.length === 1 &&
        legacy.custom[0]?.id === customEntry.id &&
        legacy.imported.length === 0 &&
        legacy.importedVersion === undefined &&
        legacyVersion === base.library_version
      legacyDetail = legacyOk
        ? `缺 imported／imported_version 仍可讀：自訂 1 條、imported 0、版本回到 ${legacyVersion}`
        : `舊檔讀取不符（自訂 ${legacy.custom.length}、imported ${legacy.imported.length}、版本 ${legacyVersion}）`
    } catch (error) {
      legacyDetail = `舊檔讀取失敗：${message(error)}`
    }
    add('舊 _library 檔沒有 imported／imported_version 仍可讀', legacyOk, legacyDetail)

    let backupOk = false
    let backupDetail = ''
    try {
      await writeLibraryAdditions('senior', {
        custom: additionsBeforeLegacy.custom,
        imported: additionsBeforeLegacy.imported,
        importedVersion: additionsBeforeLegacy.importedVersion
      })
      await writeLibraryAdditions('senior', {
        custom: additionsBeforeLegacy.custom,
        imported: additionsBeforeLegacy.imported,
        importedVersion: additionsBeforeLegacy.importedVersion
      })
      const backupStat = await stat(`${legacyPath}.bak`)
      await writeFile(legacyPath, '{ 損壞的 JSON', 'utf8')
      const recovered = await readLibraryAdditions('senior')
      const restoredRaw = await readFile(legacyPath, 'utf8')
      backupOk =
        backupStat.isFile() &&
        recovered.custom.length === 1 &&
        recovered.imported.length === 4 &&
        recovered.importedVersion === '2099.3-ui' &&
        restoredRaw.includes('"imported"')
      backupDetail = backupOk
        ? `主檔損壞後由 .bak 還原：自訂 1 條、imported 4 條、版本 2099.3-ui`
        : `還原不符（自訂 ${recovered.custom.length}、imported ${recovered.imported.length}、版本 ${
            recovered.importedVersion ?? '—'
          }）`
    } catch (error) {
      backupDetail = `備份還原測試失敗：${message(error)}`
    }
    add('損壞的 _library 主檔可從 .bak 還原且 imported 保留', backupOk, backupDetail)

    // ---- 錯誤處理 ----------------------------------------------------------
    const missing = await probeError(() =>
      importLibraryFile('senior', join(assets, 'not-exist.json'))
    )
    const brokenPath = join(assets, 'broken.json')
    await writeFile(brokenPath, '{ 壞掉的 JSON', 'utf8')
    const broken = await probeError(() => importLibraryFile('senior', brokenPath))
    const wrongSchemaPath = join(assets, 'wrong-schema.json')
    await writeJson(wrongSchemaPath, { schema_version: 1, library_version: 'x' })
    const wrongSchema = await probeError(() => importLibraryFile('senior', wrongSchemaPath))
    add(
      '錯誤：檔案不存在、JSON 損壞、schema 不合被拒且訊息繁中',
      missing.rejected &&
        missing.chinese &&
        missing.text.includes('評語庫檔案格式不正確') &&
        broken.rejected &&
        broken.chinese &&
        broken.text.includes('評語庫檔案格式不正確') &&
        wrongSchema.rejected &&
        wrongSchema.chinese &&
        wrongSchema.text.includes('評語庫檔案格式不正確'),
      `不存在「${missing.text.slice(0, 40)}…」；壞 JSON「${broken.text.slice(
        0,
        40
      )}…」；schema「${wrongSchema.text.slice(0, 40)}…」`
    )

    const emptyPath = join(assets, 'empty.json')
    await writeJson(emptyPath, libraryFile('2099.9-empty', []))
    const empty = await probeError(() => importLibraryFile('senior', emptyPath))
    const duplicateIdPath = join(assets, 'duplicate-id.json')
    await writeJson(
      duplicateIdPath,
      libraryFile('2099.9-dup', [
        entry('D21-DUP-1', '重複 id 測試一。'),
        entry('D21-DUP-1', '重複 id 測試二。')
      ])
    )
    const duplicateId = await probeError(() => importLibraryFile('senior', duplicateIdPath))
    const blankIdPath = join(assets, 'blank-id.json')
    await writeJson(
      blankIdPath,
      libraryFile('2099.9-blank', [
        entry('D21-BLANK-1', '空白 id 測試。'),
        entry('   ', '這條 id 只有空白。')
      ])
    )
    const blankId = await probeError(() => importLibraryFile('senior', blankIdPath))
    add(
      '錯誤：entries 空、檔案內 id 重複、空白 id 被拒且訊息繁中',
      empty.rejected &&
        empty.chinese &&
        empty.text.includes('沒有評語條目') &&
        duplicateId.rejected &&
        duplicateId.chinese &&
        duplicateId.text.includes('id 重複') &&
        blankId.rejected &&
        blankId.chinese &&
        blankId.text.includes('空白 id'),
      `空檔「${empty.text}」；重複「${duplicateId.text}」；空白「${blankId.text}」`
    )

    const rawAfterErrors = await readFile(legacyPath, 'utf8')
    add(
      '錯誤匯入不寫入 _library',
      rawAfterErrors.includes('"imported"') && rawAfterErrors.includes('D21-UI-1'),
      '主檔仍為匯入後狀態'
    )
  } catch (error) {
    add('執行流程', false, message(error))
  } finally {
    try {
      await writeLibraryDisabled('senior', disabledBefore)
    } catch {
      // 資料庫可能尚未開啟或已關閉
    }
    if (databaseOpened) {
      try {
        await closeDatabase()
        add('關閉資料庫', true, 'watcher 已停止')
      } catch (error) {
        add('關閉資料庫', false, message(error))
      }
    }
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[library-import] ${ok ? '全部通過' : '有項目失敗'}（${
      checks.filter((check) => check.ok).length
    }/${checks.length}）`
  )
  return ok ? 0 : 1
}
