import { app, BrowserWindow, shell } from 'electron'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssignmentFile, ClassFile, Student, UpdateAssignmentInput } from '@essay-grader/core'
import { ensureInbox, getImportStatus } from '../import/watcher'
import {
  closeDatabase,
  createAssignment,
  createClass,
  deleteAssignment,
  deleteClass,
  getState,
  listAssignments,
  loadAssignment,
  loadClass,
  openDatabase,
  saveClass,
  updateAssignment
} from './repository'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

interface UiSteps {
  buttons: boolean
  assignmentButtons: boolean
  classEdit: {
    ok: boolean
    id: string
    name: string
    grade: string
    teacher?: string
    students: string[]
  }
  assignmentEdit: {
    ok: boolean
    prefilled: boolean
    listUpdated: boolean
    rubricJson: string
    rulesJson: string
  }
  assignmentDelete: { ok: boolean; rows: number; remaining: number }
  classDelete: { ok: boolean; classCount: number }
  detail: string
}

/** 隱藏視窗：實測班級／作業的編輯與刪除按鈕、表單預填、儲存後更新與刪除。 */
async function runUiSmoke(
  classId: string,
  assignmentTitle: string,
  assignmentId: string,
  original: AssignmentFile
): Promise<UiSteps> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (expression: string, timeoutMs: number): Promise<boolean> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = (await win.webContents.executeJavaScript(`Boolean(${expression})`)) as boolean
        if (ok) return true
      } catch {
        // 頁面還在下載或重新渲染
      }
      await delay(120)
    }
    return false
  }

  const result: UiSteps = {
    buttons: false,
    assignmentButtons: false,
    classEdit: { ok: false, id: '', name: '', grade: '', students: [] },
    assignmentEdit: {
      ok: false,
      prefilled: false,
      listUpdated: false,
      rubricJson: '',
      rulesJson: ''
    },
    assignmentDelete: { ok: false, rows: -1, remaining: -1 },
    classDelete: { ok: false, classCount: -1 },
    detail: ''
  }

  const setValueHelper = `
    const setValue = (el, value) => {
      if (!el) return false
      const proto = el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    const field = (form, text) =>
      [...form.querySelectorAll('label')]
        .find((label) => label.textContent?.includes(text))
        ?.querySelector('input, textarea, select')
  `

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))

    const ready = await waitFor("document.querySelector('.class-head h2')", 10000)
    if (!ready) {
      result.detail = '主畫面未載入班級'
      return result
    }

    // ---- 按鈕存在性與結構 ------------------------------------------------
    result.buttons = (await win.webContents.executeJavaScript(
      `(() => {
        const labels = [...document.querySelectorAll('.class-head-actions button')]
          .map((item) => item.textContent?.trim() ?? '')
        return labels.includes('編輯班級') && labels.includes('刪除班級')
      })()`
    )) as boolean

    result.assignmentButtons = (await win.webContents.executeJavaScript(
      `(() => {
        const items = [...document.querySelectorAll('.assignment-item')]
        if (items.length !== 2) return false
        const nested = document.querySelectorAll('.assignment-list button button').length
        const ok = items.every((item) => {
          const labels = [...item.querySelectorAll('.assignment-actions button')]
            .map((button) => button.textContent?.trim() ?? '')
          return labels.includes('編輯') && labels.includes('刪除') &&
            Boolean(item.querySelector('.assignment-select'))
        })
        return ok && nested === 0
      })()`
    )) as boolean

    // ---- 編輯班級 --------------------------------------------------------
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.class-head-actions button')]
        .find((button) => button.textContent?.trim() === '編輯班級')?.click()`
    )
    const classFormReady = await waitFor(
      `[...document.querySelectorAll('form.form')].some(
        (form) => form.textContent?.includes('班級 ID 不變')
      )`,
      5000
    )
    if (classFormReady) {
      await win.webContents.executeJavaScript(
        `(() => {
          ${setValueHelper}
          const form = [...document.querySelectorAll('form.form')]
            .find((item) => item.textContent?.includes('班級 ID 不變'))
          setValue(field(form, '班級名稱'), '國中302（已編輯）')
          setValue(field(form, '學制'), 'senior')
          setValue(field(form, '教師'), '李老師')
          form.querySelector('button[type="submit"]')?.click()
          return true
        })()`
      )
      const titleUpdated = await waitFor(
        `document.querySelector('.class-head h2')?.textContent?.trim() === '國中302（已編輯）'`,
        6000
      )
      const saved = (await win.webContents.executeJavaScript(
        `(async () => {
          const loaded = await window.electronAPI.db.loadClass(${JSON.stringify(classId)})
          return {
            id: loaded.data.id,
            name: loaded.data.name,
            grade: loaded.data.grade,
            teacher: loaded.data.teacher ?? '',
            students: loaded.data.students.map((item) => item.seat + ':' + item.active).join(',')
          }
        })()`
      )) as {
        id: string
        name: string
        grade: string
        teacher: string
        students: string
      }
      result.classEdit = {
        ok: titleUpdated && saved.name === '國中302（已編輯）' && saved.grade === 'senior',
        id: saved.id,
        name: saved.name,
        grade: saved.grade,
        teacher: saved.teacher,
        students: saved.students.split(',')
      }
    }

    // ---- 編輯作業 --------------------------------------------------------
    await win.webContents.executeJavaScript(
      `(() => {
        const item = [...document.querySelectorAll('.assignment-item')]
          .find((row) => row.querySelector('.assignment-title')?.textContent?.trim() === ${JSON.stringify(assignmentTitle)})
        const button = [...(item?.querySelectorAll('.assignment-actions button') ?? [])]
          .find((entry) => entry.textContent?.trim() === '編輯')
        button?.click()
        return Boolean(button)
      })()`
    )
    const assignmentFormReady = await waitFor(
      `[...document.querySelectorAll('form.form')].some(
        (form) => form.textContent?.includes('作業 ID 不變')
      )`,
      6000
    )
    if (assignmentFormReady) {
      const prefill = (await win.webContents.executeJavaScript(
        `(() => {
          ${setValueHelper}
          const form = [...document.querySelectorAll('form.form')]
            .find((item) => item.textContent?.includes('作業 ID 不變'))
          const title = field(form, '題目')
          const prompt = field(form, '題幹')
          const limit = field(form, '字數下限')
          const due = field(form, '截止日')
          return {
            title: title?.value ?? '',
            prompt: prompt?.value ?? '',
            wordLimit: limit?.value ?? '',
            dueAt: due?.value ?? ''
          }
        })()`
      )) as { title: string; prompt: string; wordLimit: string; dueAt: string }

      result.assignmentEdit.prefilled =
        prefill.title === original.title &&
        prefill.prompt === (original.prompt ?? '') &&
        prefill.wordLimit === (original.word_limit ? String(original.word_limit) : '') &&
        prefill.dueAt === (original.due_at ? original.due_at.slice(0, 10) : '')

      await win.webContents.executeJavaScript(
        `(() => {
          ${setValueHelper}
          const form = [...document.querySelectorAll('form.form')]
            .find((item) => item.textContent?.includes('作業 ID 不變'))
          setValue(field(form, '題目'), '修改後的題目')
          setValue(field(form, '題幹'), '修改後的題幹，請寫 650 字。')
          setValue(field(form, '體裁'), 'argumentative')
          setValue(field(form, '字數下限'), '650')
          setValue(field(form, '截止日'), '2026-12-31')
          form.querySelector('button[type="submit"]')?.click()
          return true
        })()`
      )

      const listUpdated = await waitFor(
        `[...document.querySelectorAll('.assignment-title')]
          .some((item) => item.textContent?.trim() === '修改後的題目')`,
        6000
      )
      const saved = (await win.webContents.executeJavaScript(
        `(async () => {
          const loaded = await window.electronAPI.db.loadAssignment(
            ${JSON.stringify(classId)},
            ${JSON.stringify(assignmentId)}
          )
          return {
            title: loaded.data.title,
            rubric: JSON.stringify(loaded.data.rubric),
            rules: JSON.stringify(loaded.data.rules)
          }
        })()`
      )) as { title: string; rubric: string; rules: string }

      result.assignmentEdit.ok = listUpdated && saved.title === '修改後的題目'
      result.assignmentEdit.listUpdated = listUpdated
      result.assignmentEdit.rubricJson = saved.rubric
      result.assignmentEdit.rulesJson = saved.rules
    }

    // ---- 刪除作業 --------------------------------------------------------
    const rowsBefore = (await win.webContents.executeJavaScript(
      "document.querySelectorAll('.assignment-item').length"
    )) as number
    await win.webContents.executeJavaScript(
      `(() => {
        window.confirm = () => true
        const item = [...document.querySelectorAll('.assignment-item')]
          .find((row) => row.querySelector('.assignment-title')?.textContent?.trim() === '修改後的題目')
        const button = [...(item?.querySelectorAll('.assignment-actions button') ?? [])]
          .find((entry) => entry.textContent?.trim() === '刪除')
        button?.click()
        return Boolean(button)
      })()`
    )
    const rowGone = await waitFor(
      `document.querySelectorAll('.assignment-item').length === ${rowsBefore - 1}`,
      8000
    )
    const remaining = (await win.webContents.executeJavaScript(
      `(async () => {
        const list = await window.electronAPI.db.listAssignments(${JSON.stringify(classId)})
        return list.length
      })()`
    )) as number
    result.assignmentDelete = {
      ok: rowGone && rowsBefore === 2,
      rows: (await win.webContents.executeJavaScript(
        "document.querySelectorAll('.assignment-item').length"
      )) as number,
      remaining
    }

    // ---- 刪除班級 --------------------------------------------------------
    await win.webContents.executeJavaScript(
      `(() => {
        window.confirm = () => true
        const button = [...document.querySelectorAll('.class-head-actions button')]
          .find((entry) => entry.textContent?.trim() === '刪除班級')
        button?.click()
        return Boolean(button)
      })()`
    )
    const classGone = await waitFor("!document.querySelector('.class-head')", 8000)
    const classCount = (await win.webContents.executeJavaScript(
      `(async () => {
        const state = await window.electronAPI.db.state()
        return state.classes.length
      })()`
    )) as number
    result.classDelete = { ok: classGone && classCount === 0, classCount }

    result.detail = `按鈕 ${result.buttons ? '有' : '缺'}、作業列 ${result.assignmentButtons ? '正常' : '異常'}、班級編輯 ${result.classEdit.name}／${result.classEdit.grade}、作業預填 ${result.assignmentEdit.prefilled ? '是' : '否'}、列表更新 ${result.assignmentEdit.listUpdated ? '是' : '否'}、刪除作業剩 ${result.assignmentDelete.rows} 列、刪除班級剩 ${result.classDelete.classCount} 班`
    return result
  } finally {
    win.destroy()
  }
}

async function expectError(
  action: () => Promise<unknown>
): Promise<{ threw: boolean; text: string }> {
  try {
    await action()
    return { threw: false, text: '沒有拋出錯誤' }
  } catch (error) {
    return { threw: true, text: message(error) }
  }
}

const STUDENTS: Student[] = [
  { seat: '01', name: '王小明', active: true },
  { seat: '02', name: '陳怡君', active: false }
]

async function seedClass(name: string): Promise<{ classId: string; assignmentIds: string[] }> {
  const created = await createClass({
    classNo: '302',
    name,
    grade: 'junior',
    academicYear: '114',
    semester: 1,
    teacher: '王老師'
  })
  await saveClass({
    schema_version: 1,
    id: created.id,
    name,
    grade: 'junior',
    academic_year: '114',
    semester: 1,
    teacher: '王老師',
    students: STUDENTS
  })
  const first = await createAssignment({
    classId: created.id,
    title: '我的母親',
    prompt: '請以「我的母親」為題，寫一篇記敘文。',
    genre: 'narrative',
    wordLimit: 800,
    dueAt: '2026-11-01T23:59:00+08:00',
    rubricPreset: 'junior'
  })
  const second = await createAssignment({
    classId: created.id,
    title: '我的校園',
    prompt: '請描寫校園的一角。',
    genre: 'narrative',
    rubricPreset: 'junior'
  })
  return { classId: created.id, assignmentIds: [first.id, second.id] }
}

/** `--crud-check`：班級／作業編輯刪除的 CRUD 驗收與 UI 煙霧。 */
export async function runCrudCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const root = join(repoRoot, 'spike-out', 'crud-db')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    await openDatabase(root, { remember: false })
    add('開啟暫存資料庫', true, root)

    // ---- 建立班級與作業 --------------------------------------------------
    const seeded = await seedClass('國中302')
    const classId = seeded.classId
    const [firstId, secondId] = seeded.assignmentIds
    const classFile = (await loadClass(classId)).data
    add(
      '建立 1 班 2 位學生（1 位 inactive）與 2 份作業',
      classFile.students.length === 2 &&
        classFile.students.filter((item) => !item.active).length === 1 &&
        seeded.assignmentIds.length === 2,
      `${classId}、${classFile.students.map((item) => `${item.seat}${item.active ? '' : '（停用）'}`).join('、')}、${seeded.assignmentIds.join('、')}`
    )

    // ---- updateClass ----------------------------------------------------
    const editedClass: ClassFile = {
      ...classFile,
      name: '國中302（更新）',
      grade: 'senior',
      teacher: '李老師'
    }
    await saveClass(editedClass)
    const reloadedClass = (await loadClass(classId)).data
    const classDirStillThere = await pathExists(join(root, classId, 'class.json'))
    add(
      'saveClass 更新 name/grade/teacher',
      reloadedClass.name === '國中302（更新）' &&
        reloadedClass.grade === 'senior' &&
        reloadedClass.teacher === '李老師',
      `${reloadedClass.name}／${reloadedClass.grade}／${reloadedClass.teacher ?? '—'}`
    )
    add(
      'updateClass 保留 id、資料夾與 students',
      reloadedClass.id === classId &&
        classDirStillThere &&
        JSON.stringify(reloadedClass.students) === JSON.stringify(STUDENTS),
      `${reloadedClass.id}、資料夾 ${classDirStillThere ? '存在' : '消失'}、學生 ${reloadedClass.students.length} 位`
    )

    // ---- updateAssignment ----------------------------------------------
    const beforeFirst = (await loadAssignment(classId, firstId)).data
    const beforeSecond = (await loadAssignment(classId, secondId)).data
    const update: UpdateAssignmentInput = {
      title: '我的母親（更新）',
      prompt: '更新後的題幹。',
      genre: 'argumentative',
      wordLimit: 650,
      dueAt: '2026-12-31T23:59:00+08:00'
    }
    const updatedSummary = await updateAssignment(classId, firstId, update)
    const afterFirst = (await loadAssignment(classId, firstId)).data
    add(
      'updateAssignment 更新五個欄位',
      afterFirst.title === update.title &&
        afterFirst.prompt === update.prompt &&
        afterFirst.genre === update.genre &&
        afterFirst.word_limit === update.wordLimit &&
        afterFirst.due_at === update.dueAt &&
        updatedSummary.title === update.title,
      `${afterFirst.title}／${afterFirst.genre}／${afterFirst.word_limit} 字／${afterFirst.due_at ?? '—'}`
    )
    add(
      'updateAssignment 保留 id、rubric 與 rules',
      afterFirst.id === beforeFirst.id &&
        JSON.stringify(afterFirst.rubric) === JSON.stringify(beforeFirst.rubric) &&
        JSON.stringify(afterFirst.rules) === JSON.stringify(beforeFirst.rules),
      `${afterFirst.id}、量規 ${afterFirst.rubric.id} 不變、規則不變`
    )
    const untouchedSecond = (await loadAssignment(classId, secondId)).data
    add(
      'updateAssignment 不影響其他作業',
      JSON.stringify(untouchedSecond) === JSON.stringify(beforeSecond),
      `${untouchedSecond.id} 未變更`
    )

    // ---- 錯誤處理 --------------------------------------------------------
    const missingClass = await expectError(() => deleteClass('C999-2025F'))
    const missingAssignment = await expectError(() =>
      updateAssignment(classId, 'E20000101', { title: '不存在', prompt: '' })
    )
    add(
      '不存在班級／作業回報繁中錯誤',
      missingClass.threw &&
        missingClass.text.includes('找不到班級') &&
        missingAssignment.threw &&
        missingAssignment.text.includes('找不到作業'),
      `${missingClass.text}；${missingAssignment.text}`
    )

    const badId = await expectError(() => deleteAssignment(classId, 'not-an-id'))
    const badClassId = await expectError(() => deleteClass('302/../壞'))
    add(
      '非法 id 回報繁中錯誤',
      badId.threw &&
        badId.text.includes('作業 id 格式不正確') &&
        badClassId.threw &&
        badClassId.text.includes('班級 id 格式不正確'),
      `${badId.text}；${badClassId.text}`
    )

    const emptyTitle = await expectError(() =>
      updateAssignment(classId, firstId, { title: '', prompt: '' })
    )
    add(
      '空題目由 schema 回報繁中錯誤',
      emptyTitle.threw && emptyTitle.text.includes('請填作文題目'),
      emptyTitle.threw && emptyTitle.text.includes('請填作文題目')
        ? 'schema 回報：請填作文題目'
        : emptyTitle.text
    )

    // ---- 回收桶失敗 ------------------------------------------------------
    const originalTrash = shell.trashItem
    let mocked = false
    try {
      ;(shell as unknown as { trashItem: (path: string) => Promise<void> }).trashItem = async () => {
        throw new Error('模擬回收桶失敗')
      }
      mocked = true
    } catch {
      mocked = false
    }
    let trashFailure = { threw: false, text: '未執行' }
    if (mocked) {
      trashFailure = await expectError(() => deleteAssignment(classId, secondId))
      ;(shell as unknown as { trashItem: typeof originalTrash }).trashItem = originalTrash
    }
    const secondSurvived = await pathExists(join(root, classId, secondId, 'assignment.json'))
    add(
      '回收桶失敗回報繁中錯誤且資料保留',
      mocked
        ? trashFailure.threw &&
            trashFailure.text.includes('無法移到系統資源回收桶') &&
            trashFailure.text.includes('模擬回收桶失敗') &&
            secondSurvived
        : secondSurvived,
      mocked ? trashFailure.text : '略過（無法覆寫 shell.trashItem）'
    )
    if (!mocked) add('回收桶失敗（略過）', secondSurvived, '測試環境不支援覆寫，確認資料仍在')

    // ---- deleteAssignment ----------------------------------------------
    await ensureInbox(classId, firstId)
    const watchingBefore = getImportStatus().watching
    await deleteAssignment(classId, secondId)
    const assignmentDirGone = !(await pathExists(join(root, classId, secondId)))
    const classRemains = await pathExists(join(root, classId, 'class.json'))
    const firstRemains = await pathExists(join(root, classId, firstId, 'assignment.json'))
    const listAfterDelete = await listAssignments(classId)
    add(
      'deleteAssignment 只刪指定作業',
      assignmentDirGone &&
        classRemains &&
        firstRemains &&
        listAfterDelete.length === 1 &&
        listAfterDelete[0]?.id === firstId,
      `資料夾${assignmentDirGone ? '消失' : '仍在'}、班級${classRemains ? '仍在' : '消失'}、剩 ${listAfterDelete.length} 份作業`
    )
    const statusAfterAssignment = getImportStatus()
    add(
      'deleteAssignment 後 watcher 重啟無錯',
      watchingBefore === 1 &&
        statusAfterAssignment.watching === 1 &&
        !statusAfterAssignment.events.some(
          (event) => event.type === 'error' && String(event.message).includes('監看')
        ),
      `刪除前監看 ${watchingBefore}、刪除後監看 ${statusAfterAssignment.watching}（另一份作業仍在監看）`
    )

    // ---- deleteClass ----------------------------------------------------
    await deleteClass(classId)
    const classDirGone = !(await pathExists(join(root, classId)))
    const stateAfterClass = await getState()
    add(
      'deleteClass 移除資料夾與 DB state',
      classDirGone && !stateAfterClass.classes.some((item) => item.id === classId),
      `資料夾${classDirGone ? '消失' : '仍在'}、state ${stateAfterClass.classes.length} 班`
    )
    const statusAfterClass = getImportStatus()
    add(
      'deleteClass 後 watcher 重啟無錯',
      statusAfterClass.watching === 0 &&
        !statusAfterClass.events.some(
          (event) => event.type === 'error' && String(event.message).includes('監看')
        ),
      `監看 ${statusAfterClass.watching} 個 inbox、事件 ${statusAfterClass.events.length} 筆`
    )

    // ---- UI 煙霧：重建一份乾淨資料 --------------------------------------
    const uiSeed = await seedClass('國中302')
    const uiClassId = uiSeed.classId
    const [uiFirstId] = uiSeed.assignmentIds
    const uiAssignment = (await loadAssignment(uiClassId, uiFirstId)).data
    const ui = await runUiSmoke(uiClassId, uiAssignment.title, uiFirstId, uiAssignment)

    add('UI 班級列有「編輯班級」「刪除班級」', ui.buttons, `班級按鈕 ${ui.buttons ? '存在' : '缺少'}`)
    add(
      'UI 作業列有「編輯」「刪除」且非 button 包 button',
      ui.assignmentButtons,
      `作業按鈕 ${ui.assignmentButtons ? '正常' : '異常'}`
    )
    add(
      'UI 編輯班級（name/grade/teacher）後標題更新',
      ui.classEdit.ok &&
        ui.classEdit.id === uiClassId &&
        JSON.stringify(ui.classEdit.students) ===
          JSON.stringify(STUDENTS.map((item) => `${item.seat}:${item.active}`)),
      `${ui.classEdit.name}／${ui.classEdit.grade}／${ui.classEdit.teacher ?? '—'}、id ${ui.classEdit.id === uiClassId ? '不變' : '改變'}、學生 ${ui.classEdit.students.length} 位`
    )
    add(
      'UI 編輯作業表單預填並更新列表',
      ui.assignmentEdit.prefilled && ui.assignmentEdit.ok && ui.assignmentEdit.listUpdated,
      `預填 ${ui.assignmentEdit.prefilled ? '正確' : '錯誤'}、列表更新 ${ui.assignmentEdit.listUpdated ? '是' : '否'}`
    )
    add(
      'UI 編輯作業不改 rubric/rules',
      ui.assignmentEdit.rubricJson === JSON.stringify(uiAssignment.rubric) &&
        ui.assignmentEdit.rulesJson === JSON.stringify(uiAssignment.rules),
      `量規 ${uiAssignment.rubric.id} 不變`
    )
    add(
      'UI 刪除作業後該列消失',
      ui.assignmentDelete.ok && ui.assignmentDelete.remaining === 1,
      `剩 ${ui.assignmentDelete.rows} 列、其他作業 ${ui.assignmentDelete.remaining} 份`
    )
    const uiClassGone = !(await pathExists(join(root, uiClassId)))
    add(
      'UI 刪除班級後資料夾與 state 清空',
      ui.classDelete.ok && ui.classDelete.classCount === 0 && uiClassGone,
      `state ${ui.classDelete.classCount} 班、資料夾${uiClassGone ? '消失' : '仍在'}`
    )
    const statusAfterUi = getImportStatus()
    add(
      'UI 刪除後 watcher 正常',
      statusAfterUi.watching === 0 && !statusAfterUi.events.some((event) => event.type === 'error'),
      `監看 ${statusAfterUi.watching}、錯誤事件 ${statusAfterUi.events.filter((event) => event.type === 'error').length}`
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

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[crud] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
