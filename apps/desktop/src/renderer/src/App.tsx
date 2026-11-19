import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import {
  AUDIT_ISSUE_LABELS,
  RUBRIC_PRESET_LABELS,
  RUBRIC_PRESET_ORDER,
  RUBRIC_PRESETS,
  type AssignmentAudit,
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

  const selectedIdRef = useRef<string | null>(null)
  const selectedAssignmentRef = useRef<string | null>(null)
  const auditSeqRef = useRef(0)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    selectedAssignmentRef.current = selectedAssignmentId
  }, [selectedAssignmentId])
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

  const handleSelectAssignment = (id: string): void => {
    auditSeqRef.current += 1
    setSelectedAssignmentId(id)
    setAuditOpen(false)
    setAudit(null)
    setAuditMs(null)
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
      setToast({ kind: 'ok', text: '已重新掃描 inbox' })
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
              // 批次檢查面板若開著，回到工作區時自動重跑。
              if (auditOpen) runAudit()
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
            <p className="brand-sub">M4 批次檢查</p>
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
              <button onClick={handleClose}>關閉資料庫</button>
            </>
          ) : (
            <button className="primary" onClick={handleOpen}>
              開啟資料庫
            </button>
          )}
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
                    assignment={selectedAssignment}
                    works={works}
                    status={importStatus}
                    busy={busy}
                    audit={audit}
                    auditOpen={auditOpen}
                    auditBusy={auditBusy}
                    auditFilter={auditFilter}
                    auditMs={auditMs}
                    auditRun={auditRun}
                    onAudit={runAudit}
                    onAuditFilter={setAuditFilter}
                    onOpenInbox={handleOpenInbox}
                    onSimulate={handleSimulate}
                    onRefresh={handleRefreshInbox}
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
  assignment,
  works,
  status,
  busy,
  audit,
  auditOpen,
  auditBusy,
  auditFilter,
  auditMs,
  auditRun,
  onAudit,
  onAuditFilter,
  onOpenInbox,
  onSimulate,
  onRefresh,
  onReview,
  onFeedback
}: {
  assignment: AssignmentSummary
  works: WorkSummary[]
  status: ImportStatus | null
  busy: boolean
  audit: AssignmentAudit | null
  auditOpen: boolean
  auditBusy: boolean
  auditFilter: AuditFilter
  auditMs: number | null
  auditRun: number
  onAudit: () => void
  onAuditFilter: (filter: AuditFilter) => void
  onOpenInbox: () => void
  onSimulate: () => void
  onRefresh: () => void
  onReview: (seat: string) => void
  onFeedback: (seat: string) => void
}): JSX.Element {
  const counts = { pending: 0, grading: 0, done: 0 }
  for (const work of works) counts[work.status] += 1

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
          <button className="small" disabled={busy || auditBusy} onClick={onAudit}>
            {auditBusy ? '檢查中…' : auditOpen ? '重新檢查' : '批次檢查'}
          </button>
          <button className="small" disabled={busy} onClick={onOpenInbox}>
            開啟 inbox
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
