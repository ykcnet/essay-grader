import { contextBridge, ipcRenderer } from 'electron'

type ImportEventListener = (event: unknown) => void

const importListeners = new Map<number, ImportEventListener>()
let nextListenerId = 1

ipcRenderer.on('import:event', (_event, payload) => {
  for (const listener of importListeners.values()) listener(payload)
})

const batchListeners = new Map<number, ImportEventListener>()

ipcRenderer.on('feedback:batch-progress', (_event, payload) => {
  for (const listener of batchListeners.values()) listener(payload)
})

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  spike: {
    loadPage: () => ipcRenderer.invoke('spike:load-page'),
    loadMarkers: () => ipcRenderer.invoke('spike:load-markers'),
    saveMarkers: (markers: unknown) => ipcRenderer.invoke('spike:save-markers', markers),
    exportPdf: () => ipcRenderer.invoke('spike:export-pdf'),
    runWatcher: () => ipcRenderer.invoke('spike:run-watcher'),
    memory: () => ipcRenderer.invoke('spike:memory'),
    openWindow: () => ipcRenderer.invoke('spike:open-window'),
    openOut: () => ipcRenderer.invoke('spike:open-out')
  },
  db: {
    state: () => ipcRenderer.invoke('db:state'),
    open: () => ipcRenderer.invoke('db:open'),
    openPath: (path: string) => ipcRenderer.invoke('db:open-path', path),
    close: () => ipcRenderer.invoke('db:close'),
    reveal: () => ipcRenderer.invoke('db:reveal'),
    listClasses: () => ipcRenderer.invoke('class:list'),
    createClass: (input: unknown) => ipcRenderer.invoke('class:create', input),
    loadClass: (id: string) => ipcRenderer.invoke('class:load', id),
    saveClass: (input: unknown) => ipcRenderer.invoke('class:save', input),
    listAssignments: (classId: string) => ipcRenderer.invoke('assignment:list', classId),
    createAssignment: (input: unknown) => ipcRenderer.invoke('assignment:create', input),
    loadAssignment: (classId: string, id: string) =>
      ipcRenderer.invoke('assignment:load', classId, id),
    updateRubric: (classId: string, assignmentId: string, rubric: unknown) =>
      ipcRenderer.invoke('assignment:update-rubric', classId, assignmentId, rubric)
  },
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    restore: () => ipcRenderer.invoke('backup:restore')
  },
  logs: {
    open: () => ipcRenderer.invoke('logs:open'),
    path: () => ipcRenderer.invoke('logs:path'),
    write: (level: 'info' | 'warn' | 'error', message: string) =>
      ipcRenderer.invoke('logs:write', level, message)
  },
  assignment: {
    audit: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('assignment:audit', classId, assignmentId)
  },
  stats: {
    get: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('stats:get', classId, assignmentId),
    compare: (classId: string, currentId: string, previousId: string) =>
      ipcRenderer.invoke('stats:compare', classId, currentId, previousId),
    exportCsv: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('stats:export', classId, assignmentId),
    reveal: (dir: string) => ipcRenderer.invoke('stats:reveal', dir)
  },
  work: {
    list: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('work:list', classId, assignmentId),
    get: (classId: string, assignmentId: string, seat: string) =>
      ipcRenderer.invoke('work:get', classId, assignmentId, seat),
    save: (classId: string, assignmentId: string, seat: string, work: unknown) =>
      ipcRenderer.invoke('work:save', classId, assignmentId, seat, work),
    page: (classId: string, assignmentId: string, seat: string, pageId: string) =>
      ipcRenderer.invoke('work:page', classId, assignmentId, seat, pageId),
    reuse: (classId: string, assignmentId: string, seat: string, text: string) =>
      ipcRenderer.invoke('work:reuse', classId, assignmentId, seat, text)
  },
  feedback: {
    load: (classId: string, assignmentId: string, seat: string) =>
      ipcRenderer.invoke('feedback:load', classId, assignmentId, seat),
    open: (classId: string, assignmentId: string, seat: string) =>
      ipcRenderer.invoke('feedback:open', classId, assignmentId, seat),
    exportPdf: (classId: string, assignmentId: string, seat: string) =>
      ipcRenderer.invoke('feedback:export', classId, assignmentId, seat),
    saveAs: (classId: string, assignmentId: string, seat: string) =>
      ipcRenderer.invoke('feedback:save-as', classId, assignmentId, seat),
    print: () => ipcRenderer.invoke('feedback:print'),
    reveal: (path: string) => ipcRenderer.invoke('feedback:reveal', path),
    batchInfo: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('feedback:batch-info', classId, assignmentId),
    batchStart: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('feedback:batch-start', classId, assignmentId),
    batchCancel: (jobId: string) => ipcRenderer.invoke('feedback:batch-cancel', jobId),
    batchReveal: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('feedback:batch-reveal', classId, assignmentId),
    onBatchProgress: (listener: ImportEventListener) => {
      const id = nextListenerId++
      batchListeners.set(id, listener)
      return id
    },
    offBatchProgress: (id: number) => {
      batchListeners.delete(id)
    }
  },
  library: {
    get: (classId?: string) => ipcRenderer.invoke('library:get', classId),
    setMode: (mode: string) => ipcRenderer.invoke('library:set-mode', mode),
    usage: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('library:usage', classId, assignmentId),
    getPrefs: () => ipcRenderer.invoke('library:get-prefs'),
    setPrefs: (patch: { sort?: string; pins?: string[]; cooldownDays?: number }) =>
      ipcRenderer.invoke('library:set-prefs', patch)
  },
  imports: {
    status: () => ipcRenderer.invoke('import:status'),
    refresh: () => ipcRenderer.invoke('import:refresh'),
    openInbox: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('import:open-inbox', classId, assignmentId),
    simulate: (classId: string, assignmentId: string, count = 10) =>
      ipcRenderer.invoke('import:simulate', classId, assignmentId, count),
    chooseDriveRoot: () => ipcRenderer.invoke('import:drive-choose'),
    clearDriveRoot: () => ipcRenderer.invoke('import:drive-clear'),
    openDriveRoot: () => ipcRenderer.invoke('import:drive-open'),
    ensureDriveFolder: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('import:drive-ensure-folder', classId, assignmentId),
    listUnmatched: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('import:unmatched-list', classId, assignmentId),
    unmatchedThumbnail: (classId: string, assignmentId: string, path: string) =>
      ipcRenderer.invoke('import:unmatched-thumbnail', classId, assignmentId, path),
    assignUnmatched: (
      classId: string,
      assignmentId: string,
      seat: string,
      paths: string[]
    ) => ipcRenderer.invoke('import:unmatched-assign', classId, assignmentId, seat, paths),
    onEvent: (listener: ImportEventListener) => {
      const id = nextListenerId++
      importListeners.set(id, listener)
      return id
    },
    offEvent: (id: number) => {
      importListeners.delete(id)
    }
  },
  roster: {
    importExcel: (classId: string) => ipcRenderer.invoke('roster:import-excel', classId)
  },
  gradebook: {
    getConfig: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('gradebook:get-config', classId, assignmentId),
    chooseFile: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('gradebook:choose-file', classId, assignmentId),
    inspect: (path: string, sheet?: string) =>
      ipcRenderer.invoke('gradebook:inspect', path, sheet),
    saveConfig: (classId: string, assignmentId: string, gradebook: unknown) =>
      ipcRenderer.invoke('gradebook:save-config', classId, assignmentId, gradebook),
    write: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('gradebook:write', classId, assignmentId),
    exportCsv: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('gradebook:export-csv', classId, assignmentId),
    reveal: (path: string) => ipcRenderer.invoke('gradebook:reveal', path)
  }
} as const

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
