import { app, dialog, ipcMain, shell } from 'electron'
import { join, resolve, sep } from 'node:path'
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
  currentRoot,
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
import { backupFileName, createBackupZip, restoreBackupZip } from './backup'
import { log, logDirectory, logError, logInfo, openLogsFolder } from '../logger'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

  ipcMain.handle('backup:create', async () => {
    const root = currentRoot()
    if (!root) throw new Error('請先開啟資料庫，再建立備份。')

    const result = await dialog.showSaveDialog({
      title: '備份資料庫',
      buttonLabel: '儲存備份',
      defaultPath: join(app.getPath('documents'), backupFileName()),
      filters: [{ name: 'Zip 備份', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }

    const target = result.filePath.toLowerCase().endsWith('.zip')
      ? result.filePath
      : `${result.filePath}.zip`

    try {
      const backup = await createBackupZip(root, target)
      logInfo(`備份完成：files=${backup.files} bytes=${backup.bytes}`)
      return { canceled: false, ...backup }
    } catch (error) {
      logError(`備份失敗：${message(error)}`)
      throw new Error(`備份失敗：${message(error)}`)
    }
  })

  ipcMain.handle('backup:restore', async () => {
    const current = currentRoot()

    const zipPick = await dialog.showOpenDialog({
      title: '選擇要還原的備份',
      buttonLabel: '選擇備份',
      properties: ['openFile'],
      filters: [{ name: 'Zip 備份', extensions: ['zip'] }]
    })
    if (zipPick.canceled || !zipPick.filePaths[0]) return { canceled: true }

    const folderPick = await dialog.showOpenDialog({
      title: '選擇新的資料夾（不能是目前資料庫）',
      buttonLabel: '還原到這裡',
      properties: ['openDirectory', 'createDirectory']
    })
    if (folderPick.canceled || !folderPick.filePaths[0]) return { canceled: true }

    const destination = resolve(folderPick.filePaths[0])
    if (current) {
      const root = resolve(current)
      if (
        destination === root ||
        destination.startsWith(`${root}${sep}`) ||
        root.startsWith(`${destination}${sep}`)
      ) {
        throw new Error('不可還原到目前開啟的資料庫或它的上層資料夾，請選擇新的資料夾。')
      }
    }

    try {
      const restored = await restoreBackupZip(zipPick.filePaths[0], destination)
      const state = await openDatabase(restored.root)
      logInfo(`還原完成：files=${restored.files} bytes=${restored.bytes}`)
      return { canceled: false, ...restored, state }
    } catch (error) {
      logError(`還原失敗：${message(error)}`)
      throw new Error(`還原失敗：${message(error)}`)
    }
  })

  ipcMain.handle('logs:open', async () => ({ path: await openLogsFolder() }))
  ipcMain.handle('logs:path', () => logDirectory())
  ipcMain.handle('logs:write', (_event, level: string, text: string) => {
    const safeLevel = level === 'warn' || level === 'error' ? level : 'info'
    log(safeLevel, `renderer：${String(text).slice(0, 1000)}`)
    return { ok: true }
  })

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
