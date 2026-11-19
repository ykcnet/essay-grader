import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSeatFromFileName, type ImportEvent } from '@essay-grader/core'
import {
  closeDatabase,
  createAssignment,
  createClass,
  listWorks,
  loadClass,
  openDatabase,
  saveClass
} from '../data/repository'
import { clearExternalInboxRoot, readSettings, writeSettings } from '../data/settings'
import {
  ensureExternalAssignmentFolder,
  getExternalStatus,
  startExternalWatcher,
  stopExternalWatcher
} from './external'
import { getImportStatus, onImportEvent } from './watcher'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await delay(200)
  }
  return false
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function waitForWindow(
  win: BrowserWindow,
  expression: string,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now()
  return (async () => {
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = (await win.webContents.executeJavaScript(
          `Boolean(${expression})`
        )) as boolean
        if (ok) return true
      } catch {
        // 頁面還在下載
      }
      await delay(120)
    }
    return false
  })()
}

async function runUiSmoke(
  driveRoot: string,
  assignmentId: string
): Promise<{ ok: boolean; detail: string }> {
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

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const ready = await waitForWindow(
      win,
      "document.body.innerText.includes('作文批閱') && document.querySelectorAll('.assignment-row').length > 0",
      10000
    )
    if (!ready) return { ok: false, detail: '主畫面或作業列表未渲染' }

    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const row = [...document.querySelectorAll('.assignment-row')].find(
          (item) => item.textContent?.includes(${JSON.stringify(assignmentId)})
        ) ?? document.querySelector('.assignment-row')
        if (!row) return false
        row.click()
        return true
      })()`
    )) as boolean
    if (!clicked) return { ok: false, detail: '找不到作業列可點擊' }

    const blockReady = await waitForWindow(
      win,
      `document.body.innerText.includes('Google Drive inbox') &&
       document.body.innerText.includes(${JSON.stringify(driveRoot)}) &&
       document.body.innerText.includes('監看中')`,
      10000
    )

    const buttonsReady = (await win.webContents.executeJavaScript(
      `['設定／變更','清除','建立此作業資料夾','開啟資料夾'].every((text) =>
        [...document.querySelectorAll('.drive-inbox button')].some(
          (item) => item.textContent?.trim() === text
        )
      )`
    )) as boolean

    const apiReady = (await win.webContents.executeJavaScript(
      `Boolean(
        window.electronAPI &&
        typeof window.electronAPI.imports?.chooseDriveRoot === 'function' &&
        typeof window.electronAPI.imports?.clearDriveRoot === 'function' &&
        typeof window.electronAPI.imports?.openDriveRoot === 'function' &&
        typeof window.electronAPI.imports?.ensureDriveFolder === 'function'
      )`
    )) as boolean

    return {
      ok: blockReady && buttonsReady && apiReady,
      detail: `Drive 區塊 ${blockReady ? '是' : '否'}、四個按鈕 ${buttonsReady ? '是' : '否'}、preload API ${apiReady ? '是' : '否'}`
    }
  } finally {
    win.destroy()
  }
}

function sidecar(
  classId: string,
  assignmentId: string,
  seat: string
): string {
  return JSON.stringify(
    {
      schema_version: 1,
      class_id: classId,
      assignment_id: assignmentId,
      seat,
      seq: 1,
      session_id: 'DRIVECHECK',
      captured_at: new Date().toISOString()
    },
    null,
    2
  )
}

async function reasonFor(dir: string, suffix: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[])
  const target = files.find(
    (file) => file.endsWith(suffix) && !file.endsWith('.reason.txt')
  )
  if (!target) return null
  return readFile(join(dir, `${target}.reason.txt`), 'utf8').catch(() => null)
}

/** `--drive-check`：真的把檔案放進外部資料夾，驗證 Drive inbox 全流程。 */
export async function runDriveCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'drive-check')
  const dbRoot = join(work, 'db')
  const driveRoot = join(work, 'Google 雲端硬碟', 'EssayGrader', 'inbox')
  const userData = join(work, 'userData')
  const source = join(repoRoot, 'spike-assets', 'page-2600.jpg')

  await rm(work, { recursive: true, force: true })
  await mkdir(dbRoot, { recursive: true })
  await mkdir(driveRoot, { recursive: true })
  await mkdir(userData, { recursive: true })
  app.setPath('userData', userData)

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  const received: ImportEvent[] = []
  const off = onImportEvent((event) => received.push(event))
  const driveEvents = (): ImportEvent[] =>
    received.filter((event) => event.source === 'drive')

  try {
    add(
      '檔名座號解析',
      parseSeatFromFileName('S07__x.jpg') === '07' &&
        parseSeatFromFileName('S07_x.jpg') === '07' &&
        parseSeatFromFileName('S07-x.jpg') === '07' &&
        parseSeatFromFileName('S07 x.jpg') === '07' &&
        parseSeatFromFileName('S07 (1).jpg') === '07' &&
        parseSeatFromFileName('07.jpg') === '07' &&
        parseSeatFromFileName('7.jpg') === null &&
        parseSeatFromFileName('S7.jpg') === null &&
        parseSeatFromFileName('S072.jpg') === null &&
        parseSeatFromFileName('photo.jpg') === null,
      'S07／S07_／S07-／S07 空白／07 皆可；7、S7、S072、無座號不猜'
    )

    await openDatabase(dbRoot, { remember: false })
    add('開啟資料庫', true, dbRoot)

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
    add('建立班級與作業', true, `${created.id}／${assignment.id}`)

    await writeSettings({ externalInboxRoot: driveRoot })
    const persisted = await readSettings()
    add(
      '設定持久化',
      persisted.externalInboxRoot === driveRoot,
      persisted.externalInboxRoot ?? '未寫入'
    )

    await startExternalWatcher(driveRoot, dbRoot)
    const status = getImportStatus()
    add(
      '外部 watcher 啟動',
      status.externalWatching === true && status.externalRoot === driveRoot,
      `watching=${status.externalWatching}、root=${status.externalRoot}`
    )

    const assignmentDir = await ensureExternalAssignmentFolder(created.id, assignment.id)
    add(
      '建立此作業資料夾',
      assignmentDir === join(driveRoot, created.id, assignment.id) &&
        (await exists(assignmentDir)),
      assignmentDir
    )

    const base = await readFile(source)
    const s07Bytes = Buffer.concat([base, Buffer.from('\ndrive-s07')])
    const s08Bytes = Buffer.concat([base, Buffer.from('\ndrive-s08')])
    const s12Bytes = Buffer.concat([base, Buffer.from('\ndrive-s12')])
    const flatBytes = Buffer.concat([base, Buffer.from('\ndrive-flat-s08')])
    const wrongBytes = Buffer.concat([base, Buffer.from('\ndrive-wrong-sidecar')])
    const noSeatBytes = Buffer.concat([base, Buffer.from('\ndrive-no-seat')])
    const orphanBytes = Buffer.concat([base, Buffer.from('\ndrive-flat-orphan')])

    const s07Path = join(assignmentDir, 'S07__20261119T143012__001.jpg')
    const s08Path = join(assignmentDir, 'S08__20261119T143012__002.jpg')
    const s08Sidecar = join(assignmentDir, 'S08__20261119T143012__002.json')
    const s12Path = join(assignmentDir, 'S07__20261119T143012__003.jpg')
    const s12Sidecar = join(assignmentDir, 'S07__20261119T143012__003.json')
    const pdfPath = join(assignmentDir, 'S09__20261119T143012__004.pdf')
    const noSeatPath = join(assignmentDir, 'photo-no-seat.jpg')
    const wrongPath = join(assignmentDir, 'S07__wrong.jpg')
    const wrongSidecar = join(assignmentDir, 'S07__wrong.json')
    const flatPath = join(driveRoot, 'flat-photo.jpg')
    const flatSidecar = join(driveRoot, 'flat-photo.json')
    const flatOrphanPath = join(driveRoot, 'flat-orphan.jpg')
    const duplicatePath = join(assignmentDir, 'S07 (1).jpg')

    await writeFile(s07Path, s07Bytes)
    await writeFile(s08Path, s08Bytes)
    await writeFile(
      s08Sidecar,
      sidecar(created.id, assignment.id, '08'),
      'utf8'
    )
    await writeFile(s12Path, s12Bytes)
    await writeFile(
      s12Sidecar,
      sidecar(created.id, assignment.id, '12'),
      'utf8'
    )
    await writeFile(pdfPath, Buffer.from('%PDF-1.4\n% drive-check\n'))
    await writeFile(noSeatPath, noSeatBytes)
    await writeFile(wrongPath, wrongBytes)
    await writeFile(
      wrongSidecar,
      sidecar('C999-2099F', assignment.id, '07'),
      'utf8'
    )
    await writeFile(flatPath, flatBytes)
    await writeFile(
      flatSidecar,
      sidecar(created.id, assignment.id, '08'),
      'utf8'
    )
    await writeFile(flatOrphanPath, orphanBytes)

    const done = await waitFor(async () => {
      const events = driveEvents()
      const count = (type: string): number =>
        events.filter((event) => event.type === type).length
      return count('imported') >= 4 && count('unmatched') >= 4
    }, 45000)

    const importedEvents = driveEvents().filter((event) => event.type === 'imported')
    add(
      'Drive 事件可辨識',
      done && importedEvents.length >= 4 && importedEvents.every((event) => event.message.startsWith('Drive：')),
      `${importedEvents.length} 個 imported 事件`
    )

    const works = await listWorks(created.id, assignment.id)
    const pagesOf = (seat: string): number =>
      works.find((work) => work.seat === seat)?.pages ?? 0
    add(
      '子資料夾 S07 檔名匯入',
      pagesOf('07') === 1,
      `S07 ${pagesOf('07')} 頁`
    )
    add(
      'S08 帶 sidecar 匯入',
      importedEvents.some((event) => event.seat === '08') && pagesOf('08') >= 2,
      `S08 ${pagesOf('08')} 頁（含扁平 sidecar）`
    )
    add(
      'S12 sidecar 優先',
      pagesOf('12') === 1 && !importedEvents.some((event) => event.seat === '07' && event.file === 'p2.jpg'),
      `S12 ${pagesOf('12')} 頁；檔名 S07 但 sidecar 指定 12`
    )
    add(
      '扁平模式 sidecar 路由',
      importedEvents.filter((event) => event.seat === '08' && event.classId === created.id).length >= 2,
      'flat-photo.jpg 依 sidecar 進 S08'
    )
    add(
      'work.json 頁數正確',
      works.length === 3 &&
        works.reduce((sum, item) => sum + item.pages, 0) === 4 &&
        pagesOf('07') === 1 &&
        pagesOf('08') === 2 &&
        pagesOf('12') === 1,
      `${works.length} 份／${works.reduce((sum, item) => sum + item.pages, 0)} 頁`
    )

    const sourcesGone =
      !(await exists(s07Path)) &&
      !(await exists(s08Path)) &&
      !(await exists(s08Sidecar)) &&
      !(await exists(s12Path)) &&
      !(await exists(s12Sidecar)) &&
      !(await exists(flatPath)) &&
      !(await exists(flatSidecar))
    add('成功後刪除 Drive 來源', sourcesGone, '圖片與 sidecar 皆已刪除')

    // 等原始頁面確定匯入後，再送 Drive 衝突副本，確保測到的是去重而不是先後順序。
    await writeFile(duplicatePath, s07Bytes)
    const duplicateSeen = await waitFor(async () =>
      driveEvents().some((event) => event.type === 'duplicate'), 20000)

    const dupDir = join(driveRoot, '_duplicates')
    const dupReason = await reasonFor(dupDir, 'S07 (1).jpg')
    add(
      '重複檔不新增頁面',
      duplicateSeen &&
        pagesOf('07') === 1 &&
        Boolean(dupReason?.includes('重複')),
      dupReason?.trim() || '未找到重複原因'
    )

    const unmatchedDir = join(driveRoot, '_unmatched')
    const unmatchedFiles = (await readdir(unmatchedDir).catch(() => [] as string[])).filter(
      (file) => !file.endsWith('.reason.txt') && !file.endsWith('.json')
    )
    const pdfReason = await reasonFor(unmatchedDir, 'S09__20261119T143012__004.pdf')
    const noSeatReason = await reasonFor(unmatchedDir, 'photo-no-seat.jpg')
    const wrongReason = await reasonFor(unmatchedDir, 'S07__wrong.jpg')
    const orphanReason = await reasonFor(unmatchedDir, 'flat-orphan.jpg')

    add(
      '沒有座號／沒有 sidecar 進 _unmatched',
      Boolean(noSeatReason?.includes('座號')) &&
        Boolean(orphanReason?.includes('sidecar')),
      `無座號：${noSeatReason?.trim() ?? '缺'}；扁平缺 sidecar：${orphanReason?.trim() ?? '缺'}`
    )
    add(
      'PDF 進 _unmatched 且有原因',
      Boolean(pdfReason?.includes('不支援 PDF')),
      pdfReason?.trim() || '未找到 PDF 原因'
    )
    add(
      'sidecar 指向錯誤 class／assignment 被擋',
      Boolean(wrongReason?.includes('不符')) && !(await exists(wrongPath)),
      wrongReason?.trim() || '未找到錯誤 sidecar 原因'
    )
    add(
      '失敗檔保留在 _unmatched',
      unmatchedFiles.length === 4,
      `${unmatchedFiles.length} 個來源檔、皆有 reason`
    )

    await stopExternalWatcher()
    const missingRoot = join(work, 'no-such-drive-root')
    const seenErrors = new Set(
      driveEvents()
        .filter((event) => event.type === 'error')
        .map((event) => event.id)
    )
    await startExternalWatcher(missingRoot, dbRoot)
    const missingStatus = getImportStatus()
    const missingError = driveEvents().find(
      (event) =>
        event.type === 'error' &&
        !seenErrors.has(event.id) &&
        event.message.includes('無法讀取')
    )
    add(
      '外部根目錄不存在不崩潰',
      missingStatus.externalWatching === false &&
        Boolean(missingError) &&
        getExternalStatus().watching === false,
      missingError?.message ?? '未收到錯誤事件'
    )

    await startExternalWatcher(driveRoot, dbRoot)
    const restored = getImportStatus()
    add(
      '重新啟動外部 watcher',
      restored.externalWatching === true,
      `root=${restored.externalRoot}`
    )

    const ui = await runUiSmoke(driveRoot, assignment.id)
    add('UI 有 Google Drive inbox 區塊、四個按鈕與 preload API', ui.ok, ui.detail)

    await clearExternalInboxRoot()
    const cleared = await readSettings()
    add(
      '清除外部 inbox 設定',
      cleared.externalInboxRoot === undefined,
      'settings.json 已無 externalInboxRoot'
    )

    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已關閉或從未開啟
    }
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
    `[drive] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
