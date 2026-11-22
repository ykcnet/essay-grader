import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  closeDatabase,
  createAssignment,
  createClass,
  loadClass,
  openDatabase,
  saveClass
} from '../data/repository'
import { clearExternalInboxRoot, readSettings, writeSettings } from '../data/settings'
import { startExternalWatcher, stopExternalWatcher } from './external'
import { writePhoneManifest } from './manifest'

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

/** 遞迴收集 JSON 的所有 key，用來確認 manifest 沒有夾帶分數或批注。 */
function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key)
      collectKeys(item, keys)
    }
  }
  return keys
}

const ALLOWED_KEYS = new Set([
  'schema_version',
  'generated_at',
  'classes',
  'id',
  'name',
  'grade',
  'assignments',
  'title',
  'students',
  'seat'
])

async function runUiSmoke(assignmentId: string): Promise<{ ok: boolean; detail: string }> {
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

    const panelReady = await waitForWindow(
      win,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (item) => item.textContent?.includes('產生手機 manifest')
        )
        return Boolean(button) && !button.disabled &&
          document.body.innerText.includes('Google Drive inbox')
      })()`,
      10000
    )
    if (!panelReady) return { ok: false, detail: 'Drive inbox 區塊沒有可用的 manifest 按鈕' }

    const apiReady = (await win.webContents.executeJavaScript(
      "typeof window.electronAPI.imports.writeManifest === 'function'"
    )) as boolean
    if (!apiReady) return { ok: false, detail: 'preload imports.writeManifest 不存在' }

    const invoked = (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (item) => item.textContent?.includes('產生手機 manifest')
        )
        if (!button) return false
        button.click()
        return true
      })()`
    )) as boolean
    if (!invoked) return { ok: false, detail: '無法按下 manifest 按鈕' }

    const toastReady = await waitForWindow(
      win,
      `document.body.innerText.includes('已產生 manifest') &&
       document.body.innerText.includes('2 份作業') &&
       document.body.innerText.includes('2 位在學學生')`,
      10000
    )
    if (!toastReady) return { ok: false, detail: '按下後沒有顯示路徑與班級／作業／學生數' }

    return { ok: true, detail: '按鈕、preload 與成功提示（含路徑、1 班級、2 份作業、2 位在學學生）皆正常' }
  } finally {
    win.destroy()
  }
}

/** `--manifest-check`：驗證手機 manifest 內容、覆蓋、錯誤處理與 UI。 */
export async function runManifestCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'manifest-check')
  const dbRoot = join(work, 'db')
  const driveRoot = join(work, 'Google 雲端硬碟', 'EssayGrader', 'inbox')
  const userData = join(work, 'userData')

  await rm(work, { recursive: true, force: true })
  await mkdir(dbRoot, { recursive: true })
  await mkdir(driveRoot, { recursive: true })
  await mkdir(userData, { recursive: true })
  app.setPath('userData', userData)
  await openDatabase(dbRoot, { remember: false })
  await writeSettings({ externalInboxRoot: driveRoot })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
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
      { seat: '12', name: '林志豪', active: false }
    ]
    await saveClass(loaded.data)

    const first = await createAssignment({
      classId: created.id,
      title: '我的母親',
      prompt: '',
      genre: 'narrative',
      wordLimit: 600,
      rubricPreset: 'junior',
      dueAt: '2026-11-10T00:00:00.000Z'
    })
    const second = await createAssignment({
      classId: created.id,
      title: '一件小事',
      prompt: '',
      genre: 'narrative',
      wordLimit: 600,
      rubricPreset: 'junior',
      dueAt: '2026-11-20T00:00:00.000Z'
    })
    add('建立 1 班 2 作業（含 1 位不在學學生）', true, `${created.id}／${first.id}、${second.id}`)

    await writeSettings({ externalInboxRoot: driveRoot })
    const result = await writePhoneManifest(created.id)
    add(
      '產生 manifest',
      result.path === join(driveRoot, 'manifest.json') &&
        (await exists(result.path)) &&
        result.classCount === 1 &&
        result.assignmentCount === 2 &&
        result.studentCount === 2,
      `${result.path}（班級 ${result.classCount}、作業 ${result.assignmentCount}、學生 ${result.studentCount}）`
    )

    const raw = await readFile(result.path, 'utf8')
    const manifest = JSON.parse(raw) as {
      schema_version: number
      generated_at: string
      classes: Array<{
        id: string
        name: string
        grade: string
        assignments: Array<{
          id: string
          title: string
          students: Array<{ seat: string; name: string }>
        }>
      }>
    }

    add(
      'schema_version 與 generated_at',
      manifest.schema_version === 1 &&
        typeof manifest.generated_at === 'string' &&
        !Number.isNaN(Date.parse(manifest.generated_at)) &&
        new Date(manifest.generated_at).toISOString() === manifest.generated_at,
      `schema_version=${manifest.schema_version}、generated_at=${manifest.generated_at}`
    )

    const cls = manifest.classes[0]
    add(
      'classes 只有目前班級',
      manifest.classes.length === 1 &&
        cls?.id === created.id &&
        cls?.name === '國中302' &&
        cls?.grade === 'junior',
      `${manifest.classes.length} 班、${cls?.id}／${cls?.name}／${cls?.grade}`
    )

    add(
      'assignments 為該班全部作業',
      cls?.assignments.length === 2 &&
        cls.assignments[0]?.id === first.id &&
        cls.assignments[0]?.title === '我的母親' &&
        cls.assignments[1]?.id === second.id &&
        cls.assignments[1]?.title === '一件小事',
      cls?.assignments.map((item) => `${item.id}／${item.title}`).join('、') ?? '無'
    )

    add(
      'students 只含 active !== false',
      cls?.assignments.every(
        (assignment) =>
          assignment.students.length === 2 &&
          assignment.students[0]?.seat === '07' &&
          assignment.students[0]?.name === '王小明' &&
          assignment.students[1]?.seat === '08' &&
          assignment.students[1]?.name === '陳怡君' &&
          !assignment.students.some((student) => student.seat === '12')
      ) === true,
      cls?.assignments[0]?.students.map((item) => `${item.seat} ${item.name}`).join('、') ?? '無'
    )

    const keys = [...collectKeys(manifest)]
    const extraKeys = keys.filter((key) => !ALLOWED_KEYS.has(key))
    add(
      '不含分數、批注、總評、updated_at 或作品內容',
      extraKeys.length === 0,
      extraKeys.length === 0 ? `只有 ${keys.length} 個必要欄位` : `多出：${extraKeys.join('、')}`
    )

    await writeFile(result.path, '{"stale":true}', 'utf8')
    const overwritten = await writePhoneManifest(created.id)
    const overwrittenRaw = await readFile(overwritten.path, 'utf8')
    add(
      '覆蓋既有 manifest 並採原子寫入',
      !overwrittenRaw.includes('stale') &&
        JSON.parse(overwrittenRaw).classes.length === 1 &&
        !(await exists(`${overwritten.path}.tmp`)) &&
        (await exists(`${overwritten.path}.bak`)),
      `舊內容已覆寫，${overwrittenRaw.length} bytes，無 .tmp 殘留`
    )

    await clearExternalInboxRoot()
    let missingRootMessage = ''
    try {
      await writePhoneManifest(created.id)
    } catch (error) {
      missingRootMessage = message(error)
    }
    add(
      '沒有外部 root 時回繁體中文錯誤',
      missingRootMessage.includes('尚未設定 Google Drive inbox'),
      missingRootMessage || '沒有錯誤'
    )

    await writeSettings({ externalInboxRoot: driveRoot })
    const persisted = await readSettings()
    add(
      '外部 root 設定持久化',
      persisted.externalInboxRoot === driveRoot,
      persisted.externalInboxRoot ?? '未寫入'
    )

    await startExternalWatcher(driveRoot, dbRoot)
    const ui = await runUiSmoke(first.id)
    add('UI 有「產生手機 manifest」並顯示路徑與數量', ui.ok, ui.detail)
  } catch (error) {
    add('執行流程', false, message(error))
  } finally {
    await stopExternalWatcher().catch(() => undefined)
    await closeDatabase().catch(() => undefined)
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[manifest] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
