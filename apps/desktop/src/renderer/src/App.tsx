import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import {
  AUDIT_ISSUE_LABELS,
  RUBRIC_PRESET_LABELS,
  RUBRIC_PRESET_ORDER,
  RUBRIC_PRESETS,
  type AssignmentAudit,
  type AssignmentStats,
  type AssignmentSummary,
  type ClassFile,
  type CreateAssignmentInput,
  type CreateClassInput,
  type DatabaseState,
  type ImportEvent,
  type ImportStatus,
  type RubricPresetBaseId,
  type Student,
  type WorkSummary
} from '@essay-grader/core'
import ReviewView from './review/ReviewView'

type Grade = 'junior' | 'senior' | 'vocational'
type Toast = { kind: 'ok' | 'error' | 'info'; text: string }
type AuditFilter = 'problems' | 'all'

type GradebookDraft = {
  path: string
  sheet: string
  header_row: number
  seat_column: string
  name_column: string
  score_column: string
  grade_column: string
  seat_format: string
}

type GradebookInspection = {
  path?: string
  sheets: Array<{ name: string; rowCount: number; columnCount: number }>
  sheet: string | null
  preview: string[][]
  detection: {
    headerRow: number
    seatColumn: string
    nameColumn?: string
    scoreColumn: string
    gradeColumn?: string
    seatFormat: string
  } | null
  exportOnly: boolean
  exportReason?: string
  warning?: string
}

type UnmatchedPhoto = {
  path: string
  name: string
  originalName: string
  source: 'inbox' | 'drive'
  reason: string
  classId?: string
  assignmentId?: string
  seat?: string
  modifiedAt: string
  size: number
  hasMeta: boolean
}

type UnmatchedListing = {
  photos: UnmatchedPhoto[]
  internalDir: string
  externalDir: string | null
}

type UnmatchedAssignmentResult = {
  queued: number
  failed: Array<{ path: string; reason: string }>
  inbox: string
}

type BatchFeedbackStatus = 'exported' | 'skipped' | 'failed' | 'cancelled'

type BatchFeedbackItem = {
  seat: string
  name: string
  status: BatchFeedbackStatus
  fileName: string
  path: string
  reason: string
  ms: number
}

type BatchFeedbackReport = {
  jobId: string
  generatedAt: string
  total: number
  exported: number
  skipped: number
  failed: number
  cancelled: number
  elapsedMs: number
  outputDir: string
  items: BatchFeedbackItem[]
}

type BatchFeedbackInfo = {
  outputDir: string
  exportable: number
  unfinished: number
  total: number
}

type BatchFeedbackProgress = {
  jobId: string
  classId: string
  assignmentId: string
  index: number
  total: number
  seat: string
  name: string
  status: BatchFeedbackStatus
  message: string
  completed: number
}

type GradebookReport = {
  ok: boolean
  mode: 'copy' | 'export'
  sourcePath: string
  outputPath: string | null
  csvPath: string | null
  sheet: string
  headerRow: number
  written: number
  verified: boolean
  changes: Array<{
    seat: string
    name: string
    row: number
    scoreBefore: number | null
    scoreAfter: number
    gradeBefore: string | null
    gradeAfter: string | null
  }>
  unmatched: Array<{ seat: string; name: string; reason: string }>
  incomplete: Array<{ seat: string; name: string; status: string; reason: string }>
  duplicates: Array<{ seat: string; rows: number[] }>
  warnings: string[]
  verification: {
    rowCountBefore: number
    rowCountAfter: number
    checked: number
    unchangedSeatAndName: boolean
    failures: string[]
  } | null
  error?: string
  elapsedMs: number
}


const GRADE_LABELS: Record<Grade, string> = {
  junior: '國中',
  senior: '高中',
  vocational: '高職'
}

const STATUS_LABELS: Record<WorkSummary['status'], string> = {
  pending: '待批',
  grading: '批閱中',
  done: '已批'
}

const BATCH_STATUS_LABELS: Record<BatchFeedbackStatus, string> = {
  exported: '已輸出',
  skipped: '跳過',
  failed: '失敗',
  cancelled: '已取消'
}

const padSeat = (value: string): string => value.replace(/\D/g, '').padStart(2, '0').slice(-2)

/** 作業列表用量規名稱，例如「內容 45／結構 25／語言 30」。 */
const SHORT_ITEM_NAMES: Record<string, string> = {
  content: '內容',
  structure: '結構',
  language: '語言'
}

const rubricSummary = (preset: RubricPresetBaseId): string =>
  RUBRIC_PRESETS[preset].items
    .map((item) => `${SHORT_ITEM_NAMES[item.id] ?? item.name} ${item.max}`)
    .join('／')

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function App(): JSX.Element {
  const [state, setState] = useState<DatabaseState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [classFile, setClassFile] = useState<ClassFile | null>(null)
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [showClassForm, setShowClassForm] = useState(false)
  const [showAssignmentForm, setShowAssignmentForm] = useState(false)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null)
  const [works, setWorks] = useState<WorkSummary[]>([])
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null)
  const [reviewTarget, setReviewTarget] = useState<{
    classId: string
    assignmentId: string
    seat: string
  } | null>(null)
  const [audit, setAudit] = useState<AssignmentAudit | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('problems')
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditMs, setAuditMs] = useState<number | null>(null)
  const [auditRun, setAuditRun] = useState(0)
  const [stats, setStats] = useState<AssignmentStats | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [statsBusy, setStatsBusy] = useState(false)
  const [statsMs, setStatsMs] = useState<number | null>(null)
  const [statsRun, setStatsRun] = useState(0)
  const [statsExport, setStatsExport] = useState<{ dir: string; files: string[] } | null>(null)
  const [gradebookOpen, setGradebookOpen] = useState(false)

  const selectedIdRef = useRef<string | null>(null)
  const selectedAssignmentRef = useRef<string | null>(null)
  const auditSeqRef = useRef(0)
  const statsSeqRef = useRef(0)
  const statsOpenRef = useRef(false)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    selectedAssignmentRef.current = selectedAssignmentId
  }, [selectedAssignmentId])

  useEffect(() => {
    statsOpenRef.current = statsOpen
  }, [statsOpen])
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const openClass = useCallback(async (id: string) => {
    const result = (await window.electronAPI.db.loadClass(id)) as {
      data: ClassFile
      warning?: string
    }
    setSelectedId(id)
    setClassFile(result.data)
    setDirty(false)
    setSelectedAssignmentId(null)
    setWorks([])
    setAudit(null)
    setAuditOpen(false)
    setAuditMs(null)
    auditSeqRef.current += 1
    setStats(null)
    setStatsOpen(false)
    setStatsMs(null)
    setStatsExport(null)
    statsSeqRef.current += 1
    setGradebookOpen(false)
    setAssignments((await window.electronAPI.db.listAssignments(id)) as AssignmentSummary[])
    setImportStatus((await window.electronAPI.imports.status()) as ImportStatus)
    if (result.warning) setToast({ kind: 'info', text: result.warning })
  }, [])

  const refresh = useCallback(
    async (preferId?: string) => {
      const next = (await window.electronAPI.db.state()) as DatabaseState
      setState(next)
      const target = preferId ?? selectedIdRef.current
      if (target && next.classes.some((item) => item.id === target)) {
        await openClass(target)
      } else if (next.classes[0]) {
        await openClass(next.classes[0].id)
      } else {
        setSelectedId(null)
        setClassFile(null)
        setAssignments([])
        setDirty(false)
      }
    },
    [openClass]
  )

  useEffect(() => {
    refresh().catch((error: unknown) =>
      setToast({ kind: 'error', text: errorText(error) })
    )
  }, [refresh])

  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      setToast({ kind: 'error', text: `${label}：${errorText(error)}` })
    } finally {
      setBusy(false)
    }
  }

  const handleOpen = (): void => {
    void run('開啟資料庫', async () => {
      const next = (await window.electronAPI.db.open()) as DatabaseState
      setState(next)
      if (next.classes[0]) {
        await openClass(next.classes[0].id)
        setToast({ kind: 'ok', text: `已開啟，共 ${next.classes.length} 個班級` })
      } else {
        setSelectedId(null)
        setClassFile(null)
        setAssignments([])
        setToast({ kind: 'ok', text: '資料庫已開啟，尚無班級' })
      }
    })
  }

  const handleClose = (): void => {
    void run('關閉資料庫', async () => {
      const next = (await window.electronAPI.db.close()) as DatabaseState
      setState(next)
      setSelectedId(null)
      setClassFile(null)
      setAssignments([])
      setToast({ kind: 'ok', text: '資料庫已關閉，鎖已釋放' })
    })
  }

  const handleBackup = (): void => {
    void run('備份資料庫', async () => {
      const result = (await window.electronAPI.backup.create()) as {
        canceled: boolean
        path?: string
        files?: number
        bytes?: number
      }
      if (result.canceled) return
      const name = result.path?.split(/[\\/]/).pop() ?? '備份檔'
      setToast({
        kind: 'ok',
        text: `已備份 ${result.files ?? 0} 個檔案（${formatBytes(result.bytes ?? 0)}）：${name}`
      })
    })
  }

  const handleRestore = (): void => {
    void run('還原備份', async () => {
      const result = (await window.electronAPI.backup.restore()) as {
        canceled: boolean
        root?: string
        files?: number
        bytes?: number
        state?: DatabaseState
      }
      if (result.canceled) return
      if (result.state) setState(result.state)
      await refresh()
      setToast({
        kind: 'ok',
        text: `已還原 ${result.files ?? 0} 個檔案並開啟新資料庫`
      })
    })
  }

  const handleOpenLogs = (): void => {
    void run('開啟日誌', async () => {
      await window.electronAPI.logs.open()
      setToast({ kind: 'info', text: '已開啟日誌資料夾' })
    })
  }

  const handleCreateClass = (input: CreateClassInput): void => {
    void run('建立班級', async () => {
      const summary = (await window.electronAPI.db.createClass(input)) as {
        id: string
      }
      await refresh(summary.id)
      setShowClassForm(false)
      setToast({ kind: 'ok', text: `已建立 ${summary.id}` })
    })
  }

  const handleSaveRoster = (): void => {
    if (!classFile) return
    void run('儲存名單', async () => {
      await window.electronAPI.db.saveClass(classFile)
      setDirty(false)
      await refresh(classFile.id)
      setToast({ kind: 'ok', text: `已儲存 ${classFile.students.length} 位學生` })
    })
  }

  const handleCreateAssignment = (input: Omit<CreateAssignmentInput, 'classId'>): void => {
    if (!classFile) return
    void run('建立作業', async () => {
      const summary = (await window.electronAPI.db.createAssignment({
        ...input,
        classId: classFile.id
      })) as AssignmentSummary
      setAssignments(
        (await window.electronAPI.db.listAssignments(classFile.id)) as AssignmentSummary[]
      )
      setShowAssignmentForm(false)
      setToast({ kind: 'ok', text: `已建立作業 ${summary.id}` })
    })
  }

  const refreshWorks = useCallback(async (classId: string, assignmentId: string) => {
    setWorks((await window.electronAPI.work.list(classId, assignmentId)) as WorkSummary[])
  }, [])

  const runAudit = useCallback((): void => {
    if (!classFile || !selectedAssignmentId) return
    const classId = classFile.id
    const assignmentId = selectedAssignmentId
    const seq = ++auditSeqRef.current
    const started = performance.now()

    setAuditOpen(true)
    setAuditBusy(true)

    void window.electronAPI.assignment
      .audit(classId, assignmentId)
      .then((result) => {
        if (auditSeqRef.current !== seq) return
        setAudit(result as AssignmentAudit)
        setAuditMs(Math.round(performance.now() - started))
        setAuditRun((value) => value + 1)
      })
      .catch((error: unknown) => {
        if (auditSeqRef.current !== seq) return
        setToast({ kind: 'error', text: `批次檢查：${errorText(error)}` })
      })
      .finally(() => {
        if (auditSeqRef.current === seq) setAuditBusy(false)
      })
  }, [classFile, selectedAssignmentId])

  const runStats = useCallback((): void => {
    if (!classFile || !selectedAssignmentId) return
    const classId = classFile.id
    const assignmentId = selectedAssignmentId
    const seq = ++statsSeqRef.current
    const started = performance.now()

    setStatsOpen(true)
    setStatsBusy(true)
    setStatsExport(null)

    void window.electronAPI.stats
      .get(classId, assignmentId)
      .then((result) => {
        if (statsSeqRef.current !== seq) return
        setStats(result as AssignmentStats)
        setStatsMs(Math.round(performance.now() - started))
        setStatsRun((value) => value + 1)
      })
      .catch((error: unknown) => {
        if (statsSeqRef.current !== seq) return
        setToast({ kind: 'error', text: `統計：${errorText(error)}` })
      })
      .finally(() => {
        if (statsSeqRef.current === seq) setStatsBusy(false)
      })
  }, [classFile, selectedAssignmentId])

  const handleExportStats = (): void => {
    if (!classFile || !selectedAssignmentId) return
    void run('匯出統計 CSV', async () => {
      const result = (await window.electronAPI.stats.exportCsv(
        classFile.id,
        selectedAssignmentId
      )) as { dir: string; files: string[] }
      setStatsExport(result)
      setToast({
        kind: 'ok',
        text: `已匯出 ${result.files.length} 個 CSV：${result.dir}`
      })
    })
  }

  const handleRevealStats = (): void => {
    if (!statsExport) return
    void window.electronAPI.stats.reveal(statsExport.dir)
  }

  const handleSelectAssignment = (id: string): void => {
    auditSeqRef.current += 1
    statsSeqRef.current += 1
    setSelectedAssignmentId(id)
    setAuditOpen(false)
    setAudit(null)
    setAuditMs(null)
    setStatsOpen(false)
    setStats(null)
    setStatsMs(null)
    setStatsExport(null)
    setGradebookOpen(false)
    if (classFile) void refreshWorks(classFile.id, id)
  }

  const handleImportExcel = (): void => {
    if (!classFile) return
    void run('匯入 Excel', async () => {
      const result = (await window.electronAPI.roster.importExcel(classFile.id)) as {
        canceled: boolean
        added: number
        updated: number
        total: number
        warnings: string[]
      }
      if (result.canceled) return
      await refresh(classFile.id)
      setToast({
        kind: 'ok',
        text: `Excel 匯入 ${result.total} 筆：新增 ${result.added}、更新 ${result.updated}${
          result.warnings.length ? `（${result.warnings.length} 則警告）` : ''
        }`
      })
    })
  }

  const handleOpenInbox = (): void => {
    if (!classFile || !selectedAssignmentId) return
    void run('開啟 inbox', async () => {
      const result = (await window.electronAPI.imports.openInbox(
        classFile.id,
        selectedAssignmentId
      )) as { dir: string }
      setToast({ kind: 'info', text: `inbox：${result.dir}` })
    })
  }

  const handleOpenFeedback = (seat: string): void => {
    if (!classFile || !selectedAssignmentId) return
    void window.electronAPI.feedback
      .open(classFile.id, selectedAssignmentId, seat)
      .catch((error: unknown) =>
        setToast({ kind: 'error', text: `開啟回饋單：${errorText(error)}` })
      )
  }

  const handleSimulate = (): void => {
    if (!classFile || !selectedAssignmentId) return
    void run('模擬匯入', async () => {
      const result = (await window.electronAPI.imports.simulate(
        classFile.id,
        selectedAssignmentId,
        10
      )) as { written: number; dir: string }
      setImportStatus((await window.electronAPI.imports.status()) as ImportStatus)
      setToast({ kind: 'ok', text: `已寫入 ${result.written} 組測試檔，等待 watcher 匯入…` })
    })
  }

  const handleRefreshInbox = (): void => {
    void run('重新整理', async () => {
      setImportStatus((await window.electronAPI.imports.refresh()) as ImportStatus)
      if (classFile && selectedAssignmentId) {
        await refreshWorks(classFile.id, selectedAssignmentId)
      }
      setToast({ kind: 'ok', text: '已重新掃描 inbox 與 Google Drive inbox' })
    })
  }

  const handleChooseDriveRoot = (): void => {
    void run('設定 Google Drive inbox', async () => {
      const result = (await window.electronAPI.imports.chooseDriveRoot()) as {
        canceled: boolean
        root?: string
        status: ImportStatus
      }
      setImportStatus(result.status)
      if (!result.canceled) {
        setToast({ kind: 'ok', text: `已設定 Google Drive inbox：${result.root ?? ''}` })
      }
    })
  }

  const handleClearDriveRoot = (): void => {
    void run('清除 Google Drive inbox', async () => {
      setImportStatus((await window.electronAPI.imports.clearDriveRoot()) as ImportStatus)
      setToast({ kind: 'info', text: '已清除 Google Drive inbox 設定' })
    })
  }

  const handleEnsureDriveFolder = (): void => {
    if (!classFile || !selectedAssignmentId) return
    void run('建立作業資料夾', async () => {
      const result = (await window.electronAPI.imports.ensureDriveFolder(
        classFile.id,
        selectedAssignmentId
      )) as { dir: string }
      setImportStatus((await window.electronAPI.imports.status()) as ImportStatus)
      setToast({ kind: 'ok', text: `已建立：${result.dir}` })
    })
  }

  const handleOpenDriveRoot = (): void => {
    void run('開啟 Google Drive inbox', async () => {
      const result = (await window.electronAPI.imports.openDriveRoot()) as { dir: string }
      setToast({ kind: 'info', text: `Google Drive inbox：${result.dir}` })
    })
  }

  useEffect(() => {
    const listenerId = window.electronAPI.imports.onEvent((raw) => {
      const event = raw as ImportEvent
      setImportStatus((prev) =>
        prev ? { ...prev, events: [...prev.events, event].slice(-100) } : prev
      )
      if (event.type === 'watcher') {
        void window.electronAPI.imports
          .status()
          .then((status) => setImportStatus(status as ImportStatus))
      }
      if (
        event.classId &&
        event.assignmentId &&
        event.classId === selectedIdRef.current &&
        event.assignmentId === selectedAssignmentRef.current
      ) {
        void window.electronAPI.work
          .list(event.classId, event.assignmentId)
          .then((list) => setWorks(list as WorkSummary[]))
      }
    })
    return () => window.electronAPI.imports.offEvent(listenerId)
  }, [])

  const students = classFile?.students ?? []
  const selectedAssignment =
    assignments.find((item) => item.id === selectedAssignmentId) ?? null

  if (reviewTarget) {
    return (
      <>
        <ReviewView
          classId={reviewTarget.classId}
          assignmentId={reviewTarget.assignmentId}
          initialSeat={reviewTarget.seat}
          onExit={(message) => {
            setReviewTarget(null)
            if (message) setToast({ kind: 'info', text: message })
            if (classFile && selectedAssignmentId) {
              void refreshWorks(classFile.id, selectedAssignmentId)
              // 批次檢查或統計面板若開著，回到工作區時自動重跑。
              if (auditOpen) runAudit()
              if (statsOpenRef.current) runStats()
            }
          }}
        />
        {toast && <div className={`toast toast--${toast.kind}`}>{toast.text}</div>}
      </>
    )
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">作</span>
          <div>
            <h1>作文批閱</h1>
            <p className="brand-sub">M7＋Google Drive inbox</p>
          </div>
        </div>

        <div className="db-path" title={state?.root ?? ''}>
          {state?.root ? state.root : '尚未開啟資料庫'}
        </div>

        <div className="topbar-actions">
          {busy && <span className="busy">處理中…</span>}
          {state?.root ? (
            <>
              <button onClick={() => void window.electronAPI.db.reveal()}>開啟資料夾</button>
              <button className="ghost" onClick={handleBackup}>
                備份資料庫
              </button>
              <button className="ghost" onClick={handleRestore}>
                還原備份
              </button>
              <button className="ghost" onClick={handleClose}>
                關閉資料庫
              </button>
            </>
          ) : (
            <button className="primary" onClick={handleOpen}>
              開啟資料庫
            </button>
          )}
          <button className="ghost" onClick={handleOpenLogs}>
            開啟日誌
          </button>
          <button className="ghost" onClick={() => void window.electronAPI.spike.openWindow()}>
            Spike
          </button>
        </div>
      </header>

      {state === null ? (
        <div className="center">載入中…</div>
      ) : !state.root ? (
        <EmptyState onOpen={handleOpen} busy={busy} />
      ) : (
        <div className="layout">
          <aside className="sidebar">
            <div className="sidebar-head">
              <h2>班級</h2>
              <button className="small" onClick={() => setShowClassForm((v) => !v)}>
                {showClassForm ? '取消' : '新增'}
              </button>
            </div>

            {showClassForm && (
              <CreateClassForm
                busy={busy}
                onCancel={() => setShowClassForm(false)}
                onSubmit={handleCreateClass}
              />
            )}

            <ul className="class-list">
              {state.classes.length === 0 && <li className="muted">尚無班級</li>}
              {state.classes.map((item) => (
                <li key={item.id}>
                  <button
                    className={item.id === selectedId ? 'class-item active' : 'class-item'}
                    onClick={() => void openClass(item.id)}
                  >
                    <span className="class-name">{item.name}</span>
                    <span className="class-meta">
                      {item.id} · {item.studentCount} 人
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {state.warnings.length > 0 && (
              <div className="warnings">
                <h3>注意</h3>
                {state.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
          </aside>

          <main className="content">
            {classFile ? (
              <>
                <section className="class-head">
                  <div>
                    <h2>{classFile.name}</h2>
                    <p className="muted">
                      {classFile.id} · {GRADE_LABELS[classFile.grade as Grade]} · 學年度{' '}
                      {classFile.academic_year} 第 {classFile.semester} 學期
                      {classFile.teacher ? ` · ${classFile.teacher}` : ''}
                    </p>
                  </div>
                  <div className="stat-row">
                    <span>
                      <strong>{students.length}</strong> 學生
                    </span>
                    <span>
                      <strong>{assignments.length}</strong> 作業
                    </span>
                    {dirty && <span className="dirty">名單未儲存</span>}
                  </div>
                </section>

                <div className="two-col">
                  <RosterEditor
                    file={classFile}
                    busy={busy}
                    dirty={dirty}
                    onChange={(next) => {
                      setClassFile(next)
                      setDirty(true)
                    }}
                    onSave={handleSaveRoster}
                    onReload={() => void openClass(classFile.id)}
                    onImportExcel={handleImportExcel}
                  />

                  <AssignmentList
                    assignments={assignments}
                    busy={busy}
                    showForm={showAssignmentForm}
                    selectedId={selectedAssignmentId}
                    onSelect={handleSelectAssignment}
                    defaultRubric="balanced"
                    onToggleForm={() => setShowAssignmentForm((v) => !v)}
                    onCreate={handleCreateAssignment}
                  />
                </div>

                {selectedAssignment && (
                  <ImportPanel
                    classId={classFile.id}
                    assignment={selectedAssignment}
                    students={students}
                    works={works}
                    status={importStatus}
                    busy={busy}
                    audit={audit}
                    auditOpen={auditOpen}
                    auditBusy={auditBusy}
                    auditFilter={auditFilter}
                    auditMs={auditMs}
                    auditRun={auditRun}
                    stats={stats}
                    statsOpen={statsOpen}
                    statsBusy={statsBusy}
                    statsMs={statsMs}
                    statsRun={statsRun}
                    statsExport={statsExport}
                    gradebookOpen={gradebookOpen}
                    onGradebook={() => setGradebookOpen((value) => !value)}
                    onToast={(kind, text) => setToast({ kind, text })}
                    onAudit={runAudit}
                    onAuditFilter={setAuditFilter}
                    onStats={runStats}
                    onExportStats={handleExportStats}
                    onRevealStats={handleRevealStats}
                    onOpenInbox={handleOpenInbox}
                    onSimulate={handleSimulate}
                    onRefresh={handleRefreshInbox}
                    onChooseDriveRoot={handleChooseDriveRoot}
                    onClearDriveRoot={handleClearDriveRoot}
                    onEnsureDriveFolder={handleEnsureDriveFolder}
                    onOpenDriveRoot={handleOpenDriveRoot}
                    onReview={(seat) => {
                      if (!classFile || !selectedAssignment) return
                      setReviewTarget({
                        classId: classFile.id,
                        assignmentId: selectedAssignment.id,
                        seat
                      })
                    }}
                    onFeedback={handleOpenFeedback}
                  />
                )}
              </>
            ) : (
              <div className="center">從左側選擇班級</div>
            )}
          </main>
        </div>
      )}

      {toast && <div className={`toast toast--${toast.kind}`}>{toast.text}</div>}

      <footer className="statusbar">
        <span>{state?.root ?? '未開啟資料庫'}</span>
        <span>
          {state?.classes.length ?? 0} 班級 · {state?.root ? '資料夾即資料庫' : 'local-first'}
        </span>
      </footer>
    </div>
  )
}

function EmptyState({ onOpen, busy }: { onOpen: () => void; busy: boolean }): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-card">
        <p className="eyebrow">Local-first</p>
        <h2>資料夾就是資料庫</h2>
        <p>
          選一個空資料夾建立新資料庫，或開啟既有的
          <code>essay-grader-data</code>。所有批注、分數與名單都存在資料夾內，不上傳雲端。
        </p>
        <ul>
          <li>每個學期一個資料庫資料夾</li>
          <li>班級、作業、學生各自一個子資料夾</li>
          <li>建議放在非即時同步的磁碟，雲端只做備份</li>
        </ul>
        <button className="primary large" disabled={busy} onClick={onOpen}>
          選擇或建立資料夾
        </button>
      </div>
    </div>
  )
}

function CreateClassForm({
  busy,
  onCancel,
  onSubmit
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (input: CreateClassInput) => void
}): JSX.Element {
  const [classNo, setClassNo] = useState('')
  const [name, setName] = useState('')
  const [grade, setGrade] = useState<Grade>('junior')
  const [academicYear, setAcademicYear] = useState('114')
  const [semester, setSemester] = useState<1 | 2>(1)
  const [teacher, setTeacher] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    onSubmit({
      classNo: classNo.trim(),
      name: name.trim(),
      grade,
      academicYear: academicYear.trim(),
      semester,
      teacher: teacher.trim() || undefined
    })
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-row">
        <label>
          班號
          <input value={classNo} onChange={(e) => setClassNo(e.target.value)} placeholder="302" />
        </label>
        <label>
          學年度
          <input
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            placeholder="114"
          />
        </label>
      </div>
      <label>
        班級名稱
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="國中302" />
      </label>
      <div className="form-row">
        <label>
          學制
          <select value={grade} onChange={(e) => setGrade(e.target.value as Grade)}>
            <option value="junior">國中</option>
            <option value="senior">高中</option>
            <option value="vocational">高職</option>
          </select>
        </label>
        <label>
          學期
          <select
            value={semester}
            onChange={(e) => setSemester(Number(e.target.value) === 2 ? 2 : 1)}
          >
            <option value={1}>第 1 學期</option>
            <option value={2}>第 2 學期</option>
          </select>
        </label>
      </div>
      <label>
        教師
        <input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="王老師" />
      </label>
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="primary" disabled={busy}>
          建立
        </button>
      </div>
    </form>
  )
}

function RosterEditor({
  file,
  busy,
  dirty,
  onChange,
  onSave,
  onReload,
  onImportExcel
}: {
  file: ClassFile
  busy: boolean
  dirty: boolean
  onChange: (next: ClassFile) => void
  onSave: () => void
  onReload: () => void
  onImportExcel: () => void
}): JSX.Element {
  const [seat, setSeat] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const update = (index: number, patch: Partial<Student>): void => {
    const students = file.students.map((student, i) =>
      i === index ? { ...student, ...patch } : student
    )
    onChange({ ...file, students })
  }

  const remove = (index: number): void => {
    onChange({ ...file, students: file.students.filter((_, i) => i !== index) })
  }

  const add = (): void => {
    const normalized = padSeat(seat)
    if (normalized.length !== 2) {
      setError('座號需為 1–2 位數字')
      return
    }
    if (file.students.some((student) => student.seat === normalized)) {
      setError(`座號 ${normalized} 已存在`)
      return
    }
    if (!name.trim()) {
      setError('請填姓名')
      return
    }
    setError('')
    onChange({
      ...file,
      students: [...file.students, { seat: normalized, name: name.trim(), active: true }]
    })
    setSeat('')
    setName('')
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>名單</h3>
        <div className="card-actions">
          <button className="small" disabled={busy} onClick={onImportExcel}>
            匯入 Excel
          </button>
          <button className="small" disabled={busy || !dirty} onClick={onReload}>
            還原
          </button>
          <button className="small primary" disabled={busy || !dirty} onClick={onSave}>
            儲存名單
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th className="w-seat">座號</th>
            <th>姓名</th>
            <th className="w-active">在學</th>
            <th className="w-op" />
          </tr>
        </thead>
        <tbody>
          {file.students.length === 0 && (
            <tr>
              <td colSpan={4} className="muted center">
                尚無學生，請在下方新增
              </td>
            </tr>
          )}
          {file.students.map((student, index) => (
            <tr key={student.seat}>
              <td className="mono">{student.seat}</td>
              <td>
                <input
                  className="cell-input"
                  value={student.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={student.active}
                  onChange={(e) => update(index, { active: e.target.checked })}
                />
              </td>
              <td className="right">
                <button className="link danger" onClick={() => remove(index)}>
                  刪除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="add-row">
        <input
          className="seat-input"
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
          placeholder="座號"
          inputMode="numeric"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="姓名"
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button onClick={add} disabled={busy}>
          新增學生
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

function AssignmentList({
  assignments,
  busy,
  showForm,
  selectedId,
  defaultRubric,
  onSelect,
  onToggleForm,
  onCreate
}: {
  assignments: AssignmentSummary[]
  busy: boolean
  showForm: boolean
  selectedId: string | null
  defaultRubric: RubricPresetBaseId
  onSelect: (id: string) => void
  onToggleForm: () => void
  onCreate: (input: Omit<CreateAssignmentInput, 'classId'>) => void
}): JSX.Element {
  return (
    <section className="card">
      <div className="card-head">
        <h3>作業</h3>
        <button className="small" onClick={onToggleForm}>
          {showForm ? '取消' : '新增作業'}
        </button>
      </div>

      {showForm && (
        <CreateAssignmentForm
          busy={busy}
          defaultRubric={defaultRubric}
          onCancel={onToggleForm}
          onSubmit={onCreate}
        />
      )}

      <ul className="assignment-list">
        {assignments.length === 0 && <li className="muted">尚無作業</li>}
        {assignments.map((item) => (
          <li key={item.id}>
            <button
              className={item.id === selectedId ? 'assignment-row active' : 'assignment-row'}
              onClick={() => onSelect(item.id)}
            >
              <div>
                <p className="assignment-title">{item.title}</p>
                <p className="assignment-meta">
                  {item.id} · 量規 {item.rubricId}
                </p>
              </div>
              <span className="assignment-date">{item.dueAt?.slice(0, 10) ?? '未設定'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CreateAssignmentForm({
  busy,
  defaultRubric,
  onCancel,
  onSubmit
}: {
  busy: boolean
  defaultRubric: RubricPresetBaseId
  onCancel: () => void
  onSubmit: (input: Omit<CreateAssignmentInput, 'classId'>) => void
}): JSX.Element {
  const today = new Date().toISOString().slice(0, 10)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [genre, setGenre] = useState('narrative')
  const [wordLimit, setWordLimit] = useState('600')
  const [dueAt, setDueAt] = useState(today)
  const [rubricPreset, setRubricPreset] = useState(defaultRubric)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const limit = Number(wordLimit)
    onSubmit({
      title: title.trim(),
      prompt: prompt.trim(),
      genre,
      wordLimit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      dueAt: dueAt ? `${dueAt}T23:59:00+08:00` : undefined,
      rubricPreset
    })
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        題目
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="我的母親" />
      </label>
      <label>
        題幹
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="請以「我的母親」為題……"
        />
      </label>
      <div className="form-row">
        <label>
          體裁
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="narrative">記敘文</option>
            <option value="argumentative">議論文</option>
            <option value="expository">說明文</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          字數下限
          <input
            value={wordLimit}
            onChange={(e) => setWordLimit(e.target.value)}
            inputMode="numeric"
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          截止日
          <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label>
          量規
          <select
            value={rubricPreset}
            onChange={(e) => setRubricPreset(e.target.value as RubricPresetBaseId)}
          >
            {RUBRIC_PRESET_ORDER.map((id) => (
              <option key={id} value={id}>
                {RUBRIC_PRESET_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="assignment-meta">
        配分：{rubricSummary(rubricPreset)}（扣分：錯字 0.5／標點 0.5，上限 10）
      </p>
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="primary" disabled={busy}>
          建立作業
        </button>
      </div>
    </form>
  )
}

function ImportPanel({
  classId,
  assignment,
  students,
  works,
  status,
  busy,
  audit,
  auditOpen,
  auditBusy,
  auditFilter,
  auditMs,
  auditRun,
  stats,
  statsOpen,
  statsBusy,
  statsMs,
  statsRun,
  statsExport,
  gradebookOpen,
  onGradebook,
  onToast,
  onAudit,
  onAuditFilter,
  onStats,
  onExportStats,
  onRevealStats,
  onOpenInbox,
  onSimulate,
  onRefresh,
  onChooseDriveRoot,
  onClearDriveRoot,
  onEnsureDriveFolder,
  onOpenDriveRoot,
  onReview,
  onFeedback
}: {
  classId: string
  assignment: AssignmentSummary
  students: Student[]
  works: WorkSummary[]
  status: ImportStatus | null
  busy: boolean
  audit: AssignmentAudit | null
  auditOpen: boolean
  auditBusy: boolean
  auditFilter: AuditFilter
  auditMs: number | null
  auditRun: number
  stats: AssignmentStats | null
  statsOpen: boolean
  statsBusy: boolean
  statsMs: number | null
  statsRun: number
  statsExport: { dir: string; files: string[] } | null
  gradebookOpen: boolean
  onGradebook: () => void
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
  onAudit: () => void
  onAuditFilter: (filter: AuditFilter) => void
  onStats: () => void
  onExportStats: () => void
  onRevealStats: () => void
  onOpenInbox: () => void
  onSimulate: () => void
  onRefresh: () => void
  onChooseDriveRoot: () => void
  onClearDriveRoot: () => void
  onEnsureDriveFolder: () => void
  onOpenDriveRoot: () => void
  onReview: (seat: string) => void
  onFeedback: (seat: string) => void
}): JSX.Element {
  const counts = { pending: 0, grading: 0, done: 0 }
  for (const work of works) counts[work.status] += 1

  const [unmatchedOpen, setUnmatchedOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)

  const events = [...(status?.events ?? [])].slice(-6).reverse()

  return (
    <section className="card import-panel">
      <div className="card-head">
        <div>
          <h3>匯入佇列 · {assignment.title}</h3>
          <p className="assignment-meta">
            {assignment.id} · 監看 {status?.watching ?? 0} 個 inbox
          </p>
        </div>
        <div className="card-actions">
          <button className="small" disabled={busy || statsBusy} onClick={onStats}>
            {statsBusy ? '統計中…' : statsOpen ? '重新統計' : '統計'}
          </button>
          <button className="small" disabled={busy || auditBusy} onClick={onAudit}>
            {auditBusy ? '檢查中…' : auditOpen ? '重新檢查' : '批次檢查'}
          </button>
          <button className="small" disabled={busy} onClick={onGradebook}>
            {gradebookOpen ? '收起成績寫回' : '成績寫回'}
          </button>
          <button className="small" disabled={busy} onClick={onOpenInbox}>
            開啟 inbox
          </button>
          <button
            className="small unmatched-toggle"
            disabled={busy}
            onClick={() => setUnmatchedOpen((value) => !value)}
          >
            {unmatchedOpen ? '收起未匹配照片' : '未匹配照片'}
          </button>
          <button
            className="small batch-feedback-toggle"
            disabled={busy}
            onClick={() => setBatchOpen((value) => !value)}
          >
            {batchOpen ? '收起批次回饋單' : '批次回饋單'}
          </button>
          <button className="small" disabled={busy} onClick={onRefresh}>
            重新整理
          </button>
          <button className="small primary" disabled={busy} onClick={onSimulate}>
            模擬 10 檔
          </button>
        </div>
      </div>

      <div className="queue-counts">
        <span className="queue-chip pending">待批 {counts.pending}</span>
        <span className="queue-chip grading">批閱中 {counts.grading}</span>
        <span className="queue-chip done">已批 {counts.done}</span>
        <span className="queue-total">共 {works.length} 份</span>
      </div>

      <div className="drive-inbox">
        <div className="drive-inbox-info">
          <h4>Google Drive inbox</h4>
          <p className="assignment-meta" title={status?.externalRoot ?? ''}>
            {status?.externalRoot ?? '尚未設定'}
          </p>
          <p className="drive-inbox-state">
            {status?.externalRoot
              ? status.externalWatching
                ? '監看中'
                : '未監看'
              : '未設定外部 inbox'}
            {status?.externalError ? ` · ${status.externalError}` : ''}
          </p>
        </div>
        <div className="card-actions">
          <button className="small" disabled={busy} onClick={onChooseDriveRoot}>
            設定／變更
          </button>
          <button
            className="small"
            disabled={busy || !status?.externalRoot}
            onClick={onClearDriveRoot}
          >
            清除
          </button>
          <button
            className="small"
            disabled={busy || !status?.externalRoot}
            onClick={onEnsureDriveFolder}
          >
            建立此作業資料夾
          </button>
          <button
            className="small"
            disabled={busy || !status?.externalRoot}
            onClick={onOpenDriveRoot}
          >
            開啟資料夾
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th className="w-seat">座號</th>
            <th>姓名</th>
            <th>狀態</th>
            <th>頁數</th>
            <th>更新</th>
            <th className="w-op" />
          </tr>
        </thead>
        <tbody>
          {works.length === 0 && (
            <tr>
              <td colSpan={6} className="muted center">
                尚無作品。開啟 inbox 放入檔案，或按「模擬 10 檔」。
              </td>
            </tr>
          )}
          {works.map((work) => (
            <tr key={work.seat}>
              <td className="mono">{work.seat}</td>
              <td>{work.name}</td>
              <td>
                <span className={`status status--${work.status}`}>
                  {STATUS_LABELS[work.status]}
                </span>
              </td>
              <td className="mono">{work.pages}</td>
              <td className="muted small-text">
                {work.updatedAt.slice(0, 16).replace('T', ' ')}
              </td>
              <td className="right">
                <span className="row-actions">
                  <button className="small" onClick={() => onReview(work.seat)}>
                    批閱
                  </button>
                  {work.status === 'done' && (
                    <button className="small" onClick={() => onFeedback(work.seat)}>
                      回饋單
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {auditOpen && (
        <AuditPanel
          audit={audit}
          busy={auditBusy}
          filter={auditFilter}
          elapsedMs={auditMs}
          run={auditRun}
          onFilter={onAuditFilter}
          onAudit={onAudit}
          onReview={onReview}
        />
      )}

      {statsOpen && (
        <StatsPanel
          stats={stats}
          busy={statsBusy}
          elapsedMs={statsMs}
          run={statsRun}
          exported={statsExport}
          onStats={onStats}
          onExport={onExportStats}
          onReveal={onRevealStats}
        />
      )}

      {gradebookOpen && (
        <GradebookPanel
          key={`${classId}:${assignment.id}`}
          classId={classId}
          assignment={assignment}
          busy={busy}
          onToast={onToast}
        />
      )}

      {unmatchedOpen && (
        <UnmatchedPanel
          key={`${classId}:${assignment.id}`}
          classId={classId}
          assignment={assignment}
          students={students}
          onClose={() => setUnmatchedOpen(false)}
          onToast={onToast}
        />
      )}

      {batchOpen && (
        <BatchFeedbackPanel
          key={`${classId}:${assignment.id}`}
          classId={classId}
          assignment={assignment}
          works={works}
          onClose={() => setBatchOpen(false)}
          onToast={onToast}
        />
      )}

      <div className="event-log">
        <h4>最近事件</h4>
        {events.length === 0 ? (
          <p className="muted">尚無事件</p>
        ) : (
          events.map((event) => (
            <p key={event.id} className={`event event--${event.type}`}>
              <span>{event.at.slice(11, 19)}</span> {event.message}
            </p>
          ))
        )}
      </div>
    </section>
  )
}

/** 未匹配照片：列出、預覽縮圖，選取後指定給在學學生並排入既有 watcher。 */
function UnmatchedPanel({
  classId,
  assignment,
  students,
  onClose,
  onToast
}: {
  classId: string
  assignment: AssignmentSummary
  students: Student[]
  onClose: () => void
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
}): JSX.Element {
  const [listing, setListing] = useState<UnmatchedListing | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [seat, setSeat] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const loadedThumbs = useRef(new Set<string>())

  const activeStudents = students.filter((student) => student.active)
  const photos = listing?.photos ?? []

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const data = (await window.electronAPI.imports.listUnmatched(
        classId,
        assignment.id
      )) as UnmatchedListing
      setListing(data)
      setSelected((prev) => {
        const alive = new Set(data.photos.map((photo) => photo.path))
        return new Set([...prev].filter((path) => alive.has(path)))
      })
    } catch (cause) {
      setError(`讀取未匹配照片：${errorText(cause)}`)
    } finally {
      setLoading(false)
    }
  }, [classId, assignment.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!seat && activeStudents[0]) setSeat(activeStudents[0].seat)
  }, [activeStudents, seat])

  // 一次只向 main 要一張 320px 縮圖，避免把大圖全部載進 renderer。
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      for (const photo of photos) {
        if (cancelled) return
        if (loadedThumbs.current.has(photo.path)) continue
        loadedThumbs.current.add(photo.path)
        try {
          const thumb = (await window.electronAPI.imports.unmatchedThumbnail(
            classId,
            assignment.id,
            photo.path
          )) as { dataUrl: string }
          if (!cancelled) {
            setThumbs((prev) => ({ ...prev, [photo.path]: thumb.dataUrl }))
          }
        } catch {
          // 單張縮圖失敗不影響其餘照片
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [assignment.id, classId, photos])

  const toggle = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const target = activeStudents.find((student) => student.seat === seat) ?? null
  const orderedSelection = photos
    .filter((photo) => selected.has(photo.path))
    .map((photo) => photo.path)

  const assign = async (): Promise<void> => {
    if (!target) {
      setError('請先選擇要指派的學生。')
      return
    }
    if (orderedSelection.length === 0) {
      setError('請先勾選至少一張照片。')
      return
    }

    setWorking(true)
    setError('')
    setResult('')
    try {
      const outcome = (await window.electronAPI.imports.assignUnmatched(
        classId,
        assignment.id,
        target.seat,
        orderedSelection
      )) as UnmatchedAssignmentResult

      const failureText =
        outcome.failed.length > 0
          ? `；${outcome.failed.length} 筆失敗：${outcome.failed
              .slice(0, 3)
              .map((item) => `${item.path.split(/[\\/]/).pop() ?? item.path}（${item.reason}）`)
              .join('、')}`
          : ''
      setResult(
        `已排入匯入佇列 ${outcome.queued} 張，watcher 會依檔案時間附加為下一頁${failureText}`
      )
      setSelected(new Set())
      onToast(
        outcome.failed.length > 0 ? 'info' : 'ok',
        `已排入 ${outcome.queued} 張未匹配照片`
      )
      await load()
    } catch (cause) {
      setError(`指定座號：${errorText(cause)}`)
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="unmatched-panel">
      <div className="unmatched-head">
        <div>
          <h4>未匹配照片 · {photos.length} 張</h4>
          <p className="assignment-meta">
            來源：本機 `_inbox/_unmatched` 與 Google Drive `_unmatched`
          </p>
        </div>
        <div className="card-actions">
          <button className="small" disabled={loading || working} onClick={() => void load()}>
            {loading ? '讀取中…' : '重新整理'}
          </button>
          <button className="small" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>

      <div className="unmatched-toolbar">
        <label>
          指定給
          <select
            className="unmatched-student"
            value={seat}
            disabled={activeStudents.length === 0 || working}
            onChange={(event) => setSeat(event.target.value)}
          >
            {activeStudents.length === 0 && <option value="">沒有在學學生</option>}
            {activeStudents.map((student) => (
              <option key={student.seat} value={student.seat}>
                {student.seat} {student.name}
              </option>
            ))}
          </select>
        </label>
        <div className="unmatched-select-actions">
          <button
            className="small"
            disabled={photos.length === 0 || loading}
            onClick={() => setSelected(new Set(photos.map((photo) => photo.path)))}
          >
            全選
          </button>
          <button
            className="small"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            清除選取
          </button>
          <span className="muted small-text">已選 {selected.size} 張</span>
        </div>
      </div>

      {error && <p className="unmatched-error">{error}</p>}
      {result && <p className="unmatched-result">{result}</p>}

      {loading ? (
        <p className="muted">讀取未匹配照片中…</p>
      ) : photos.length === 0 ? (
        <div className="unmatched-empty">
          <p>目前沒有未匹配照片。</p>
          <p className="muted small-text">
            匯入失敗或缺座號的照片會出現在本機 `_inbox/_unmatched`；Google Drive 的失敗檔在外部根目錄的
            `_unmatched`。
          </p>
        </div>
      ) : (
        <div className="unmatched-list">
          {photos.map((photo) => (
            <label
              key={photo.path}
              className={`unmatched-card${selected.has(photo.path) ? ' selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={selected.has(photo.path)}
                disabled={working}
                onChange={() => toggle(photo.path)}
              />
              <span className="unmatched-thumb">
                {thumbs[photo.path] ? (
                  <img src={thumbs[photo.path]} alt={photo.name} />
                ) : (
                  <span className="muted small-text">縮圖載入中…</span>
                )}
              </span>
              <span className="unmatched-info">
                <span className="unmatched-name" title={photo.path}>
                  {photo.name}
                </span>
                <span className="unmatched-tags">
                  <span className={`queue-chip ${photo.source === 'drive' ? 'grading' : 'pending'}`}>
                    {photo.source === 'drive' ? 'Drive' : '本機'}
                  </span>
                  <span className="muted small-text">
                    {photo.classId && photo.assignmentId
                      ? `${photo.classId}／${photo.assignmentId}${
                          photo.seat ? ` · S${photo.seat}` : ''
                        }`
                      : '未指定作業'}
                  </span>
                </span>
                <span className="unmatched-reason">原因：{photo.reason}</span>
                <span className="unmatched-time muted small-text">
                  {new Date(photo.modifiedAt).toLocaleString('zh-TW', { hour12: false })} ·{' '}
                  {formatBytes(photo.size)}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="unmatched-actions">
        <p className="unmatched-confirm">
          {target
            ? `會附加到 S${target.seat} ${target.name}，並依檔案時間排序；複製成功後來源會刪除。`
            : '請先選擇學生，才會知道會附加到誰。'}
        </p>
        <button
          className="primary unmatched-assign"
          disabled={working || !target || orderedSelection.length === 0}
          onClick={() => void assign()}
        >
          {working
            ? '排入中…'
            : target
              ? `指定給 S${target.seat} ${target.name} 並排入匯入`
              : '指定並排入匯入'}
        </button>
      </div>
    </section>
  )
}

/** 整班批次回饋單：逐份輸出、顯示進度，跳過未完成、單份失敗不中斷。 */
function BatchFeedbackPanel({
  classId,
  assignment,
  works,
  onClose,
  onToast
}: {
  classId: string
  assignment: AssignmentSummary
  works: WorkSummary[]
  onClose: () => void
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
}): JSX.Element {
  const [info, setInfo] = useState<BatchFeedbackInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<BatchFeedbackProgress | null>(null)
  const [report, setReport] = useState<BatchFeedbackReport | null>(null)
  const [error, setError] = useState('')
  const jobIdRef = useRef('')

  const loadInfo = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const data = (await window.electronAPI.feedback.batchInfo(
        classId,
        assignment.id
      )) as BatchFeedbackInfo
      setInfo(data)
    } catch (cause) {
      setError(`讀取批次資訊：${errorText(cause)}`)
    } finally {
      setLoading(false)
    }
  }, [classId, assignment.id])

  useEffect(() => {
    void loadInfo()
  }, [loadInfo, works])

  useEffect(() => {
    const id = window.electronAPI.feedback.onBatchProgress((raw) => {
      const payload = raw as BatchFeedbackProgress
      if (payload.classId !== classId || payload.assignmentId !== assignment.id) return
      jobIdRef.current = payload.jobId
      setProgress(payload)
    })
    return () => window.electronAPI.feedback.offBatchProgress(id)
  }, [assignment.id, classId])

  const start = async (): Promise<void> => {
    if (running || !info || info.exportable === 0) return
    setRunning(true)
    setCancelling(false)
    setError('')
    setReport(null)
    setProgress(null)
    jobIdRef.current = ''
    try {
      const result = (await window.electronAPI.feedback.batchStart(
        classId,
        assignment.id
      )) as BatchFeedbackReport
      setReport(result)
      jobIdRef.current = result.jobId
      onToast(
        result.failed > 0 || result.skipped > 0 ? 'info' : 'ok',
        `批次回饋單完成：輸出 ${result.exported}、跳過 ${result.skipped}、失敗 ${result.failed}`
      )
    } catch (cause) {
      setError(`批次回饋單：${errorText(cause)}`)
    } finally {
      setRunning(false)
      setCancelling(false)
      void loadInfo()
    }
  }

  const cancel = async (): Promise<void> => {
    if (!running || cancelling) return
    setCancelling(true)
    try {
      const result = (await window.electronAPI.feedback.batchCancel(
        jobIdRef.current
      )) as { canceled: boolean; reason?: string; report?: BatchFeedbackReport }
      if (result.report) setReport(result.report)
      if (!result.canceled) {
        setError(result.reason ?? '無法取消批次回饋單')
      }
    } catch (cause) {
      setError(`取消批次回饋單：${errorText(cause)}`)
    } finally {
      setCancelling(false)
    }
  }

  const reveal = async (): Promise<void> => {
    try {
      const result = (await window.electronAPI.feedback.batchReveal(
        classId,
        assignment.id
      )) as { dir: string }
      onToast('info', `批次回饋單資料夾：${result.dir}`)
    } catch (cause) {
      setError(`開啟輸出資料夾：${errorText(cause)}`)
    }
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0
  const empty = !loading && (info?.exportable ?? 0) === 0

  return (
    <section className="batch-feedback-panel">
      <div className="batch-feedback-head">
        <div>
          <h4>批次回饋單 · {assignment.title}</h4>
          <p className="assignment-meta">依座號逐份輸出，只處理已批且有分數的作品</p>
        </div>
        <div className="card-actions">
          <button
            className="small batch-reveal"
            disabled={running}
            onClick={() => void reveal()}
          >
            開啟輸出資料夾
          </button>
          <button className="small" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>

      <div className="batch-feedback-info">
        <span className="queue-chip done">已批 {info?.exportable ?? 0} 份</span>
        <span className="queue-chip pending">未完成 {info?.unfinished ?? 0} 份</span>
        <span className="queue-total">共 {info?.total ?? 0} 份</span>
        <span className="batch-output" title={info?.outputDir ?? ''}>
          輸出位置：{info?.outputDir ?? '讀取中…'}
        </span>
      </div>

      <div className="batch-feedback-controls">
        <button
          className="primary batch-start"
          disabled={running || loading || empty || !info}
          onClick={() => void start()}
        >
          {running ? '輸出中…' : '開始批次輸出'}
        </button>
        <button
          className="batch-cancel"
          disabled={!running || cancelling}
          onClick={() => void cancel()}
        >
          {cancelling ? '取消中…' : '取消'}
        </button>
        {empty && (
          <span className="muted small-text">目前沒有已批且有分數的作品，無法開始。</span>
        )}
      </div>

      {error && <p className="batch-error">{error}</p>}

      <div className="batch-progress">
        <div className="batch-progress-track">
          <div className="batch-progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <p className="batch-current">
          {progress
            ? `第 ${progress.index}／${progress.total} 份 · S${progress.seat} ${progress.name} · ${
                BATCH_STATUS_LABELS[progress.status]
              }（${progress.message}）`
            : running
              ? '準備輸出…'
              : report
                ? `已完成 ${report.total} 份`
                : '尚未開始'}
        </p>
      </div>

      {report && (
        <div className="batch-result">
          <div className="queue-counts">
            <span className="queue-chip done">成功 {report.exported}</span>
            <span className="queue-chip pending">跳過 {report.skipped}</span>
            <span className="queue-chip missing">失敗 {report.failed}</span>
            {report.cancelled > 0 && (
              <span className="queue-chip grading">取消 {report.cancelled}</span>
            )}
            <span className="queue-total">
              共 {report.total} 份 · {(report.elapsedMs / 1000).toFixed(1)} 秒
            </span>
          </div>
          <table className="table batch-table">
            <thead>
              <tr>
                <th className="w-seat">座號</th>
                <th>姓名</th>
                <th>狀態</th>
                <th>檔名</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item) => (
                <tr key={item.seat}>
                  <td className="mono">{item.seat}</td>
                  <td>{item.name}</td>
                  <td>
                    <span className={`batch-status batch-status--${item.status}`}>
                      {BATCH_STATUS_LABELS[item.status]}
                    </span>
                  </td>
                  <td className="batch-file" title={item.path}>
                    {item.fileName || '—'}
                  </td>
                  <td className="muted small-text">{item.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const toGradebookDraft = (value: {
  path: string
  sheet: string
  header_row: number
  seat_column: string
  name_column?: string
  score_column: string
  grade_column?: string
  seat_format?: string
}): GradebookDraft => ({
  path: value.path,
  sheet: value.sheet,
  header_row: value.header_row,
  seat_column: value.seat_column,
  name_column: value.name_column ?? '',
  score_column: value.score_column,
  grade_column: value.grade_column ?? '',
  seat_format: value.seat_format ?? '{seat}'
})

const toGradebookPayload = (draft: GradebookDraft): Record<string, unknown> => ({
  path: draft.path.trim(),
  sheet: draft.sheet.trim(),
  header_row: Math.max(1, Math.floor(Number(draft.header_row) || 1)),
  seat_column: draft.seat_column.trim().toUpperCase(),
  name_column: draft.name_column.trim().toUpperCase() || undefined,
  score_column: draft.score_column.trim().toUpperCase(),
  grade_column: draft.grade_column.trim().toUpperCase() || undefined,
  seat_format: draft.seat_format.trim() || '{seat}'
})

const gradebookMode = (path: string): string => {
  const lower = path.toLowerCase()
  if (!lower) return '—'
  if (lower.endsWith('.xlsx')) return '直接寫副本'
  return '匯出新檔'
}

/** 成績寫回面板：設定、自動偵測、寫回報告與 CSV 匯出。 */
function GradebookPanel({
  classId,
  assignment,
  busy,
  onToast
}: {
  classId: string
  assignment: AssignmentSummary
  busy: boolean
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
}): JSX.Element {
  const [config, setConfig] = useState<GradebookDraft | null>(null)
  const [draft, setDraft] = useState<GradebookDraft | null>(null)
  const [inspection, setInspection] = useState<GradebookInspection | null>(null)
  const [report, setReport] = useState<GradebookReport | null>(null)
  const [csvPath, setCsvPath] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let alive = true
    window.electronAPI.gradebook
      .getConfig(classId, assignment.id)
      .then((result) => {
        if (!alive) return
        const raw = (result as { gradebook?: Parameters<typeof toGradebookDraft>[0] } | null)
          ?.gradebook
        if (raw) {
          const next = toGradebookDraft(raw)
          setConfig(next)
          setDraft(next)
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(`讀取成績表設定：${errorText(cause)}`)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [classId, assignment.id])

  const runAction = async (label: string, action: () => Promise<void>): Promise<void> => {
    setWorking(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(`${label}：${errorText(cause)}`)
    } finally {
      setWorking(false)
    }
  }

  const update = (patch: Partial<GradebookDraft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const applyDetection = (
    next: GradebookInspection,
    previous: GradebookDraft
  ): GradebookDraft => {
    const detected = next.detection
    if (!detected) return previous
    return {
      ...previous,
      header_row: detected.headerRow,
      seat_column: detected.seatColumn,
      name_column: detected.nameColumn ?? '',
      score_column: detected.scoreColumn,
      grade_column: detected.gradeColumn ?? '',
      seat_format: detected.seatFormat || '{seat}'
    }
  }

  const chooseFile = (): void => {
    void runAction('選擇成績表', async () => {
      const result = (await window.electronAPI.gradebook.chooseFile(
        classId,
        assignment.id
      )) as unknown as GradebookInspection & { canceled: boolean; path?: string }
      if (result.canceled) return

      const base: GradebookDraft = {
        path: result.path ?? '',
        sheet: result.sheet ?? result.sheets[0]?.name ?? '',
        header_row: 1,
        seat_column: 'B',
        name_column: '',
        score_column: 'D',
        grade_column: '',
        seat_format: '{seat}'
      }
      setInspection(result)
      setDraft(applyDetection(result, base))
      setReport(null)
      setCsvPath(null)
      onToast(
        'info',
        result.exportOnly
          ? result.exportReason ?? '此檔會以匯出模式處理。'
          : `已讀取 ${result.sheets.length} 個工作表，請確認欄位後儲存設定。`
      )
    })
  }

  const autoDetect = (): void => {
    void runAction('自動偵測', async () => {
      const path = (draft?.path ?? config?.path ?? '').trim()
      if (!path) throw new Error('請先選擇成績表。')
      const sheet = (draft?.sheet ?? config?.sheet ?? '').trim() || undefined
      const result = (await window.electronAPI.gradebook.inspect(
        path,
        sheet
      )) as GradebookInspection
      setInspection(result)
      if (!result.detection) {
        throw new Error(
          result.exportOnly
            ? result.exportReason ?? '此格式無法偵測欄位，會以匯出模式處理。'
            : '前 10 列找不到「座號」表頭，請手動設定欄位。'
        )
      }
      setDraft((prev) => (prev ? applyDetection(result, prev) : prev))
      onToast(
        'ok',
        `已建議表頭第 ${result.detection.headerRow} 列、座號 ${result.detection.seatColumn} 欄。`
      )
    })
  }

  const changeSheet = (sheet: string): void => {
    update({ sheet })
    const path = (draft?.path ?? '').trim()
    if (!path) return
    void runAction('讀取工作表', async () => {
      const result = (await window.electronAPI.gradebook.inspect(
        path,
        sheet
      )) as GradebookInspection
      setInspection(result)
      setDraft((prev) => {
        if (!prev) return prev
        const next = { ...prev, sheet }
        return result.detection ? applyDetection(result, next) : next
      })
      if (!result.detection) {
        setError('這個工作表找不到「座號」表頭，請手動設定欄位。')
      }
    })
  }

  const saveConfig = async (): Promise<GradebookDraft | null> => {
    if (!draft) throw new Error('請先選擇成績表。')
    const result = (await window.electronAPI.gradebook.saveConfig(
      classId,
      assignment.id,
      toGradebookPayload(draft)
    )) as { gradebook: Parameters<typeof toGradebookDraft>[0] }
    const next = toGradebookDraft(result.gradebook)
    setConfig(next)
    setDraft(next)
    return next
  }

  const handleSave = (): void => {
    void runAction('儲存成績表設定', async () => {
      await saveConfig()
      onToast('ok', '成績表設定已儲存到這個作業。')
    })
  }

  const handleWrite = (): void => {
    void runAction('寫回成績', async () => {
      await saveConfig()
      const result = (await window.electronAPI.gradebook.write(
        classId,
        assignment.id
      )) as GradebookReport
      setReport(result)
      setCsvPath(result.csvPath)
      if (result.ok) {
        onToast('ok', `已寫回 ${result.written} 筆成績，原檔未變更。`)
      } else {
        onToast('error', result.error ?? '成績寫回失敗。')
      }
    })
  }

  const handleExportCsv = (): void => {
    void runAction('匯出 CSV', async () => {
      const result = (await window.electronAPI.gradebook.exportCsv(
        classId,
        assignment.id
      )) as { path: string; rows: number }
      setCsvPath(result.path)
      onToast('ok', `已匯出 ${result.rows} 筆 CSV。`)
    })
  }

  const handleReveal = (): void => {
    const target = report?.outputPath ?? report?.csvPath ?? csvPath
    if (!target) return
    void window.electronAPI.gradebook
      .reveal(target)
      .catch((cause: unknown) => setError(`開啟資料夾：${errorText(cause)}`))
  }

  const disabled = busy || working
  const sheets = inspection?.sheets ?? []
  const revealTarget = report?.outputPath ?? report?.csvPath ?? csvPath

  return (
    <div className="gradebook-panel">
      <div className="audit-head">
        <div>
          <h4>成績寫回 · {assignment.title}</h4>
          <p className="audit-meta">
            {loading
              ? '讀取設定中…'
              : config
                ? '原檔永不覆蓋；每次寫回都建立新的 graded 副本。'
                : '尚未設定成績表。'}
          </p>
        </div>
        <div className="card-actions">
          <button className="small" disabled={disabled} onClick={chooseFile}>
            選擇成績表
          </button>
          <button className="small" disabled={disabled} onClick={autoDetect}>
            自動偵測
          </button>
          <button className="small" disabled={disabled || !draft} onClick={handleSave}>
            儲存設定
          </button>
          <button className="small primary" disabled={disabled || !draft} onClick={handleWrite}>
            {working ? '處理中…' : '寫回成績'}
          </button>
          <button className="small" disabled={disabled} onClick={handleExportCsv}>
            匯出 CSV
          </button>
          <button className="small" disabled={disabled || !revealTarget} onClick={handleReveal}>
            開啟輸出資料夾
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="gradebook-summary">
        <div>
          <span>檔案</span>
          <strong className="gradebook-path" title={config?.path ?? ''}>
            {config?.path ?? '尚未設定'}
          </strong>
        </div>
        <div>
          <span>工作表</span>
          <strong>{config?.sheet ?? '—'}</strong>
        </div>
        <div>
          <span>表頭列</span>
          <strong>{config?.header_row ?? '—'}</strong>
        </div>
        <div>
          <span>座號欄</span>
          <strong>{config?.seat_column ?? '—'}</strong>
        </div>
        <div>
          <span>分數欄</span>
          <strong>{config?.score_column ?? '—'}</strong>
        </div>
        <div>
          <span>等第欄</span>
          <strong>{config?.grade_column || '未設定'}</strong>
        </div>
        <div>
          <span>模式</span>
          <strong>{gradebookMode(config?.path ?? '')}</strong>
        </div>
      </div>

      {draft && (
        <div className="gradebook-form">
          <label className="gradebook-form-path">
            成績表檔案
            <input
              value={draft.path}
              onChange={(event) => update({ path: event.target.value })}
              placeholder="D:\teaching\成績.xlsx"
            />
          </label>
          <label>
            工作表
            {sheets.length > 0 ? (
              <select value={draft.sheet} onChange={(event) => changeSheet(event.target.value)}>
                {sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name}（{sheet.rowCount} 列）
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.sheet}
                onChange={(event) => update({ sheet: event.target.value })}
                placeholder="作文"
              />
            )}
          </label>
          <label>
            表頭列
            <input
              type="number"
              min={1}
              value={draft.header_row}
              onChange={(event) => update({ header_row: Number(event.target.value) })}
            />
          </label>
          <label>
            座號欄
            <input
              value={draft.seat_column}
              maxLength={3}
              onChange={(event) => update({ seat_column: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            姓名欄（可選）
            <input
              value={draft.name_column}
              maxLength={3}
              onChange={(event) => update({ name_column: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            分數欄
            <input
              value={draft.score_column}
              maxLength={3}
              onChange={(event) => update({ score_column: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            等第欄（可選）
            <input
              value={draft.grade_column}
              maxLength={3}
              onChange={(event) => update({ grade_column: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            座號格式
            <input
              value={draft.seat_format}
              onChange={(event) => update({ seat_format: event.target.value })}
              placeholder="{seat}"
            />
          </label>
        </div>
      )}

      {inspection?.warning && <p className="gradebook-warning">{inspection.warning}</p>}

      {inspection && inspection.preview.length > 0 && (
        <div className="gradebook-preview">
          <p className="assignment-meta">前幾列預覽（{inspection.sheet}）</p>
          <table className="table">
            <tbody>
              {inspection.preview.map((row, rowIndex) => (
                <tr key={`preview-${rowIndex}`}>
                  <td className="mono muted">{rowIndex + 1}</td>
                  {row.map((cell, cellIndex) => (
                    <td key={`preview-${rowIndex}-${cellIndex}`}>{cell || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <div className={`gradebook-report ${report.ok ? 'is-ok' : 'is-failed'}`}>
          <div className="gradebook-report-head">
            <strong>{report.ok ? '寫回成功' : '寫回失敗'}</strong>
            <span className="queue-chip done">成功寫入 {report.written}</span>
            <span className={report.unmatched.length > 0 ? 'queue-chip problem' : 'queue-chip clean'}>
              未匹配 {report.unmatched.length}
            </span>
            <span className="queue-chip pending">未完成 {report.incomplete.length}</span>
            {report.duplicates.length > 0 && (
              <span className="queue-chip missing">座號重複 {report.duplicates.length}</span>
            )}
            <span className={report.verified ? 'queue-chip clean' : 'queue-chip missing'}>
              驗證 {report.verified ? '通過' : '未通過'}
            </span>
          </div>

          {report.error && <p className="form-error">{report.error}</p>}

          <p className="audit-meta">
            模式：{report.mode === 'copy' ? '複製後寫入副本' : '匯出新檔'} · 工作表{' '}
            {report.sheet || '—'} · 表頭第 {report.headerRow} 列 · 耗時 {report.elapsedMs} ms
            {report.verification
              ? ` · 列數 ${report.verification.rowCountBefore} → ${report.verification.rowCountAfter}，驗證 ${report.verification.checked} 筆`
              : ''}
          </p>

          {report.outputPath && (
            <p className="assignment-meta gradebook-output" title={report.outputPath}>
              副本：{report.outputPath}
            </p>
          )}
          {report.csvPath && (
            <p className="assignment-meta gradebook-output" title={report.csvPath}>
              CSV：{report.csvPath}
            </p>
          )}

          {report.duplicates.length > 0 && (
            <div className="gradebook-block">
              <h4>座號重複，已中止</h4>
              <ul>
                {report.duplicates.map((item) => (
                  <li key={item.seat}>
                    座號 {item.seat}：第 {item.rows.join('、')} 列
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.changes.length > 0 && (
            <div className="gradebook-block">
              <h4>變更前後</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>座號</th>
                    <th>姓名</th>
                    <th>列</th>
                    <th>分數</th>
                    <th>等第</th>
                  </tr>
                </thead>
                <tbody>
                  {report.changes.map((change) => (
                    <tr key={`change-${change.seat}`}>
                      <td className="mono">{change.seat}</td>
                      <td>{change.name}</td>
                      <td className="mono">{change.row}</td>
                      <td className="mono">
                        {change.scoreBefore === null ? '空白' : change.scoreBefore} →{' '}
                        {change.scoreAfter}
                      </td>
                      <td>
                        {change.gradeBefore || '空白'} → {change.gradeAfter || '空白'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(report.unmatched.length > 0 || report.incomplete.length > 0) && (
            <div className="gradebook-columns">
              <div className="gradebook-block">
                <h4>未匹配（未寫入）</h4>
                {report.unmatched.length === 0 ? (
                  <p className="muted">無</p>
                ) : (
                  <ul>
                    {report.unmatched.map((item) => (
                      <li key={`unmatched-${item.seat}`}>
                        座號 {item.seat} {item.name}：{item.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="gradebook-block">
                <h4>未完成（未寫入）</h4>
                {report.incomplete.length === 0 ? (
                  <p className="muted">無</p>
                ) : (
                  <ul>
                    {report.incomplete.map((item) => (
                      <li key={`incomplete-${item.seat}`}>
                        座號 {item.seat} {item.name}：{item.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {report.verification && report.verification.failures.length > 0 && (
            <div className="gradebook-block">
              <h4>驗證問題</h4>
              <ul>
                {report.verification.failures.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            </div>
          )}

          {report.warnings.length > 0 && (
            <div className="gradebook-block">
              <h4>提醒</h4>
              <ul>
                {report.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {!report.ok && report.csvPath && (
            <p className="assignment-meta">分數已保留在 CSV，可直接開啟使用。</p>
          )}
        </div>
      )}
    </div>
  )
}

/** 作業層級統計面板：G1 弱項排行、G2 常錯字、G3 個人弱項與 CSV 匯出。 */
function StatsPanel({
  stats,
  busy,
  elapsedMs,
  run,
  exported,
  onStats,
  onExport,
  onReveal
}: {
  stats: AssignmentStats | null
  busy: boolean
  elapsedMs: number | null
  run: number
  exported: { dir: string; files: string[] } | null
  onStats: () => void
  onExport: () => void
  onReveal: () => void
}): JSX.Element {
  const summary = stats?.summary
  const weaknesses = stats?.weaknesses ?? []
  const typos = stats?.typos ?? []
  const rows = stats?.students ?? []
  const checkedAt = stats
    ? new Date(stats.generatedAt).toLocaleTimeString('zh-TW', { hour12: false })
    : ''

  const value = (input: number | null | undefined): string =>
    input === null || input === undefined ? '—' : Number.isInteger(input) ? String(input) : input.toFixed(1)

  return (
    <div className="stats-panel" data-run={run}>
      <div className="audit-head">
        <div>
          <h4>統計 · {stats?.title ?? '作業'}</h4>
          <p className="audit-meta" data-run={run}>
            {stats
              ? `計算於 ${checkedAt}${elapsedMs !== null ? ` · ${elapsedMs} ms` : ''}`
              : '尚未計算'}
            {summary
              ? ` · 已批 ${summary.done}／匯入 ${summary.imported}／在學 ${summary.students}`
              : ''}
          </p>
        </div>
        <div className="card-actions">
          <button className="small" disabled={busy} onClick={onStats}>
            {busy ? '計算中…' : '重新計算'}
          </button>
          <button className="small primary" disabled={busy} onClick={onExport}>
            匯出 CSV
          </button>
          {exported && (
            <button className="small" onClick={onReveal}>
              開啟統計資料夾
            </button>
          )}
        </div>
      </div>

      {!stats ? (
        <p className="muted">{busy ? '正在彙整批注與分數…' : '尚未取得統計結果'}</p>
      ) : (
        <>
          <div className="queue-counts audit-stats">
            <span className="queue-chip">在學 {summary?.students ?? 0}</span>
            <span className="queue-chip done">已批 {summary?.done ?? 0}</span>
            {summary && summary.notDone > 0 && (
              <span className="queue-chip pending">未完成 {summary.notDone}</span>
            )}
            {summary && summary.missing > 0 && (
              <span className="queue-chip missing">未匯入 {summary.missing}</span>
            )}
            <span className="queue-chip clean">平均 {value(summary?.average)}</span>
            <span className="queue-chip">中位 {value(summary?.median)}</span>
            <span className="queue-chip">最高 {value(summary?.high)}</span>
            <span className="queue-chip">最低 {value(summary?.low)}</span>
          </div>

          <div className="stats-summary">
            <div className="stats-score">
              <strong>{value(summary?.average)}</strong>
              <span>班級平均</span>
            </div>
            <div className="stats-grades">
              <p>等第分布</p>
              <div>
                {(summary?.grades ?? []).length === 0 ? (
                  <span className="muted">尚無已批分數</span>
                ) : (
                  summary?.grades.map((grade) => (
                    <span key={grade.label} className="stats-grade-chip">
                      {grade.label} <strong>{grade.count}</strong>
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="stats-items">
              <p>分項平均</p>
              {(summary?.items ?? []).map((item) => (
                <span key={item.id}>
                  {item.name} <strong>{value(item.average)}</strong>／{item.max}
                  {item.percent !== null ? `（${value(item.percent)}%）` : ''}
                </span>
              ))}
            </div>
          </div>

          <div className="stats-grid">
            <section className="stats-block">
              <h5>弱項排行（G1）</h5>
              <div className="stats-category-chips">
                {(stats.categories ?? []).map((item) => (
                  <span key={item.key} className="stats-category-chip">
                    {item.categoryLabel} <strong>{item.count}</strong>
                  </span>
                ))}
              </div>
              <div className="stats-scroll">
                <table className="table stats-table">
                  <thead>
                    <tr>
                      <th className="w-seat">#</th>
                      <th>類型</th>
                      <th>次數</th>
                      <th>占比</th>
                      <th>人數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weaknesses.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted center">
                          尚無已批作品的弱項批注
                        </td>
                      </tr>
                    )}
                    {weaknesses.map((item, index) => (
                      <tr key={item.key} className="stats-row">
                        <td className="mono">{index + 1}</td>
                        <td>
                          <span className={`stats-cat stats-cat--${item.category}`}>
                            {item.categoryLabel}
                          </span>
                          {item.subtype ? ` ${item.label}` : ''}
                        </td>
                        <td className="mono">{item.count}</td>
                        <td className="stats-share">
                          <span className="stats-bar">
                            <i style={{ width: `${Math.min(100, item.share * 100)}%` }} />
                          </span>
                          {(item.share * 100).toFixed(1)}%
                        </td>
                        <td className="mono">{item.students}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="stats-block">
              <h5>常錯字（G2）</h5>
              <div className="stats-scroll">
                <table className="table stats-table">
                  <thead>
                    <tr>
                      <th className="w-seat">#</th>
                      <th>錯字</th>
                      <th>正確</th>
                      <th>次數</th>
                      <th>人數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typos.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted center">
                          尚無填入錯字與正確字的批注
                        </td>
                      </tr>
                    )}
                    {typos.slice(0, 20).map((item, index) => (
                      <tr key={`${item.wrong}-${item.correct}`}>
                        <td className="mono">{index + 1}</td>
                        <td className="stats-wrong">{item.wrong || '—'}</td>
                        <td className="stats-correct">{item.correct || '—'}</td>
                        <td className="mono">{item.count}</td>
                        <td className="mono">{item.students}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="stats-block">
            <h5>個人弱項（G3）</h5>
            <div className="stats-scroll stats-scroll--tall">
              <table className="table stats-table">
                <thead>
                  <tr>
                    <th className="w-seat">座號</th>
                    <th>姓名</th>
                    <th>狀態</th>
                    <th>總分</th>
                    <th>等第</th>
                    <th>前三弱項</th>
                    <th>錯字</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.seat} className={row.counted ? '' : 'stats-row--muted'}>
                      <td className="mono">{row.seat}</td>
                      <td>{row.name}</td>
                      <td>
                        <span className={`status status--${row.status}`}>
                          {row.status === 'missing' ? '未匯入' : STATUS_LABELS[row.status]}
                        </span>
                        {!row.counted && row.imported && (
                          <span className="stats-note"> 不計入</span>
                        )}
                      </td>
                      <td className="mono">{value(row.score)}</td>
                      <td>{row.grade ?? '—'}</td>
                      <td>
                        <div className="stats-personal">
                          {row.counted ? (
                            row.weaknesses.length > 0 ? (
                              row.weaknesses.map((item) => (
                                <span key={item.key} className="stats-weakness">
                                  {item.label} <strong>{item.count}</strong>
                                </span>
                              ))
                            ) : (
                              <span className="muted">無弱項批注</span>
                            )
                          ) : (
                            <span className="muted">未計入</span>
                          )}
                        </div>
                      </td>
                      <td className="mono">{row.counted ? row.counts.typo : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {exported && (
            <p className="audit-meta">
              CSV：{exported.dir}（{exported.files.join('、')}）
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** 作業層級的批次檢查面板；不另開 modal，直接接在匯入佇列下方。 */
function AuditPanel({
  audit,
  busy,
  filter,
  elapsedMs,
  run,
  onFilter,
  onAudit,
  onReview
}: {
  audit: AssignmentAudit | null
  busy: boolean
  filter: AuditFilter
  elapsedMs: number | null
  run: number
  onFilter: (filter: AuditFilter) => void
  onAudit: () => void
  onReview: (seat: string) => void
}): JSX.Element {
  const rows = audit
    ? filter === 'problems'
      ? audit.rows.filter((row) => row.blocked)
      : audit.rows
    : []
  const totals = audit?.totals

  const checkedAt = audit
    ? new Date(audit.generatedAt).toLocaleTimeString('zh-TW', { hour12: false })
    : ''

  return (
    <div className="audit-panel" data-run={run}>
      <div className="audit-head">
        <div>
          <h4>批次檢查</h4>
          <p className="audit-meta" data-run={run}>
            {audit ? `檢查於 ${checkedAt}` : '尚未檢查'}
            {elapsedMs !== null ? ` · ${elapsedMs} ms` : ''}
            {audit ? ` · 顯示 ${rows.length} / ${audit.rows.length} 份` : ''}
          </p>
        </div>
        <div className="card-actions">
          <button
            className={filter === 'problems' ? 'small primary' : 'small'}
            onClick={() => onFilter('problems')}
          >
            只看有問題
          </button>
          <button
            className={filter === 'all' ? 'small primary' : 'small'}
            onClick={() => onFilter('all')}
          >
            全部
          </button>
          <button className="small" disabled={busy} onClick={onAudit}>
            {busy ? '檢查中…' : '重新檢查'}
          </button>
        </div>
      </div>

      {totals && (
        <div className="queue-counts audit-stats">
          <span className="queue-chip">在學 {totals.students}</span>
          <span className="queue-chip done">已匯入 {totals.imported}</span>
          <span className="queue-chip pending">待批 {totals.pending}</span>
          <span className="queue-chip grading">批閱中 {totals.grading}</span>
          <span className="queue-chip done">已批 {totals.done}</span>
          {totals.missing > 0 && (
            <span className="queue-chip missing">未匯入 {totals.missing}</span>
          )}
          <span className={`queue-chip ${totals.problems > 0 ? 'problem' : 'clean'}`}>
            問題 {totals.problems}
          </span>
          {totals.warnings > 0 && (
            <span className="queue-chip pending">提醒 {totals.warnings}</span>
          )}
          <span className={`audit-flag ${audit?.clean ? 'is-clean' : 'is-blocked'}`}>
            {audit?.clean ? '乾淨：是' : '乾淨：否'}
          </span>
        </div>
      )}

      {!audit ? (
        <p className="muted">{busy ? '掃描整班作品中…' : '尚未取得檢查結果'}</p>
      ) : (
        <table className="table audit-table">
          <thead>
            <tr>
              <th className="w-seat">座號</th>
              <th>姓名</th>
              <th>狀態</th>
              <th>類型</th>
              <th>說明</th>
              <th className="w-op" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  {filter === 'problems' ? '沒有需要處理的問題' : '沒有作品'}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const kinds = [...new Set(row.issues.map((issue) => AUDIT_ISSUE_LABELS[issue.type]))]
              return (
                <tr
                  key={row.seat}
                  className={row.blocked ? 'audit-row audit-row--blocked' : 'audit-row'}
                >
                  <td className="mono">{row.seat}</td>
                  <td>{row.name}</td>
                  <td>
                    {row.status === 'missing' ? (
                      <span className="status status--missing">未匯入</span>
                    ) : (
                      <span className={`status status--${row.status}`}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    )}
                  </td>
                  <td className="audit-kinds">{kinds.join('、') || '—'}</td>
                  <td>
                    {row.issues.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      row.issues.map((issue, index) => (
                        <div
                          key={`${issue.type}-${index}`}
                          className={`audit-issue ${
                            issue.blocking ? 'audit-issue--blocking' : 'audit-issue--warning'
                          }`}
                        >
                          {issue.message}
                        </div>
                      ))
                    )}
                  </td>
                  <td className="right">
                    {row.imported ? (
                      <button className="small audit-review" onClick={() => onReview(row.seat)}>
                        前往批閱
                      </button>
                    ) : (
                      <span className="muted small-text">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
