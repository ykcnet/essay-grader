import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  applyLibraryDisabled,
  isLibraryId,
  isLibraryMode,
  libraryForGrade,
  mergeLibraryLayers,
  normalizeCustomTags,
  normalizeLibraryMode,
  validateCustomLibraryEntry,
  type AnnotationCategory,
  type ClassFile,
  type CreateAssignmentInput,
  type CreateClassInput,
  type LibraryEntry,
  type LibraryId,
  type LibraryMode,
  type Rubric,
  type UpdateAssignmentInput,
  type WorkFile
} from '@essay-grader/core'
import { randomUUID } from 'node:crypto'
import { writePhoneManifest } from '../import/manifest'
import {
  ensureInbox,
  getImportStatus,
  refreshImportWatcher,
  simulateImport
} from '../import/watcher'
import {
  ensureExternalAssignmentFolder,
  getExternalStatus,
  startExternalWatcher,
  stopExternalWatcher
} from '../import/external'
import { importRosterViaDialog } from '../import/roster-excel'
import {
  assignUnmatched,
  getUnmatchedThumbnail,
  listUnmatched
} from '../import/unmatched'
import {
  clearExternalInboxRoot,
  readLibraryDisabled,
  readLibraryPrefs,
  readSettings,
  writeLibraryDisabled,
  writeLibraryPrefs,
  writeSettings
} from './settings'
import {
  closeDatabase,
  countFinalReuse,
  createAssignment,
  createClass,
  currentRoot,
  auditAssignment,
  compareAssignments,
  deleteAssignment,
  deleteClass,
  exportAssignmentStats,
  getAssignmentStats,
  getLibraryUsage,
  getPraiseBank,
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
  updateAssignment,
  updateAssignmentRubric
} from './repository'
import { backupFileName, createBackupZip, restoreBackupZip } from './backup'
import {
  readCustomEntries,
  readLibraryAdditions,
  writeCustomEntries,
  type LibraryAdditions
} from './library-custom'
import { importLibraryFile } from './library-import'
import {
  chooseGradebook,
  inspectGradebook,
  loadGradebookConfig,
  revealGradebook,
  saveGradebookConfig,
  writeGradebook,
  writeGradebookCsv
} from './gradebook'
import { log, logDirectory, logError, logInfo, logWarn, openLogsFolder } from '../logger'

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
  ipcMain.handle('class:delete', (_event, id: string) => deleteClass(id))
  ipcMain.handle('assignment:list', (_event, classId: string) => listAssignments(classId))
  ipcMain.handle('assignment:create', (_event, input: CreateAssignmentInput) =>
    createAssignment(input)
  )
  ipcMain.handle('assignment:load', (_event, classId: string, id: string) =>
    loadAssignment(classId, id)
  )
  ipcMain.handle(
    'assignment:update',
    (_event, classId: string, assignmentId: string, input: UpdateAssignmentInput) =>
      updateAssignment(classId, assignmentId, input)
  )
  ipcMain.handle('assignment:delete', (_event, classId: string, assignmentId: string) =>
    deleteAssignment(classId, assignmentId)
  )
  ipcMain.handle('assignment:audit', (_event, classId: string, assignmentId: string) =>
    auditAssignment(classId, assignmentId)
  )

  ipcMain.handle('stats:get', (_event, classId: string, assignmentId: string) =>
    getAssignmentStats(classId, assignmentId)
  )

  ipcMain.handle(
    'stats:compare',
    (_event, classId: string, currentId: string, previousId: string) =>
      compareAssignments(classId, currentId, previousId)
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

  /**
   * 回傳目前適用的評語庫 payload。
   * 給 classId 時讀 class.json 的 grade；未給時以 auto 的高中職版或手動模式為準。
   * 套用該版本的停用清單到 entries，但仍保留停用條目供 UI 管理與重新啟用。
   */
  ipcMain.handle('library:get', async (_event, classId?: string) => {
    const settings = await readSettings()
    const mode = normalizeLibraryMode(settings.libraryMode)
    let grade: ClassFile['grade'] | undefined

    if (classId) {
      try {
        grade = (await loadClass(classId)).data.grade
      } catch (error) {
        logError(`讀取班級學制失敗（library:get）：${message(error)}`)
      }
    }

    const payload = libraryForGrade(grade, mode)

    // 合併自訂與匯入條目；讀取失敗只警告，不讓整個評語庫載入失敗。
    let additions: LibraryAdditions = { custom: [], imported: [] }
    try {
      additions = await readLibraryAdditions(payload.id)
    } catch (error) {
      logWarn(`[library] 評語庫擴充條目讀取失敗（${payload.id}）：${message(error)}`)
    }
    const merged = mergeLibraryLayers(
      payload.library.entries,
      additions.imported,
      additions.custom
    )
    if (merged.duplicateIds.length > 0) {
      logWarn(
        `[library] 評語庫 id 重複略過（${payload.id}）：${merged.duplicateIds.join('、')}`
      )
    }
    const libraryVersion =
      additions.imported.length > 0 && additions.importedVersion
        ? additions.importedVersion
        : payload.library.library_version
    const mergedPayload: typeof payload = {
      ...payload,
      library: {
        ...payload.library,
        entries: merged.entries,
        library_version: libraryVersion
      }
    }
    return applyLibraryDisabled(mergedPayload, settings.libraryDisabled?.[mergedPayload.id] ?? [])
  })

  ipcMain.handle('library:set-mode', async (_event, mode: LibraryMode) => {
    if (!isLibraryMode(mode)) throw new Error('評語庫版本不合法，請選擇自動、國中版或高中職版。')
    await writeSettings({ libraryMode: mode })
    return { mode }
  })

  ipcMain.handle(
    'library:set-disabled',
    async (_event, libraryId: LibraryId, entryId: string, disabled: boolean) => {
      if (!isLibraryId(libraryId)) throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
      if (typeof entryId !== 'string' || entryId.length === 0) {
        throw new Error('評語 id 不合法。')
      }
      if (typeof disabled !== 'boolean') throw new Error('停用狀態不合法。')

      const base = libraryForGrade(undefined, libraryId).library
      const additions = await readLibraryAdditions(libraryId)
      if (
        !base.entries.some((entry) => entry.id === entryId) &&
        !additions.imported.some((entry) => entry.id === entryId) &&
        !additions.custom.some((entry) => entry.id === entryId)
      ) {
        throw new Error('找不到該評語，可能已更新版本。')
      }

      const current = await readLibraryDisabled(libraryId)
      const next = disabled
        ? Array.from(new Set([...current, entryId]))
        : current.filter((id) => id !== entryId)
      const disabledIds = await writeLibraryDisabled(libraryId, next)
      return { libraryId, disabledIds }
    }
  )

  ipcMain.handle(
    'library:save-custom',
    async (
      _event,
      input: {
        libraryId: unknown
        id?: unknown
        category: unknown
        subtype?: unknown
        text: unknown
        tags?: unknown
      }
    ) => {
      if (!isLibraryId(input?.libraryId)) {
        throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
      }
      const libraryId = input.libraryId

      const base = libraryForGrade(undefined, libraryId).library
      const existing = await readCustomEntries(libraryId)

      const selfId = typeof input.id === 'string' && input.id.length > 0 ? input.id : undefined
      if (selfId && base.entries.some((entry) => entry.id === selfId)) {
        throw new Error('內建評語不可修改，請改用停用。')
      }
      const errors = validateCustomLibraryEntry(input, [...base.entries, ...existing], selfId)
      if (errors.length > 0) {
        throw new Error(errors.join('；'))
      }

      const category = input.category as AnnotationCategory
      const subtype =
        category === 'typo' || category === 'praise' || category === 'other'
          ? 'general'
          : String(input.subtype ?? '').trim()
      const text = String(input.text ?? '').trim()
      const tags = normalizeCustomTags(input.tags)

      let next: LibraryEntry[]
      let entry: LibraryEntry

      if (selfId) {
        const index = existing.findIndex((item) => item.id === selfId)
        if (index < 0 || existing[index].source !== 'custom') {
          throw new Error('找不到該自訂評語。')
        }
        entry = {
          ...existing[index],
          category,
          subtype,
          text,
          tags
        }
        next = existing.map((item, i) => (i === index ? entry : item))
      } else {
        entry = {
          id: `CUSTOM-${randomUUID()}`,
          category,
          subtype,
          text,
          tags,
          disabled: false,
          source: 'custom'
        }
        next = [...existing, entry]
      }

      await writeCustomEntries(libraryId, next)
      return { entry }
    }
  )

  ipcMain.handle(
    'library:delete-custom',
    async (_event, input: { libraryId: unknown; id: unknown }) => {
      if (!isLibraryId(input?.libraryId)) {
        throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
      }
      const libraryId = input.libraryId
      const id = typeof input.id === 'string' ? input.id : ''
      if (!id) throw new Error('評語 id 不合法。')

      const existing = await readCustomEntries(libraryId)
      const index = existing.findIndex((item) => item.id === id)
      if (index >= 0) {
        if (existing[index].source !== 'custom') {
          throw new Error('內建評語不可刪除，請改用停用。')
        }
        await writeCustomEntries(libraryId, existing.filter((item) => item.id !== id))
        return { deleted: true }
      }

      const base = libraryForGrade(undefined, libraryId).library
      if (base.entries.some((item) => item.id === id)) {
        throw new Error('內建評語不可刪除，請改用停用。')
      }
      throw new Error('找不到該評語。')
    }
  )

  ipcMain.handle('library:import', async (_event, libraryId: LibraryId) => {
    if (!isLibraryId(libraryId)) {
      throw new Error('評語庫版本不合法，請選擇國中版或高中職版。')
    }
    const result = await dialog.showOpenDialog({
      title: '匯入新版評語庫',
      buttonLabel: '匯入',
      properties: ['openFile'],
      filters: [{ name: '評語庫 JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const report = await importLibraryFile(libraryId, result.filePaths[0])
    return { canceled: false, ...report }
  })

  ipcMain.handle('library:usage', (_event, classId: string, assignmentId: string) =>
    getLibraryUsage(classId, assignmentId)
  )

  ipcMain.handle('library:get-prefs', () => readLibraryPrefs())

  ipcMain.handle('praise:bank', (_event, classId?: string) => getPraiseBank(classId))

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return { ok: true }
  })

  ipcMain.handle(
    'library:set-prefs',
    (_event, patch: { sort?: unknown; pins?: unknown; cooldownDays?: unknown }) =>
      writeLibraryPrefs(patch ?? {})
  )

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

  ipcMain.handle('import:unmatched-list', (_event, classId: string, assignmentId: string) =>
    listUnmatched(classId, assignmentId)
  )

  ipcMain.handle(
    'import:unmatched-thumbnail',
    (_event, classId: string, assignmentId: string, path: string) =>
      getUnmatchedThumbnail(classId, assignmentId, path)
  )

  ipcMain.handle(
    'import:unmatched-assign',
    (
      _event,
      classId: string,
      assignmentId: string,
      seat: string,
      paths: string[]
    ) => assignUnmatched({ classId, assignmentId, seat, paths })
  )

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

  ipcMain.handle('import:drive-choose', async () => {
    const result = await dialog.showOpenDialog({
      title: '選擇 Google Drive 本機同步資料夾',
      buttonLabel: '使用此資料夾',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, status: getImportStatus() }
    }

    const chosen = resolve(result.filePaths[0])
    await writeSettings({ externalInboxRoot: chosen })
    await startExternalWatcher(chosen, currentRoot())
    return { canceled: false, root: chosen, status: getImportStatus() }
  })

  ipcMain.handle('import:drive-clear', async () => {
    await clearExternalInboxRoot()
    await stopExternalWatcher()
    return getImportStatus()
  })

  ipcMain.handle('import:drive-open', async () => {
    const { externalInboxRoot } = await readSettings()
    if (!externalInboxRoot) throw new Error('尚未設定 Google Drive inbox。')

    try {
      const info = await stat(externalInboxRoot)
      if (!info.isDirectory()) throw new Error('not a directory')
    } catch {
      throw new Error('Google Drive inbox 資料夾不存在，請重新設定。')
    }

    await shell.openPath(externalInboxRoot)
    return { dir: externalInboxRoot }
  })

  ipcMain.handle(
    'import:drive-ensure-folder',
    async (_event, classId: string, assignmentId: string) => {
      const dir = await ensureExternalAssignmentFolder(classId, assignmentId)
      if (!getExternalStatus().watching) {
        const settings = await readSettings()
        await startExternalWatcher(settings.externalInboxRoot ?? null, currentRoot())
      }
      return { dir }
    }
  )

  ipcMain.handle('import:write-manifest', (_event, classId: string) =>
    writePhoneManifest(classId)
  )

  ipcMain.handle('roster:import-excel', (_event, classId: string) =>
    importRosterViaDialog(classId)
  )

  ipcMain.handle('gradebook:get-config', (_event, classId: string, assignmentId: string) =>
    loadGradebookConfig(classId, assignmentId)
  )
  ipcMain.handle('gradebook:choose-file', (_event, classId: string, assignmentId: string) =>
    chooseGradebook(classId, assignmentId)
  )
  ipcMain.handle('gradebook:inspect', (_event, path: string, sheet?: string) =>
    inspectGradebook(path, sheet)
  )
  ipcMain.handle(
    'gradebook:save-config',
    (
      _event,
      classId: string,
      assignmentId: string,
      gradebook: Parameters<typeof saveGradebookConfig>[2]
    ) => saveGradebookConfig(classId, assignmentId, gradebook)
  )
  ipcMain.handle(
    'gradebook:write',
    (
      _event,
      classId: string,
      assignmentId: string,
      options?: { sourcePath?: string; outputPath?: string }
    ) => writeGradebook({ classId, assignmentId, ...options })
  )
  ipcMain.handle('gradebook:export-csv', (_event, classId: string, assignmentId: string) =>
    writeGradebookCsv(classId, assignmentId)
  )
  ipcMain.handle('gradebook:reveal', (_event, path: string) => revealGradebook(path))
}
