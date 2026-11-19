import { dialog, ipcMain, shell } from 'electron'
import {
  BUILTIN_LIBRARY,
  type ClassFile,
  type CreateAssignmentInput,
  type CreateClassInput,
  type Rubric,
  type WorkFile
} from '@essay-grader/core'
import {
  ensureInbox,
  getImportStatus,
  refreshImportWatcher,
  simulateImport
} from '../import/watcher'
import { importRosterViaDialog } from '../import/roster-excel'
import {
  closeDatabase,
  countFinalReuse,
  createAssignment,
  createClass,
  auditAssignment,
  exportAssignmentStats,
  getAssignmentStats,
  getState,
  listAssignments,
  listWorks,
  loadAssignment,
  loadClass,
  loadWork,
  openDatabase,
  readWorkPage,
  revealDatabase,
  saveClass,
  saveWork,
  updateAssignmentRubric
} from './repository'

export function registerDataIpc(): void {
  ipcMain.handle('db:state', () => getState())

  ipcMain.handle('db:open', async () => {
    const result = await dialog.showOpenDialog({
      title: '選擇或建立資料庫資料夾',
      buttonLabel: '開啟',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return getState()
    return openDatabase(result.filePaths[0])
  })

  ipcMain.handle('db:open-path', (_event, path: string) => openDatabase(path))

  ipcMain.handle('db:close', async () => {
    await closeDatabase()
    return getState()
  })

  ipcMain.handle('db:reveal', () => revealDatabase())

  ipcMain.handle('class:create', (_event, input: CreateClassInput) => createClass(input))
  ipcMain.handle('class:load', (_event, id: string) => loadClass(id))
  ipcMain.handle('class:save', (_event, input: ClassFile) => saveClass(input))
  ipcMain.handle('assignment:list', (_event, classId: string) => listAssignments(classId))
  ipcMain.handle('assignment:create', (_event, input: CreateAssignmentInput) =>
    createAssignment(input)
  )
  ipcMain.handle('assignment:load', (_event, classId: string, id: string) =>
    loadAssignment(classId, id)
  )
  ipcMain.handle('assignment:audit', (_event, classId: string, assignmentId: string) =>
    auditAssignment(classId, assignmentId)
  )

  ipcMain.handle('stats:get', (_event, classId: string, assignmentId: string) =>
    getAssignmentStats(classId, assignmentId)
  )

  ipcMain.handle('stats:export', (_event, classId: string, assignmentId: string) =>
    exportAssignmentStats(classId, assignmentId)
  )

  ipcMain.handle('stats:reveal', async (_event, dir: string) => {
    await shell.openPath(dir)
    return { opened: true }
  })
  ipcMain.handle(
    'assignment:update-rubric',
    (_event, classId: string, assignmentId: string, rubric: Rubric) =>
      updateAssignmentRubric(classId, assignmentId, rubric)
  )

  ipcMain.handle('work:list', (_event, classId: string, assignmentId: string) =>
    listWorks(classId, assignmentId)
  )

  ipcMain.handle('library:get', () => BUILTIN_LIBRARY)

  ipcMain.handle('work:get', (_event, classId: string, assignmentId: string, seat: string) =>
    loadWork(classId, assignmentId, seat)
  )

  ipcMain.handle(
    'work:save',
    (_event, classId: string, assignmentId: string, seat: string, work: WorkFile) =>
      saveWork(classId, assignmentId, seat, work)
  )

  ipcMain.handle(
    'work:page',
    (_event, classId: string, assignmentId: string, seat: string, pageId: string) =>
      readWorkPage(classId, assignmentId, seat, pageId)
  )

  ipcMain.handle(
    'work:reuse',
    (_event, classId: string, assignmentId: string, seat: string, text: string) =>
      countFinalReuse(classId, assignmentId, seat, text)
  )

  ipcMain.handle('import:status', () => getImportStatus())

  ipcMain.handle('import:refresh', async () => {
    await refreshImportWatcher()
    return getImportStatus()
  })

  ipcMain.handle('import:open-inbox', async (_event, classId: string, assignmentId: string) => {
    const dir = await ensureInbox(classId, assignmentId)
    await shell.openPath(dir)
    return { dir }
  })

  ipcMain.handle(
    'import:simulate',
    (_event, classId: string, assignmentId: string, count: number) =>
      simulateImport(classId, assignmentId, count)
  )

  ipcMain.handle('roster:import-excel', (_event, classId: string) =>
    importRosterViaDialog(classId)
  )
}
