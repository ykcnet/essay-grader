import { contextBridge, ipcRenderer } from 'electron'

type ImportEventListener = (event: unknown) => void

const importListeners = new Map<number, ImportEventListener>()
let nextListenerId = 1

ipcRenderer.on('import:event', (_event, payload) => {
  for (const listener of importListeners.values()) listener(payload)
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
  assignment: {
    audit: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('assignment:audit', classId, assignmentId)
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
    reveal: (path: string) => ipcRenderer.invoke('feedback:reveal', path)
  },
  library: {
    get: () => ipcRenderer.invoke('library:get')
  },
  imports: {
    status: () => ipcRenderer.invoke('import:status'),
    refresh: () => ipcRenderer.invoke('import:refresh'),
    openInbox: (classId: string, assignmentId: string) =>
      ipcRenderer.invoke('import:open-inbox', classId, assignmentId),
    simulate: (classId: string, assignmentId: string, count = 10) =>
      ipcRenderer.invoke('import:simulate', classId, assignmentId, count),
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
  }
} as const

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
