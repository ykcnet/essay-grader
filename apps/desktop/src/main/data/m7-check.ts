import { app, BrowserWindow } from 'electron'
import { open as openZipFile, type Entry, type ZipFile } from 'yauzl'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MAX_LOG_BYTES,
  flushLogs,
  log,
  logFilePath,
  setLogDirectoryForCheck
} from '../logger'
import {
  backupFileName,
  createBackupZip,
  restoreBackupZip,
  safeEntryPath
} from './backup'
import {
  closeDatabase,
  createAssignment,
  createClass,
  currentRoot,
  getState,
  listWorks,
  loadWork,
  openDatabase,
  saveClass,
  saveWork
} from './repository'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const CLASS_NAME = '高中302'
const STUDENT_NAME = '王小明'
const FINAL_COMMENT = 'M7-敏感總評-不得寫入日誌'
const NOW = '2026-11-19T09:00:00.000Z'

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

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    openZipFile(path, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) reject(error)
      else resolveZip(zip)
    })
  })
}

async function listZipEntries(path: string): Promise<string[]> {
  const zip = await openZip(path)
  try {
    return await new Promise<string[]>((resolveEntries, reject) => {
      const names: string[] = []
      zip.on('entry', (entry: Entry) => {
        names.push(entry.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolveEntries(names))
      zip.on('error', reject)
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 產生含惡意路徑的最小 zip（store 模式），用來實測 zip slip 防線。 */
function makeUnsafeZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const localFull = Buffer.concat([local, name, entry.data])

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))

    locals.push(localFull)
    offset += localFull.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuffer, eocd])
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
    const ready = await waitFor(
      win,
      "document.body.innerText.includes('作文批閱') && !document.body.innerText.includes('載入中')",
      6000
    )
    if (!ready) return { ok: false, detail: '主畫面未渲染' }

    const buttonsReady = await waitFor(
      win,
      `['備份資料庫','還原備份','開啟日誌'].every((text) =>
        [...document.querySelectorAll('.topbar-actions button')].some(
          (item) => item.textContent?.trim() === text
        )
      )`,
      6000
    )

    const apiReady = (await win.webContents.executeJavaScript(
      `Boolean(
        window.electronAPI &&
        typeof window.electronAPI.backup?.create === 'function' &&
        typeof window.electronAPI.backup?.restore === 'function' &&
        typeof window.electronAPI.logs?.open === 'function' &&
        typeof window.electronAPI.logs?.path === 'function' &&
        typeof window.electronAPI.logs?.write === 'function'
      )`
    )) as boolean

    return {
      ok: buttonsReady && apiReady,
      detail: `備份／還原／日誌按鈕 ${buttonsReady ? '是' : '否'}、preload API ${apiReady ? '是' : '否'}`
    }
  } finally {
    win.destroy()
  }
}

async function hasErrorBoundaryBundle(): Promise<boolean> {
  const dir = join(__dirname, '../renderer/assets')
  try {
    const files = await readdir(dir)
    for (const file of files.filter((name) => name.endsWith('.js'))) {
      const text = await readFile(join(dir, file), 'utf8')
      if (text.includes('畫面發生未預期的錯誤')) return true
    }
  } catch {
    return false
  }
  return false
}

/** `--m7-check`：備份／還原、日誌、錯誤邊界、打包設定與 UI 入口。 */
export async function runM7Check(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'm7')
  const root = join(work, 'db')
  const zipPath = join(work, 'backup.zip')
  const restoreRoot = join(work, 'restore')
  const notEmptyDir = join(work, 'not-empty')
  const evilRoot = join(work, 'evil-target')
  const evilZip = join(work, 'evil.zip')
  const logsDir = join(work, 'logs')

  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  setLogDirectoryForCheck(logsDir)

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    // ---- 建立測試資料庫 ------------------------------------------------
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
        { seat: '07', name: STUDENT_NAME, active: true },
        { seat: '08', name: '陳大華', active: true }
      ]
    })

    const assignment = (await createAssignment({
      classId: created.id,
      title: '我的母親',
      prompt: '',
      rubricPreset: 'balanced'
    })) as { id: string }

    const workDir = join(root, created.id, assignment.id, 'S07')
    await mkdir(workDir, { recursive: true })
    await writeFile(join(workDir, 'p1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

    await saveWork(created.id, assignment.id, '07', {
      schema_version: 1,
      class_id: created.id,
      assignment_id: assignment.id,
      seat: '07',
      name: STUDENT_NAME,
      status: 'done',
      pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
      annotations: [],
      scores: {
        items: { content: 32, structure: 24, language: 25 },
        deduction: { typo: 0, punct: 0, override: null },
        total: 81,
        grade: 'A-'
      },
      final_comment: { text: FINAL_COMMENT },
      updated_at: NOW
    })
    await copyFile(join(workDir, 'work.json'), join(workDir, 'work.json.bak'))

    const statsDir = join(root, created.id, assignment.id, '_stats')
    await mkdir(statsDir, { recursive: true })
    await writeFile(join(statsDir, 'scores.csv'), '\uFEFF座號,姓名\r\n07,王小明\r\n', 'utf8')

    await writeFile(join(root, 'junk.tmp'), 'tmp', 'utf8')
    await writeFile(join(workDir, 'work.json.restore.tmp'), 'tmp', 'utf8')

    add('建立暫存資料庫', currentRoot() === root, `${created.id}／${assignment.id}`)

    // ---- 備份 ----------------------------------------------------------
    const fileName = backupFileName(new Date(2026, 10, 19, 8, 5))
    add(
      '預設備份檔名',
      fileName === 'essay-grader-backup-20261119-0805.zip',
      fileName
    )

    const backup = await createBackupZip(root, zipPath)
    const zipInfo = await stat(zipPath)
    add(
      '備份 zip 存在且非空',
      zipInfo.isFile() && zipInfo.size > 0 && backup.files > 0,
      `${backup.files} 檔、${zipInfo.size} bytes`
    )

    const names = await listZipEntries(zipPath)
    const hasClass = names.includes(`${created.id}/class.json`)
    const hasWork = names.includes(`${created.id}/${assignment.id}/S07/work.json`)
    add('備份含 class.json 與 work.json', hasClass && hasWork, `${names.length} 個 entry`)

    const hasImage = names.includes(`${created.id}/${assignment.id}/S07/p1.jpg`)
    const hasStats = names.includes(`${created.id}/${assignment.id}/_stats/scores.csv`)
    const hasBak = names.includes(`${created.id}/${assignment.id}/S07/work.json.bak`)
    add('備份含圖片、_stats 與 .bak', hasImage && hasStats && hasBak, 'p1.jpg／scores.csv／work.json.bak')

    const hasLock = names.some((name) => name.endsWith('.essay-grader.lock'))
    const hasTmp = names.some((name) => name.endsWith('.tmp'))
    add('備份排除 lock 與 tmp', !hasLock && !hasTmp, `lock=${hasLock}、tmp=${hasTmp}`)

    const relativeOnly = names.every(
      (name) =>
        !name.startsWith('/') &&
        !/^[A-Za-z]:/.test(name) &&
        !name.includes('\\') &&
        !name.split('/').some((part) => part === '..')
    )
    add('備份路徑全為相對路徑', relativeOnly, '無磁碟代號、開頭斜線或 ..')

    add(
      '備份未包含目標 zip 自身',
      !names.some((name) => name.endsWith('backup.zip')),
      '目標在資料庫外'
    )

    // ---- 還原 ----------------------------------------------------------
    await mkdir(notEmptyDir, { recursive: true })
    await writeFile(join(notEmptyDir, 'keep.txt'), 'keep', 'utf8')
    let refusedNonEmpty = false
    try {
      await restoreBackupZip(zipPath, notEmptyDir)
    } catch (error) {
      refusedNonEmpty = message(error).includes('不是空資料夾')
    }
    const keepStillThere = (await readFile(join(notEmptyDir, 'keep.txt'), 'utf8')) === 'keep'
    add('目的地非空時拒絕還原', refusedNonEmpty && keepStillThere, '原有檔案未被覆寫')
    await rm(notEmptyDir, { recursive: true, force: true })

    const unsafeNames = ['../evil.txt', '..\\evil.txt', 'C:/evil.txt', '/evil.txt', 'a/../../evil.txt']
    const unsafeRejected = unsafeNames.every((name) => {
      try {
        safeEntryPath(evilRoot, name)
        return false
      } catch {
        return true
      }
    })
    add('zip slip 路徑直接拒絕', unsafeRejected, `${unsafeNames.length} 種惡意路徑`)

    await writeFile(
      evilZip,
      makeUnsafeZip([{ name: '../m7-evil.txt', data: Buffer.from('evil') }])
    )
    let unsafeZipRejected = false
    try {
      await restoreBackupZip(evilZip, evilRoot)
    } catch {
      unsafeZipRejected = true
    }
    let evilFileEscaped = false
    try {
      await stat(join(work, 'm7-evil.txt'))
      evilFileEscaped = true
    } catch {
      evilFileEscaped = false
    }
    add(
      '惡意 zip 不寫出目的地',
      unsafeZipRejected && !evilFileEscaped,
      unsafeZipRejected ? '已拒絕且無逃逸檔案' : '未拒絕'
    )

    const restored = await restoreBackupZip(zipPath, restoreRoot)
    add(
      '還原到新資料夾成功',
      restored.files === backup.files && restored.bytes > 0,
      `${restored.files} 檔、${restored.bytes} bytes`
    )

    await closeDatabase()
    await openDatabase(restoreRoot, { remember: false })
    const restoredState = await getState()
    add(
      '還原後資料庫可開啟',
      restoredState.root === restoreRoot && restoredState.classes.length === 1,
      `${restoredState.classes.length} 班級、${restoredState.warnings.length} 警告`
    )

    const restoredWorks = await listWorks(created.id, assignment.id)
    const restoredWork = await loadWork(created.id, assignment.id, '07')
    add(
      '還原後 class／work 數量正確',
      restoredWorks.length === 1 &&
        restoredWork.name === STUDENT_NAME &&
        restoredWork.scores?.total === 81 &&
        restoredWork.final_comment?.text === FINAL_COMMENT,
      `work ${restoredWorks.length} 份、總分 ${restoredWork.scores?.total}`
    )

    let refusedOverwrite = false
    try {
      await restoreBackupZip(zipPath, restoreRoot)
    } catch (error) {
      refusedOverwrite = message(error).includes('不是空資料夾')
    }
    const afterAttempt = await getState()
    add(
      '不覆寫目前開啟的資料庫',
      refusedOverwrite && afterAttempt.classes.length === 1 && currentRoot() === restoreRoot,
      '目前資料庫保持 1 班級'
    )

    // ---- 日誌 ----------------------------------------------------------
    log('info', 'm7 log 格式測試')
    await flushLogs()
    const logText = await readFile(logFilePath(logsDir), 'utf8')
    const formatOk =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[(INFO|WARN|ERROR)\] /m.test(logText)
    add('日誌含時間與 level', formatOk && logText.includes('[INFO]'), `${logText.length} chars`)

    log('info', '大型日誌輪替測試')
    for (let index = 0; index < 620; index += 1) {
      log('info', `輪替測試 ${index} ${'x'.repeat(3600)}`)
    }
    await flushLogs()
    const activeSize = (await stat(logFilePath(logsDir))).size
    const rotatedSize = (await stat(join(logsDir, 'app.1.log'))).size
    add(
      '日誌超過 2MB 會輪替',
      rotatedSize >= MAX_LOG_BYTES && activeSize < MAX_LOG_BYTES + 8192,
      `app.1.log ${rotatedSize} bytes、app.log ${activeSize} bytes`
    )

    const rotatedText = await readFile(join(logsDir, 'app.1.log'), 'utf8')
    const allLogs = `${rotatedText}\n${logText}`
    add(
      '日誌不含敏感全文',
      !allLogs.includes(STUDENT_NAME) && !allLogs.includes(FINAL_COMMENT),
      '未出現學生姓名或總評內容'
    )

    // ---- UI 與錯誤邊界 --------------------------------------------------
    const boundary = await hasErrorBoundaryBundle()
    add('ErrorBoundary 已進入建置產物', boundary, boundary ? '找到友善錯誤畫面文字' : '未找到')

    const ui = await runUiSmoke()
    add('主畫面備份／還原／日誌入口與 preload API', ui.ok, ui.detail)

    // ---- 打包設定 ------------------------------------------------------
    const configPath = join(app.getAppPath(), 'electron-builder.yml')
    let config = ''
    try {
      config = await readFile(configPath, 'utf8')
    } catch {
      config = ''
    }
    const configChecks = {
      appId: config.includes('appId: tw.edu.essaygrader'),
      product: config.includes('productName: 作文批閱'),
      nsis: /^nsis:/m.test(config) && config.includes('oneClick: false'),
      portable: /^portable:/m.test(config),
      icon: config.includes('icon: app.ico') || config.includes('icon: ../../app.ico'),
      unpack: config.includes('asarUnpack') && config.includes('@img'),
      rebuild: config.includes('npmRebuild: false'),
      artifact:
        config.includes('EssayGrader-${version}-Setup.${ext}') &&
        config.includes('EssayGrader-${version}-Portable.${ext}'),
      output: config.includes('output: release')
    }
    const missingConfig = Object.entries(configChecks)
      .filter(([, value]) => !value)
      .map(([key]) => key)
    add(
      'electron-builder 設定完整',
      missingConfig.length === 0,
      missingConfig.length === 0 ? 'appId／NSIS／portable／icon／asar' : `缺少 ${missingConfig.join('、')}`
    )

    const iconPath = join(repoRoot, 'app.ico')
    const iconInfo = await stat(iconPath).catch(() => null)
    add('安裝檔圖示存在', Boolean(iconInfo?.isFile() && iconInfo.size > 0), iconInfo ? `${iconInfo.size} bytes` : '找不到 app.ico')

    const versions = await Promise.all(
      [
        join(repoRoot, 'package.json'),
        join(app.getAppPath(), 'package.json'),
        join(repoRoot, 'packages', 'core', 'package.json')
      ].map(async (path) => {
        const json = JSON.parse(await readFile(path, 'utf8')) as { version?: string }
        return json.version ?? ''
      })
    )
    add(
      '版本一致為 0.1.0',
      versions.every((version) => version === '0.1.0'),
      versions.join('／')
    )

    const releaseDir = join(app.getAppPath(), 'release')
    let artifacts: Array<{ name: string; size: number }> = []
    try {
      const entries = await readdir(releaseDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.exe')) continue
        const info = await stat(join(releaseDir, entry.name))
        artifacts.push({ name: entry.name, size: info.size })
      }
    } catch {
      artifacts = []
    }
    const artifactOk =
      artifacts.length === 0 ||
      artifacts.every(
        (artifact) =>
          artifact.size > 0 && /^EssayGrader-0\.1\.0-(Setup|Portable)\.exe$/.test(artifact.name)
      )
    add(
      '打包產物（若有）非空且命名正確',
      artifactOk,
      artifacts.length > 0
        ? artifacts.map((item) => `${item.name} ${item.size} bytes`).join('、')
        : 'release 尚無產物（打包最後執行）'
    )

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
    `[m7] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
