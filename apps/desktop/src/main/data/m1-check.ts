import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { acquireLock } from './lock'
import {
  closeDatabase,
  createAssignment,
  createClass,
  listAssignments,
  loadAssignment,
  loadClass,
  openDatabase,
  saveClass
} from './repository'
import { readSettings, writeSettings } from './settings'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** 開一個隱藏視窗載入主畫面，確認 bundle、preload 與 IPC 都正常。 */
async function runUiSmoke(): Promise<{ ok: boolean; detail: string }> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 860,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))

    let text = ''
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      text = (await win.webContents.executeJavaScript('document.body.innerText')) as string
      if (text.includes('作文批閱') && !text.includes('載入中')) break
    }

    const hasApi = (await win.webContents.executeJavaScript(
      'Boolean(window.electronAPI && window.electronAPI.db)'
    )) as boolean

    return {
      ok: text.includes('作文批閱') && hasApi,
      detail: text.includes('作文批閱') ? '主畫面與 preload API 正常' : '主畫面未渲染'
    }
  } finally {
    win.destroy()
  }
}

/** `--m1-check`：實際走一次建班級、名單、壞檔還原、作業、鎖。 */
export async function runM1Check(): Promise<number> {
  const root = join(app.getAppPath(), '..', '..', 'spike-out', 'm1-db')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

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
    add('建立班級', created.id === 'C302-2025F', created.id)

    const loaded = await loadClass(created.id)
    loaded.data.students = [
      { seat: '07', name: '王小明', active: true },
      { seat: '08', name: '陳怡君', active: true },
      { seat: '12', name: '林志豪', active: true }
    ]
    await saveClass(loaded.data)
    await saveClass(loaded.data)

    const reopened = await loadClass(created.id)
    add('名單寫入與重讀', reopened.data.students.length === 3, `${reopened.data.students.length} 人`)

    const classPath = join(root, created.id, 'class.json')
    await writeFile(classPath, '{ 這是壞掉的 JSON', 'utf8')
    const recovered = await loadClass(created.id)
    add(
      '壞檔降級 .bak',
      recovered.data.students.length === 3 && Boolean(recovered.warning),
      recovered.warning ?? '沒有觸發還原'
    )

    let restored = false
    try {
      JSON.parse(await readFile(classPath, 'utf8'))
      restored = true
    } catch {
      restored = false
    }
    add('主檔已自動修復', restored, classPath)

    const first = await createAssignment({
      classId: created.id,
      title: '我的母親',
      prompt: '請以「我的母親」為題，寫一篇至少 600 字的記敘文。',
      genre: 'narrative',
      wordLimit: 800,
      rubricPreset: 'junior'
    })
    const list = await listAssignments(created.id)
    add('建立作業', list.length >= 1 && list[0]?.title === '我的母親', first.id)

    const loadedAssignment = await loadAssignment(created.id, first.id)
    add(
      '讀取作業與量規',
      loadedAssignment.data.rubric.items.length === 3,
      loadedAssignment.data.rubric.id
    )

    const second = await createAssignment({
      classId: created.id,
      title: '我的母親（第二份）',
      prompt: '',
      rubricPreset: 'junior'
    })
    add('同日作業撞名', second.id !== first.id, second.id)

    const ui = await runUiSmoke()
    add('主畫面載入', ui.ok, ui.detail)

    let blocked = false
    try {
      const duplicate = await acquireLock(root)
      await duplicate.release()
    } catch {
      blocked = true
    }
    add('第二個 writer 被擋', blocked, blocked ? '已擋下' : '未擋下')

    await closeDatabase()
    const lock = await acquireLock(root)
    await lock.release()
    add('關閉資料庫後釋放鎖', true, '可重新開啟')
  } catch (error) {
    add('執行流程', false, message(error))
  }

  // 測試資料庫不該變成下次啟動的預設資料庫
  const settings = await readSettings()
  if (settings.lastDatabase === root) {
    await writeSettings({ lastDatabase: undefined })
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(`[m1] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`)
  return ok ? 0 : 1
}
