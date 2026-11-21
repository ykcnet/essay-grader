import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Circle, Image as KonvaImage, Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import {
  ANNOTATION_CATEGORIES,
  ANNOTATION_CATEGORY_LABELS,
  COMMENT_SUBTYPES,
  SENTENCE_SUBTYPES,
  STRUCTURE_SUBTYPES
} from '@essay-grader/core/constants'
import {
  LIBRARY_LABELS,
  LIBRARY_MODE_LABELS,
  RUBRIC_PRESET_LABELS,
  RUBRIC_PRESET_ORDER,
  RUBRIC_PRESETS
} from '@essay-grader/core'
import type { RubricPresetBaseId } from '@essay-grader/core'
import {
  calcDeduction,
  computeScore,
  countFinalChars,
  resolveGrade,
  sortGradeBands,
  validateGradeBands,
  validateWork
} from '@essay-grader/core/review'
import type {
  Annotation,
  AnnotationCategory,
  AnnotationMeta,
  AssignmentFile,
  GradeBand,
  LibraryEntry,
  LibraryFile,
  LibraryId,
  LibraryMode,
  LibraryPayload,
  Rubric,
  WorkFile,
  WorkSummary
} from '@essay-grader/core'
import './review.css'

interface ReviewViewProps {
  classId: string
  assignmentId: string
  initialSeat: string
  onExit: (message?: string) => void
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
type FocusTarget = 'annotation' | 'final'
type Notice = { kind: 'ok' | 'error' | 'info'; text: string }

interface DraftMeta {
  original: string
  revised: string
  reason: string
}

const STATUS_LABELS: Record<WorkSummary['status'], string> = {
  pending: '待批',
  grading: '批閱中',
  done: '已批'
}

const CATEGORY_COLORS: Record<AnnotationCategory, string> = {
  typo: '#c0392b',
  sentence: '#2b6cb0',
  structure: '#7c3aed',
  praise: '#2e7d5b',
  comment: '#b7791f',
  other: '#5c6b7a'
}

/** 快捷鍵 1–5 只涵蓋五類固定批注（不含 other）。 */
const SHORTCUT_CATEGORIES = ANNOTATION_CATEGORIES.slice(0, 5)

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const errorText = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const subtypeOptions = (
  category: AnnotationCategory
): readonly { id: string; label: string }[] => {
  if (category === 'sentence') return SENTENCE_SUBTYPES
  if (category === 'structure') return STRUCTURE_SUBTYPES
  if (category === 'comment') return COMMENT_SUBTYPES
  return []
}

const subtypeLabel = (category: AnnotationCategory, subtype: string | undefined): string => {
  if (!subtype) return ''
  return subtypeOptions(category).find((item) => item.id === subtype)?.label ?? subtype
}

const emptyDraftMeta = (): DraftMeta => ({ original: '', revised: '', reason: '' })

const RUBRIC_ITEM_NAMES: Record<string, string> = {
  content: '內容',
  structure: '結構',
  language: '語言'
}

/** 例：「內容 40／結構 30／語言 30」。 */
const rubricItemsText = (rubric: Rubric): string =>
  rubric.items
    .map((item) => `${RUBRIC_ITEM_NAMES[item.id] ?? item.name} ${item.max}`)
    .join('／')

/** 例：「優 85 · 甲 70 · 乙 0」，一律由高到低。 */
const rubricGradesText = (rubric: Rubric): string =>
  sortGradeBands(rubric.grades)
    .map((grade) => `${grade.label} ${grade.min}`)
    .join(' · ') || '—'

type RubricFormPreset = RubricPresetBaseId | 'custom'

/** 等第編輯列；key 只用於 React 清單，不落盤。 */
interface GradeDraft {
  key: string
  label: string
  min: string
}

interface RubricForm {
  preset: RubricFormPreset
  content: string
  structure: string
  language: string
  typo: string
  punct: string
  cap: string
  grades: GradeDraft[]
}

const toGradeDrafts = (grades: readonly GradeBand[]): GradeDraft[] =>
  grades.map((grade) => ({
    key: crypto.randomUUID(),
    label: grade.label,
    min: String(grade.min)
  }))

/** 舊 id（junior／senior／vocational）視為 balanced。 */
const LEGACY_PRESET_IDS = ['junior-default', 'senior-default', 'vocational-default']
const detectPreset = (rubric: Rubric): RubricFormPreset => {
  if (LEGACY_PRESET_IDS.includes(rubric.id)) return 'balanced'
  return RUBRIC_PRESET_ORDER.find((id) => RUBRIC_PRESETS[id].id === rubric.id) ?? 'custom'
}

const formFromRubric = (rubric: Rubric): RubricForm => {
  const maxOf = (id: string): string =>
    String(rubric.items.find((item) => item.id === id)?.max ?? '')
  return {
    preset: detectPreset(rubric),
    content: maxOf('content'),
    structure: maxOf('structure'),
    language: maxOf('language'),
    typo: String(rubric.deduction.typo_per),
    punct: String(rubric.deduction.punct_per),
    cap: String(rubric.deduction.cap),
    grades: toGradeDrafts(rubric.grades)
  }
}

/** 切換 preset 只換配分；等第門檻沿用畫面上已編輯的內容。 */
const presetForm = (preset: RubricPresetBaseId, grades: GradeDraft[]): RubricForm => {
  const rubric = RUBRIC_PRESETS[preset]
  const maxOf = (id: string): string =>
    String(rubric.items.find((item) => item.id === id)?.max ?? '')
  return {
    preset,
    content: maxOf('content'),
    structure: maxOf('structure'),
    language: maxOf('language'),
    typo: String(rubric.deduction.typo_per),
    punct: String(rubric.deduction.punct_per),
    cap: String(rubric.deduction.cap),
    grades
  }
}

const toNumber = (value: string): number => {
  const parsed = Number(value)
  return value.trim() === '' || !Number.isFinite(parsed) ? Number.NaN : parsed
}

/** 由目前畫面狀態組出要落盤的 work；分數一律用 core 重算。 */
function assembleWork(
  work: WorkFile,
  scoreItems: Record<string, string>,
  override: string,
  rubric: Rubric
): WorkFile {
  const items: Record<string, number> = {}
  for (const [key, raw] of Object.entries(scoreItems)) {
    if (raw.trim() === '') continue
    const value = Number(raw)
    if (Number.isFinite(value)) items[key] = value
  }

  const overrideNumber = override.trim() === '' ? null : Number(override)
  const overrideValue =
    overrideNumber !== null && Number.isFinite(overrideNumber) ? overrideNumber : null
  const computed = computeScore(work.annotations, items, rubric, overrideValue)

  return {
    ...work,
    scores: {
      items,
      deduction: {
        typo: calcDeduction(work.annotations, rubric, null),
        punct: 0,
        override: overrideValue
      },
      total: computed.total,
      grade: computed.grade
    },
    updated_at: new Date().toISOString()
  }
}

export default function ReviewView({
  classId,
  assignmentId,
  initialSeat,
  onExit
}: ReviewViewProps): JSX.Element {
  const [assignment, setAssignment] = useState<AssignmentFile | null>(null)
  const [works, setWorks] = useState<WorkSummary[]>([])
  const [work, setWork] = useState<WorkFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)

  const [dirty, setDirty] = useState(false)
  const [revision, setRevision] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const [pageImage, setPageImage] = useState<HTMLImageElement | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftAnchor, setDraftAnchor] = useState<{ x: number; y: number } | null>(null)
  const [draftCategory, setDraftCategory] = useState<AnnotationCategory>('typo')
  const [draftSubtype, setDraftSubtype] = useState('')
  const [draftText, setDraftText] = useState('')
  const [draftMeta, setDraftMeta] = useState<DraftMeta>(emptyDraftMeta)

  const [scoreItems, setScoreItems] = useState<Record<string, string>>({})
  const [override, setOverride] = useState('')
  const [reuse, setReuse] = useState<{ count: number; seats: string[] }>({ count: 0, seats: [] })
  const [issues, setIssues] = useState<string[]>([])

  const [rubricOpen, setRubricOpen] = useState(false)
  const [rubricForm, setRubricForm] = useState<RubricForm>({
    preset: 'balanced',
    content: '40',
    structure: '30',
    language: '30',
    typo: '0.5',
    punct: '0.5',
    cap: '10',
    grades: []
  })
  const [rubricError, setRubricError] = useState('')
  const [rubricSaving, setRubricSaving] = useState(false)
  const [rubricConfirmCount, setRubricConfirmCount] = useState(0)

  const [libraryOpen, setLibraryOpen] = useState(true)
  const [library, setLibrary] = useState<LibraryFile | null>(null)
  const [libraryId, setLibraryId] = useState<LibraryId>('senior')
  const [libraryMode, setLibraryMode] = useState<LibraryMode>('auto')
  const [libraryVersion, setLibraryVersion] = useState('')
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [libraryRequest, setLibraryRequest] = useState(0)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryCategory, setLibraryCategory] = useState<AnnotationCategory>('typo')

  const stageRef = useRef<Konva.Stage | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const annotationTextRef = useRef<HTMLTextAreaElement | null>(null)
  const finalTextRef = useRef<HTMLTextAreaElement | null>(null)

  const focusRef = useRef<FocusTarget>('final')
  const dirtyRef = useRef(false)
  const revisionRef = useRef(0)
  const pageLoadSeqRef = useRef(0)
  const pastRef = useRef<Annotation[][]>([])
  const futureRef = useRef<Annotation[][]>([])
  const lastKeyRef = useRef<{ key: string; at: number } | null>(null)
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined)

  const snapshotRef = useRef({ work, scoreItems, override, assignment })
  snapshotRef.current = { work, scoreItems, override, assignment }

  const markDirty = useCallback((): void => {
    dirtyRef.current = true
    revisionRef.current += 1
    setDirty(true)
    setRevision((value) => value + 1)
  }, [])

  const saveNow = useCallback(async (): Promise<boolean> => {
    const snapshot = snapshotRef.current
    if (!snapshot.work || !snapshot.assignment) return false

    const targetSeat = snapshot.work.seat
    const rev = revisionRef.current
    setSaveState('saving')

    try {
      const payload = assembleWork(
        snapshot.work,
        snapshot.scoreItems,
        snapshot.override,
        snapshot.assignment.rubric
      )
      await window.electronAPI.work.save(
        payload.class_id,
        payload.assignment_id,
        payload.seat,
        payload
      )
      if (snapshotRef.current.work?.seat === targetSeat) {
        setSaveState('saved')
        if (revisionRef.current === rev) {
          dirtyRef.current = false
          setDirty(false)
        }
      }
      return true
    } catch (saveError) {
      setSaveState('error')
      setNotice({ kind: 'error', text: `儲存失敗：${errorText(saveError)}` })
      return false
    }
  }, [])

  // ---- 載入作品與作業設定 ------------------------------------------------

  const loadSeat = useCallback(
    async (seat: string): Promise<void> => {
      if (dirtyRef.current) await saveNow()
      setLoading(true)
      setError('')

      try {
        const raw = (await window.electronAPI.work.get(classId, assignmentId, seat)) as WorkFile
        let next = raw

        // 開啟待批作品時自動進入批閱中，並立即落盤。
        if (next.status === 'pending') {
          next = { ...next, status: 'grading', updated_at: new Date().toISOString() }
          await window.electronAPI.work.save(classId, assignmentId, seat, next)
        }

        dirtyRef.current = false
        revisionRef.current = 0
        setDirty(false)
        setRevision(0)

        setWork(next)
        const itemRaw: Record<string, string> = {}
        for (const [key, value] of Object.entries(next.scores?.items ?? {})) {
          itemRaw[key] = String(value)
        }
        setScoreItems(itemRaw)
        const overrideValue = next.scores?.deduction.override
        setOverride(overrideValue === null || overrideValue === undefined ? '' : String(overrideValue))

        setCurrentPage(0)
        setSelectedId(null)
        setDraftAnchor(null)
        setDraftText('')
        setDraftMeta(emptyDraftMeta())
        setIssues([])
        setReuse({ count: 0, seats: [] })
        setPageImage(null)
        setSaveState('saved')
        setWorks((prev) =>
          prev.map((item) =>
            item.seat === seat ? { ...item, status: next.status, updatedAt: next.updated_at } : item
          )
        )
      } catch (loadError) {
        setError(errorText(loadError))
      } finally {
        setLoading(false)
      }
    },
    [assignmentId, classId, saveNow]
  )

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [assignmentResult, list] = await Promise.all([
          window.electronAPI.db.loadAssignment(classId, assignmentId) as Promise<{
            data: AssignmentFile
          }>,
          window.electronAPI.work.list(classId, assignmentId) as Promise<WorkSummary[]>
        ])
        if (cancelled) return
        setAssignment(assignmentResult.data)
        setWorks(list)
        await loadSeat(initialSeat)
      } catch (loadError) {
        if (!cancelled) {
          setError(errorText(loadError))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [assignmentId, classId, initialSeat, loadSeat])

  // 自動儲存：每次變更後 600ms 落盤。
  useEffect(() => {
    if (!dirty) return
    setSaveState('dirty')
    const timer = setTimeout(() => {
      void saveNow()
    }, 600)
    return () => clearTimeout(timer)
  }, [dirty, revision, saveNow])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4500)
    return () => clearTimeout(timer)
  }, [notice])

  // ---- 目前頁面與影像 ----------------------------------------------------

  const pages = work?.pages ?? []
  const page = pages[currentPage] ?? null
  const annotations = work?.annotations ?? []
  const pageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.page_id === page?.id),
    [annotations, page?.id]
  )
  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null

  useEffect(() => {
    if (!work || !page) {
      setPageImage(null)
      return
    }

    let cancelled = false
    const seq = ++pageLoadSeqRef.current
    setPageLoading(true)

    void window.electronAPI.work
      .page(work.class_id, work.assignment_id, work.seat, page.id)
      .then((result: { dataUrl: string }) => {
        if (cancelled || seq !== pageLoadSeqRef.current) return
        const image = new Image()
        image.onload = () => {
          if (cancelled || seq !== pageLoadSeqRef.current) return
          setPageImage(image)
          setPageLoading(false)
        }
        image.onerror = () => {
          if (cancelled) return
          setPageImage(null)
          setPageLoading(false)
          setNotice({ kind: 'error', text: `頁面 ${page.id} 讀取失敗` })
        }
        image.src = result.dataUrl
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setPageImage(null)
        setPageLoading(false)
        setNotice({ kind: 'error', text: `頁面讀取失敗：${errorText(loadError)}` })
      })

    return () => {
      cancelled = true
    }
  }, [work?.seat, page?.id])

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const update = (): void =>
      setStageSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 以「符合視窗」為 100%，縮放範圍 0.2–8 倍。
  const base = useMemo(() => {
    if (!pageImage || stageSize.width < 40 || stageSize.height < 40) return null
    const padding = 32
    const fit = Math.min(
      (stageSize.width - padding * 2) / pageImage.naturalWidth,
      (stageSize.height - padding * 2) / pageImage.naturalHeight
    )
    return {
      width: pageImage.naturalWidth * fit,
      height: pageImage.naturalHeight * fit
    }
  }, [pageImage, stageSize])

  useEffect(() => {
    if (!base) return
    setView({
      x: (stageSize.width - base.width) / 2,
      y: (stageSize.height - base.height) / 2,
      scale: 1
    })
  }, [base, stageSize])

  // ---- 縮放、平移、翻頁 --------------------------------------------------

  const resetView = useCallback((): void => {
    if (!base) return
    setView({
      x: (stageSize.width - base.width) / 2,
      y: (stageSize.height - base.height) / 2,
      scale: 1
    })
  }, [base, stageSize])

  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number): void => {
    setView((previous) => {
      const scale = clamp(previous.scale * factor, 0.2, 8)
      if (scale === previous.scale) return previous
      const contentX = (anchorX - previous.x) / previous.scale
      const contentY = (anchorY - previous.y) / previous.scale
      return {
        x: anchorX - contentX * scale,
        y: anchorY - contentY * scale,
        scale
      }
    })
  }, [])

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>): void => {
    event.evt.preventDefault()
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return
    zoomAt(event.evt.deltaY > 0 ? 1 / 1.12 : 1.12, pointer.x, pointer.y)
  }

  const handleStageClick = (event: Konva.KonvaEventObject<MouseEvent>): void => {
    if (event.target.name() === 'annotation') return
    if (!base) return
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return

    const x = (pointer.x - view.x) / view.scale / base.width
    const y = (pointer.y - view.y) / view.scale / base.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return

    setSelectedId(null)
    setDraftAnchor({ x, y })
    setDraftText('')
    setDraftMeta(emptyDraftMeta())
    setIssues([])
    focusRef.current = 'annotation'
  }

  const changePage = useCallback(
    (delta: number): void => {
      const next = clamp(currentPage + delta, 0, Math.max(0, pages.length - 1))
      if (next === currentPage) return
      setCurrentPage(next)
      setSelectedId(null)
      setDraftAnchor(null)
    },
    [currentPage, pages.length]
  )

  // ---- 批注歷史（最多 100 步） -------------------------------------------

  const commitAnnotations = useCallback(
    (next: Annotation[], historyKey: string): void => {
      const current = snapshotRef.current.work?.annotations ?? []
      const now = Date.now()
      const last = lastKeyRef.current
      const coalesce = Boolean(last && last.key === historyKey && now - last.at < 800)

      if (!coalesce) {
        pastRef.current.push(current)
        if (pastRef.current.length > 100) pastRef.current.shift()
        futureRef.current = []
      }
      lastKeyRef.current = historyKey ? { key: historyKey, at: now } : null

      setWork((previous) => (previous ? { ...previous, annotations: next } : previous))
      markDirty()
      setIssues([])
    },
    [markDirty]
  )

  const undo = useCallback((): void => {
    const previous = pastRef.current.pop()
    if (!previous) return
    const current = snapshotRef.current.work?.annotations ?? []
    futureRef.current.push(current)
    lastKeyRef.current = null
    setWork((value) => (value ? { ...value, annotations: previous } : value))
    if (selectedId && !previous.some((annotation) => annotation.id === selectedId)) {
      setSelectedId(null)
      setDraftAnchor(null)
    }
    markDirty()
  }, [markDirty, selectedId])

  const redo = useCallback((): void => {
    const next = futureRef.current.pop()
    if (!next) return
    const current = snapshotRef.current.work?.annotations ?? []
    pastRef.current.push(current)
    if (pastRef.current.length > 100) pastRef.current.shift()
    lastKeyRef.current = null
    setWork((value) => (value ? { ...value, annotations: next } : value))
    if (selectedId && !next.some((annotation) => annotation.id === selectedId)) {
      setSelectedId(null)
      setDraftAnchor(null)
    }
    markDirty()
  }, [markDirty, selectedId])

  // ---- 批注編輯 ----------------------------------------------------------

  const updateSelected = useCallback(
    (patch: Partial<Annotation>, field: string): void => {
      if (!selected) return
      commitAnnotations(
        annotations.map((annotation) =>
          annotation.id === selected.id ? { ...annotation, ...patch } : annotation
        ),
        `annotation:${selected.id}:${field}`
      )
    },
    [annotations, commitAnnotations, selected]
  )

  const setCategory = useCallback(
    (category: AnnotationCategory): void => {
      setLibraryCategory(category)
      if (selected) {
        updateSelected(
          {
            category,
            subtype: subtypeOptions(category).some((item) => item.id === selected.subtype)
              ? selected.subtype
              : undefined
          },
          'category'
        )
        return
      }
      setDraftCategory(category)
      setDraftSubtype('')
    },
    [selected, updateSelected]
  )

  const addAnnotation = (): void => {
    if (!work || !page || !draftAnchor) return

    const text = draftText.trim()
    const hasMeta = Boolean(
      draftMeta.original.trim() || draftMeta.revised.trim() || draftMeta.reason.trim()
    )
    if (!text && !hasMeta) {
      setNotice({ kind: 'error', text: '請至少輸入批注文字或改寫內容' })
      return
    }

    const meta: AnnotationMeta = {}
    if (draftCategory === 'sentence') {
      if (draftMeta.original.trim()) meta.original = draftMeta.original.trim()
      if (draftMeta.revised.trim()) meta.revised = draftMeta.revised.trim()
      if (draftMeta.reason.trim()) meta.reason = draftMeta.reason.trim()
    }

    const annotation: Annotation = {
      id: crypto.randomUUID(),
      page_id: page.id,
      anchor: draftAnchor,
      category: draftCategory,
      subtype: draftSubtype || undefined,
      text,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
      created_at: new Date().toISOString()
    }

    commitAnnotations([...annotations, annotation], `add:${annotation.id}`)
    setSelectedId(annotation.id)
    setDraftAnchor(null)
    setDraftText('')
    setDraftMeta(emptyDraftMeta())
  }

  const deleteSelected = (): void => {
    if (!selected) return
    commitAnnotations(
      annotations.filter((annotation) => annotation.id !== selected.id),
      `delete:${selected.id}`
    )
    setSelectedId(null)
    setDraftAnchor(null)
  }

  // ---- 鍵盤快捷鍵 --------------------------------------------------------

  keyHandlerRef.current = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    const typing = Boolean(
      target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
    )
    const modifier = event.ctrlKey || event.metaKey

    if (modifier && (event.key === 'z' || event.key === 'Z')) {
      // 輸入框內保留原生文字復原，畫布上才操作批注歷史。
      if (typing) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (modifier && (event.key === 'y' || event.key === 'Y')) {
      if (typing) return
      event.preventDefault()
      redo()
      return
    }
    if (typing || modifier) return

    if (event.key === 'PageUp') {
      event.preventDefault()
      changePage(-1)
      return
    }
    if (event.key === 'PageDown') {
      event.preventDefault()
      changePage(1)
      return
    }
    if (/^[1-5]$/.test(event.key)) {
      const category = SHORTCUT_CATEGORIES[Number(event.key) - 1]
      if (category) {
        event.preventDefault()
        setCategory(category)
      }
    }
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent): void => keyHandlerRef.current(event)
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  // ---- 評分、總評、重複檢查 ---------------------------------------------

  const rubric = assignment?.rubric ?? null
  const typoCount = annotations.filter((annotation) => annotation.category === 'typo').length
  const autoDeduction = rubric ? calcDeduction(annotations, rubric, null) : 0
  const computed = useMemo(() => {
    if (!rubric) return null
    const items: Record<string, number> = {}
    for (const [key, raw] of Object.entries(scoreItems)) {
      if (raw.trim() === '') continue
      const value = Number(raw)
      if (Number.isFinite(value)) items[key] = value
    }
    const overrideNumber = override.trim() === '' ? null : Number(override)
    const overrideValue =
      overrideNumber !== null && Number.isFinite(overrideNumber) ? overrideNumber : null
    return computeScore(annotations, items, rubric, overrideValue)
  }, [annotations, override, rubric, scoreItems])

  // ---- 量規調整 ----------------------------------------------------------

  const rubricItems = {
    content: toNumber(rubricForm.content),
    structure: toNumber(rubricForm.structure),
    language: toNumber(rubricForm.language)
  }
  const rubricDeduction = {
    typo: toNumber(rubricForm.typo),
    punct: toNumber(rubricForm.punct),
    cap: toNumber(rubricForm.cap)
  }
  const rubricItemsOk = Object.values(rubricItems).every(
    (value) => Number.isFinite(value) && value > 0
  )
  const rubricDeductionOk =
    Number.isFinite(rubricDeduction.typo) &&
    rubricDeduction.typo >= 0 &&
    Number.isFinite(rubricDeduction.punct) &&
    rubricDeduction.punct >= 0 &&
    Number.isFinite(rubricDeduction.cap) &&
    rubricDeduction.cap >= 0 &&
    rubricDeduction.cap <= 100
  const rubricSum = rubricItemsOk
    ? Math.round(
        (rubricItems.content + rubricItems.structure + rubricItems.language) * 100
      ) / 100
    : Number.NaN
  const rubricSumOk = Number.isFinite(rubricSum) && Math.abs(rubricSum - 100) < 1e-6

  const gradeBands = rubricForm.grades.map((grade) => ({
    label: grade.label.trim(),
    min: toNumber(grade.min)
  }))
  const gradeErrors = validateGradeBands(gradeBands)
  const gradesValid = gradeErrors.length === 0

  const rubricFormValid = rubricItemsOk && rubricDeductionOk && rubricSumOk && gradesValid

  // 預覽只取目前可用的門檻；即使尚未通過驗證也能先看落在哪一級。
  const previewGrades = sortGradeBands(
    gradeBands.filter(
      (grade) =>
        grade.label !== '' &&
        Number.isFinite(grade.min) &&
        grade.min >= 0 &&
        grade.min <= 100
    )
  )
  const previewTotal = computed?.total ?? null
  const previewGrade =
    rubric && previewTotal !== null && previewGrades.length > 0
      ? resolveGrade(previewTotal, { ...rubric, grades: previewGrades })
      : undefined

  const openRubricEditor = (): void => {
    if (!assignment) return
    setRubricForm(formFromRubric(assignment.rubric))
    setRubricError('')
    setRubricConfirmCount(0)
    setRubricOpen(true)
  }

  const closeRubricEditor = (): void => {
    setRubricOpen(false)
    setRubricConfirmCount(0)
    setRubricError('')
  }

  const changeRubricPreset = (value: string): void => {
    if (value === 'custom') {
      setRubricForm((previous) => ({ ...previous, preset: 'custom' }))
    } else {
      setRubricForm((previous) => presetForm(value as RubricPresetBaseId, previous.grades))
    }
    setRubricError('')
    setRubricConfirmCount(0)
  }

  const changeRubricField = (
    field: 'content' | 'structure' | 'language' | 'typo' | 'punct' | 'cap',
    value: string
  ): void => {
    // 手動改數字即視為自訂，避免 rubric.id 仍宣稱是某個 preset。
    setRubricForm((previous) => ({ ...previous, [field]: value, preset: 'custom' }))
    setRubricError('')
    setRubricConfirmCount(0)
  }

  const changeGrade = (key: string, field: 'label' | 'min', value: string): void => {
    setRubricForm((previous) => ({
      ...previous,
      grades: previous.grades.map((grade) =>
        grade.key === key ? { ...grade, [field]: value } : grade
      )
    }))
    setRubricError('')
    setRubricConfirmCount(0)
  }

  const addGrade = (): void => {
    setRubricForm((previous) => ({
      ...previous,
      grades: [...previous.grades, { key: crypto.randomUUID(), label: '', min: '0' }]
    }))
    setRubricError('')
    setRubricConfirmCount(0)
  }

  const removeGrade = (key: string): void => {
    setRubricForm((previous) => ({
      ...previous,
      grades: previous.grades.filter((grade) => grade.key !== key)
    }))
    setRubricError('')
    setRubricConfirmCount(0)
  }

  const buildRubric = (): Rubric | null => {
    if (!assignment || !rubricFormValid) return null
    return {
      id: rubricForm.preset === 'custom' ? 'custom' : RUBRIC_PRESETS[rubricForm.preset].id,
      items: [
        { id: 'content', name: '內容與思想', max: rubricItems.content },
        { id: 'structure', name: '結構與組織', max: rubricItems.structure },
        { id: 'language', name: '語言與表達', max: rubricItems.language }
      ],
      deduction: {
        typo_per: rubricDeduction.typo,
        punct_per: rubricDeduction.punct,
        cap: rubricDeduction.cap
      },
      grades: sortGradeBands(gradeBands)
    }
  }

  const applyRubric = async (): Promise<void> => {
    const next = buildRubric()
    if (!next) return

    setRubricSaving(true)
    setRubricError('')
    try {
      const updated = (await window.electronAPI.db.updateRubric(
        classId,
        assignmentId,
        next
      )) as AssignmentFile
      setAssignment(updated)
      setRubricOpen(false)
      setRubricConfirmCount(0)
      setNotice({
        kind: 'ok',
        text: '量規與等第門檻已更新；目前這份的預覽已用新量規重算，完成批閱後才寫入。'
      })
    } catch (saveError) {
      setRubricError(errorText(saveError))
    } finally {
      setRubricSaving(false)
    }
  }

  const handleRubricSave = async (): Promise<void> => {
    if (!rubricFormValid) return

    try {
      // 以磁碟上的最新作品清單判斷，避免 autosave 尚未反映在畫面上。
      const fresh = (await window.electronAPI.work.list(
        classId,
        assignmentId
      )) as WorkSummary[]
      setWorks(fresh)
      const graded = fresh.filter((item) => item.hasScores || item.status === 'done').length
      if (graded > 0) {
        setRubricConfirmCount(graded)
        return
      }
      await applyRubric()
    } catch (checkError) {
      setRubricError(errorText(checkError))
    }
  }

  const finalText = work?.final_comment?.text ?? ''
  const finalChars = countFinalChars(finalText)
  const minChars = assignment?.rules.final_min_chars ?? 30
  const reuseBlocked = Boolean(
    assignment && reuse.count >= assignment.rules.final_max_reuse
  )

  useEffect(() => {
    if (!work) return
    const text = work.final_comment?.text ?? ''
    if (!text.trim()) {
      setReuse({ count: 0, seats: [] })
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      void window.electronAPI.work
        .reuse(work.class_id, work.assignment_id, work.seat, text)
        .then((result: { count: number; seats: string[] }) => {
          if (!cancelled) setReuse(result)
        })
        .catch(() => undefined)
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [work?.seat, work?.final_comment?.text])

  const updateFinalText = (text: string): void => {
    setWork((previous) =>
      previous
        ? {
            ...previous,
            final_comment: {
              ...previous.final_comment,
              text
            }
          }
        : previous
    )
    markDirty()
  }

  const handleScoreChange = (id: string, value: string): void => {
    setScoreItems((previous) => ({ ...previous, [id]: value }))
    markDirty()
  }

  const currentCategory = selected?.category ?? draftCategory
  useEffect(() => {
    setLibraryCategory(currentCategory)
  }, [currentCategory, selectedId])

  // ---- 評語庫 ------------------------------------------------------------

  useEffect(() => {
    if (!libraryOpen) return
    let cancelled = false
    setLibraryLoading(true)
    setLibraryError('')

    void window.electronAPI.library
      .get(classId)
      .then((payload: LibraryPayload) => {
        if (cancelled) return
        setLibrary(payload.library)
        setLibraryId(payload.id)
        setLibraryMode(payload.mode)
        setLibraryVersion(payload.library.library_version)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setLibraryError(`評語庫載入失敗：${errorText(loadError)}`)
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [classId, libraryOpen, libraryRequest])

  /** 切換版本只重新載入評語庫，不動目前批注、分數或已插入文字。 */
  const changeLibraryMode = async (mode: LibraryMode): Promise<void> => {
    setLibraryMode(mode)
    setLibraryError('')
    try {
      const result = (await window.electronAPI.library.setMode(mode)) as { mode: LibraryMode }
      setLibraryMode(result.mode)
      setLibraryRequest((value) => value + 1)
    } catch (switchError) {
      setLibraryError(`切換評語庫版本失敗：${errorText(switchError)}`)
    }
  }

  const filteredEntries = useMemo(() => {
    if (!library) return []
    const query = libraryQuery.trim()
    return library.entries.filter(
      (entry) =>
        !entry.disabled &&
        entry.category === libraryCategory &&
        (!query ||
          entry.text.includes(query) ||
          entry.tags.some((tag) => tag.includes(query)))
    )
  }, [library, libraryCategory, libraryQuery])

  const insertAtCursor = (
    element: HTMLTextAreaElement | null,
    text: string,
    current: string,
    apply: (next: string) => void
  ): void => {
    const start = element?.selectionStart ?? current.length
    const end = element?.selectionEnd ?? current.length
    const next = `${current.slice(0, start)}${text}${current.slice(end)}`
    apply(next)
    if (element) {
      const caret = start + text.length
      requestAnimationFrame(() => {
        element.focus()
        element.setSelectionRange(caret, caret)
      })
    }
  }

  const insertLibrary = (entry: LibraryEntry): void => {
    if (focusRef.current === 'annotation' && selected) {
      insertAtCursor(annotationTextRef.current, entry.text, selected.text, (next) =>
        updateSelected({ text: next }, 'text')
      )
      return
    }
    if (focusRef.current === 'annotation' && draftAnchor) {
      insertAtCursor(annotationTextRef.current, entry.text, draftText, setDraftText)
      return
    }
    insertAtCursor(finalTextRef.current, entry.text, finalText, updateFinalText)
  }

  // ---- 完成批閱 ----------------------------------------------------------

  const handleComplete = async (): Promise<void> => {
    if (!work || !assignment) return

    try {
      if (dirtyRef.current) await saveNow()

      const latestReuse = (await window.electronAPI.work.reuse(
        work.class_id,
        work.assignment_id,
        work.seat,
        finalText
      )) as { count: number; seats: string[] }
      setReuse(latestReuse)

      const payload = assembleWork(work, scoreItems, override, assignment.rubric)
      const validation = validateWork(payload, assignment, latestReuse.count)
      setIssues(validation.issues)
      if (!validation.ok) {
        setNotice({ kind: 'error', text: '完成前還有項目要處理' })
        return
      }

      const done: WorkFile = {
        ...payload,
        status: 'done',
        updated_at: new Date().toISOString()
      }
      await window.electronAPI.work.save(done.class_id, done.assignment_id, done.seat, done)

      dirtyRef.current = false
      revisionRef.current = 0
      setDirty(false)
      setSaveState('saved')
      setWork(done)

      const list = (await window.electronAPI.work.list(classId, assignmentId)) as WorkSummary[]
      setWorks(list)
      const next = list.find((item) => item.seat !== done.seat && item.status !== 'done')
      if (next) {
        await loadSeat(next.seat)
      } else {
        onExit(`已完成 ${done.seat} ${done.name}，這份作業沒有其他待批作品`)
      }
    } catch (completeError) {
      setNotice({ kind: 'error', text: `完成批閱失敗：${errorText(completeError)}` })
    }
  }

  const switchSeat = async (seat: string): Promise<void> => {
    if (loading || seat === work?.seat) return
    await loadSeat(seat)
  }

  const handleExit = async (): Promise<void> => {
    if (dirtyRef.current) await saveNow()
    onExit()
  }

  const handleOpenFeedback = async (): Promise<void> => {
    if (!work) return
    if (dirtyRef.current) await saveNow()
    try {
      await window.electronAPI.feedback.open(work.class_id, work.assignment_id, work.seat)
    } catch (feedbackError) {
      setNotice({ kind: 'error', text: `開啟回饋單失敗：${errorText(feedbackError)}` })
    }
  }

  // ---- 畫面 --------------------------------------------------------------

  const displaySaveState = dirty && saveState === 'saved' ? 'dirty' : saveState
  const saveLabel =
    displaySaveState === 'saving'
      ? '儲存中…'
      : displaySaveState === 'dirty'
        ? '尚未儲存'
        : displaySaveState === 'error'
          ? '儲存失敗'
          : displaySaveState === 'saved'
            ? '已儲存'
            : ''
  const editMode: 'draft' | 'selected' | 'idle' = draftAnchor
    ? 'draft'
    : selected
      ? 'selected'
      : 'idle'
  const activeCategory = editMode === 'draft' ? draftCategory : selected?.category ?? draftCategory
  const activeSubtype = editMode === 'draft' ? draftSubtype : selected?.subtype ?? ''
  const activeSubtypeOptions = subtypeOptions(activeCategory)
  const selectedMeta = selected?.meta ?? {}

  if (error) {
    return (
      <div className="rv">
        <header className="rv-top">
          <button className="ghost" onClick={() => void handleExit()}>
            ← 返回佇列
          </button>
          <div className="rv-title">
            <strong>無法載入作品</strong>
            <span>
              {classId} · {assignmentId}
            </span>
          </div>
        </header>
        <div className="rv-error">
          <p>{error}</p>
          <button onClick={() => void loadSeat(initialSeat)}>重試</button>
          <button className="ghost" onClick={() => void handleExit()}>
            返回
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rv">
      <header className="rv-top">
        <button className="ghost" onClick={() => void handleExit()}>
          ← 返回佇列
        </button>
        <div className="rv-title">
          <strong>{assignment?.title ?? '批閱'}</strong>
          <span>
            {classId} · {assignmentId}
          </span>
        </div>
        <div className="rv-student">
          {work ? (
            <>
              <span className="rv-student-seat">{work.seat}</span>
              <span>{work.name}</span>
              <span className={`status status--${work.status}`}>{STATUS_LABELS[work.status]}</span>
            </>
          ) : (
            <span className="rv-muted">載入中…</span>
          )}
        </div>
        <span className={`rv-save rv-save--${displaySaveState}`}>{saveLabel}</span>
      </header>

      <div className="rv-body">
        <aside className="rv-queue">
          <div className="rv-queue-head">
            <h2>同作業作品</h2>
            <span>{works.length} 份</span>
          </div>
          <ul className="rv-queue-list">
            {works.map((item) => (
              <li key={item.seat}>
                <button
                  className={item.seat === work?.seat ? 'rv-queue-item active' : 'rv-queue-item'}
                  onClick={() => void switchSeat(item.seat)}
                  disabled={loading}
                >
                  <span className="rv-queue-seat">{item.seat}</span>
                  <span className="rv-queue-name">{item.name}</span>
                  <span className={`status status--${item.status}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                  <span className="rv-queue-pages">{item.pages} 頁</span>
                </button>
              </li>
            ))}
            {works.length === 0 && <li className="rv-muted rv-queue-empty">尚無作品</li>}
          </ul>
          <p className="rv-queue-tip">切換前會先自動儲存</p>
        </aside>

        <main className="rv-canvas">
          <div className="rv-tools">
            <button className="small" disabled={currentPage <= 0} onClick={() => changePage(-1)}>
              上一頁
            </button>
            <span className="rv-page-no">
              {pages.length > 0 ? `${currentPage + 1} / ${pages.length}` : '—'}
            </span>
            <button
              className="small"
              disabled={pages.length === 0 || currentPage >= pages.length - 1}
              onClick={() => changePage(1)}
            >
              下一頁
            </button>
            <span className="rv-divider" />
            <button
              className="small"
              onClick={() => zoomAt(1 / 1.25, stageSize.width / 2, stageSize.height / 2)}
            >
              −
            </button>
            <span className="rv-zoom">{Math.round(view.scale * 100)}%</span>
            <button
              className="small"
              onClick={() => zoomAt(1.25, stageSize.width / 2, stageSize.height / 2)}
            >
              ＋
            </button>
            <button className="small" onClick={resetView}>
              符合視窗
            </button>
            <span className="rv-tools-hint">滾輪縮放 · 拖曳平移</span>
          </div>

          <div className="rv-stage-wrap" ref={wrapRef}>
            {base && pageImage ? (
              <Stage
                ref={stageRef}
                width={stageSize.width}
                height={stageSize.height}
                x={view.x}
                y={view.y}
                scaleX={view.scale}
                scaleY={view.scale}
                draggable
                onWheel={handleWheel}
                onClick={handleStageClick}
                onDragEnd={(event) => {
                  const node = event.target
                  setView((previous) => ({ ...previous, x: node.x(), y: node.y() }))
                }}
              >
                <Layer>
                  <KonvaImage image={pageImage} width={base.width} height={base.height} />
                  {pageAnnotations.map((annotation) => {
                    const color = CATEGORY_COLORS[annotation.category]
                    const isSelected = annotation.id === selectedId
                    return (
                      <Circle
                        key={annotation.id}
                        name="annotation"
                        x={annotation.anchor.x * base.width}
                        y={annotation.anchor.y * base.height}
                        radius={7 / view.scale}
                        fill={color}
                        stroke="#fffdf7"
                        strokeWidth={2 / view.scale}
                        onClick={(event) => {
                          event.cancelBubble = true
                          setSelectedId(annotation.id)
                          setDraftAnchor(null)
                          setLibraryCategory(annotation.category)
                        }}
                      />
                    )
                  })}
                  {pageAnnotations
                    .filter((annotation) => annotation.id === selectedId)
                    .map((annotation) => (
                      <Circle
                        key={`ring-${annotation.id}`}
                        x={annotation.anchor.x * base.width}
                        y={annotation.anchor.y * base.height}
                        radius={14 / view.scale}
                        stroke={CATEGORY_COLORS[annotation.category]}
                        strokeWidth={2 / view.scale}
                        dash={[4 / view.scale, 3 / view.scale]}
                        listening={false}
                      />
                    ))}
                  {draftAnchor && (
                    <Circle
                      x={draftAnchor.x * base.width}
                      y={draftAnchor.y * base.height}
                      radius={8 / view.scale}
                      stroke={CATEGORY_COLORS[draftCategory]}
                      strokeWidth={2 / view.scale}
                      dash={[4 / view.scale, 4 / view.scale]}
                      listening={false}
                    />
                  )}
                </Layer>
              </Stage>
            ) : (
              <div className="rv-stage-empty">
                {loading || pageLoading ? '載入頁面…' : '這份作品沒有頁面'}
              </div>
            )}
          </div>

          <div className="rv-foot">
            <span>{work ? `S${work.seat} ${work.name}` : ''}</span>
            <span>
              共 {annotations.length} 個批注 · 本頁 {pageAnnotations.length} 個
            </span>
            <span>PageUp / PageDown 翻頁 · 1–5 選類別 · Ctrl+Z / Ctrl+Y 復原</span>
          </div>
        </main>

        <aside className="rv-panel">
          <section className="rv-card">
            <div className="rv-card-head">
              <h3>批注</h3>
              <span className="rv-muted">
                {editMode === 'draft'
                  ? `第 ${currentPage + 1} 頁 · 新批注`
                  : editMode === 'selected'
                    ? '編輯中'
                    : '點畫布新增'}
              </span>
            </div>

            {editMode === 'idle' ? (
              <p className="rv-hint">
                點擊畫布放置批注錨點，再用 1–5 選擇類別並輸入內容。既有批注可直接點選編輯。
              </p>
            ) : (
              <>
                <div className="rv-cats">
                  {SHORTCUT_CATEGORIES.map((category, index) => (
                    <button
                      key={category}
                      className={
                        category === activeCategory ? 'rv-cat active' : 'rv-cat'
                      }
                      onClick={() => setCategory(category)}
                      title={`快捷鍵 ${index + 1}`}
                    >
                      <span
                        className="rv-cat-dot"
                        style={{ background: CATEGORY_COLORS[category] }}
                      />
                      {ANNOTATION_CATEGORY_LABELS[category]}
                    </button>
                  ))}
                </div>

                {activeSubtypeOptions.length > 0 && (
                  <label className="rv-field">
                    子類
                    <select
                      value={activeSubtype}
                      onChange={(event) => {
                        if (editMode === 'draft') setDraftSubtype(event.target.value)
                        else updateSelected({ subtype: event.target.value || undefined }, 'subtype')
                      }}
                    >
                      <option value="">（未分類）</option>
                      {activeSubtypeOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="rv-field">
                  批注文字
                  <textarea
                    ref={annotationTextRef}
                    rows={3}
                    value={editMode === 'draft' ? draftText : selected?.text ?? ''}
                    placeholder="輸入批注內容，或從下方評語庫插入"
                    onFocus={() => {
                      focusRef.current = 'annotation'
                    }}
                    onChange={(event) => {
                      if (editMode === 'draft') setDraftText(event.target.value)
                      else updateSelected({ text: event.target.value }, 'text')
                    }}
                  />
                </label>

                {activeCategory === 'sentence' && (
                  <div className="rv-d25">
                    <p className="rv-d25-title">D25 詞句改寫</p>
                    <label className="rv-field">
                      原句 original
                      <textarea
                        rows={2}
                        value={editMode === 'draft' ? draftMeta.original : selectedMeta.original ?? ''}
                        onChange={(event) => {
                          if (editMode === 'draft') {
                            setDraftMeta((previous) => ({
                              ...previous,
                              original: event.target.value
                            }))
                          } else {
                            updateSelected(
                              { meta: { ...selectedMeta, original: event.target.value } },
                              'meta-original'
                            )
                          }
                        }}
                      />
                    </label>
                    <label className="rv-field">
                      建議 revised
                      <textarea
                        rows={2}
                        value={editMode === 'draft' ? draftMeta.revised : selectedMeta.revised ?? ''}
                        onChange={(event) => {
                          if (editMode === 'draft') {
                            setDraftMeta((previous) => ({
                              ...previous,
                              revised: event.target.value
                            }))
                          } else {
                            updateSelected(
                              { meta: { ...selectedMeta, revised: event.target.value } },
                              'meta-revised'
                            )
                          }
                        }}
                      />
                    </label>
                    <label className="rv-field">
                      原因 reason
                      <textarea
                        rows={2}
                        value={editMode === 'draft' ? draftMeta.reason : selectedMeta.reason ?? ''}
                        onChange={(event) => {
                          if (editMode === 'draft') {
                            setDraftMeta((previous) => ({
                              ...previous,
                              reason: event.target.value
                            }))
                          } else {
                            updateSelected(
                              { meta: { ...selectedMeta, reason: event.target.value } },
                              'meta-reason'
                            )
                          }
                        }}
                      />
                    </label>
                  </div>
                )}

                <div className="rv-card-actions">
                  {editMode === 'draft' ? (
                    <>
                      <button onClick={() => setDraftAnchor(null)}>取消</button>
                      <button className="primary" onClick={addAnnotation}>
                        新增批注
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="link danger" onClick={deleteSelected}>
                        刪除批注
                      </button>
                      <span className="rv-muted">
                        {subtypeLabel(selected?.category ?? 'typo', selected?.subtype)} ·{' '}
                        {selected?.created_at.slice(11, 16)}
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="rv-card">
            <div className="rv-card-head">
              <h3>評語庫</h3>
              <button className="small" onClick={() => setLibraryOpen((value) => !value)}>
                {libraryOpen ? '收合' : '展開'}
              </button>
            </div>

            {libraryOpen && (
              <>
                <div className="rv-lib-version">
                  <label className="rv-field">
                    版本
                    <select
                      value={libraryMode}
                      onChange={(event) =>
                        void changeLibraryMode(event.target.value as LibraryMode)
                      }
                    >
                      {(['auto', 'junior', 'senior'] as const).map((mode) => (
                        <option key={mode} value={mode}>
                          {LIBRARY_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="rv-lib-current">
                    {library
                      ? `${LIBRARY_LABELS[libraryId]} · ${libraryVersion || '版本未知'}`
                      : libraryLoading
                        ? '載入中…'
                        : '尚未載入'}
                  </span>
                  {libraryId === 'junior' && <span className="rv-lib-draft">草稿</span>}
                </div>
                {libraryId === 'junior' && (
                  <p className="rv-note">國中版為草稿，建議校閱後使用。</p>
                )}
                {libraryError && <p className="rv-warn">{libraryError}</p>}
                <div className="rv-lib-filter">
                  <select
                    value={libraryCategory}
                    onChange={(event) =>
                      setLibraryCategory(event.target.value as AnnotationCategory)
                    }
                  >
                    {SHORTCUT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {ANNOTATION_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    placeholder="搜尋評語…"
                  />
                </div>
                <div className="rv-lib-list">
                  {!library && !libraryError && <p className="rv-muted">載入中…</p>}
                  {library && filteredEntries.length === 0 && (
                    <p className="rv-muted">沒有符合的評語</p>
                  )}
                  {filteredEntries.map((entry) => (
                    <button
                      key={entry.id}
                      className="rv-lib-item"
                      onClick={() => insertLibrary(entry)}
                      title="插入到最近聚焦的欄位"
                    >
                      <span className="rv-lib-text">{entry.text}</span>
                      <span className="rv-lib-meta">
                        {entry.id}
                        {entry.subtype !== 'general' &&
                          ` · ${subtypeLabel(entry.category, entry.subtype)}`}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="rv-card">
            <div className="rv-card-head">
              <h3>評分</h3>
              <span className="rv-muted">
                {rubric ? `量規 ${rubric.id}` : '尚未載入量規'}
              </span>
            </div>

            {rubric && (
              <div className="rv-rubric">
                <div className="rv-rubric-info">
                  <p className="rv-rubric-line">配分：{rubricItemsText(rubric)}</p>
                  <p className="rv-muted">
                    等第：{rubricGradesText(rubric)}
                  </p>
                  <p className="rv-muted">
                    扣分：錯字每字 {rubric.deduction.typo_per}、標點每處{' '}
                    {rubric.deduction.punct_per}，上限 {rubric.deduction.cap}
                  </p>
                </div>
                <button
                  className="small"
                  onClick={() => (rubricOpen ? closeRubricEditor() : openRubricEditor())}
                >
                  {rubricOpen ? '收合' : '調整量規'}
                </button>
              </div>
            )}

            {rubric && rubricOpen && (
              <div className="rv-rubric-form">
                <label className="rv-field">
                  預設量規
                  <select
                    value={rubricForm.preset}
                    onChange={(event) => changeRubricPreset(event.target.value)}
                  >
                    {RUBRIC_PRESET_ORDER.map((id) => (
                      <option key={id} value={id}>
                        {RUBRIC_PRESET_LABELS[id]}
                      </option>
                    ))}
                    <option value="custom">自訂</option>
                  </select>
                </label>

                <div className="rv-rubric-grid">
                  {(
                    [
                      ['content', '內容滿分'],
                      ['structure', '結構滿分'],
                      ['language', '語言滿分']
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="rv-rubric-field">
                      {label}
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={rubricForm[field]}
                        onChange={(event) => changeRubricField(field, event.target.value)}
                      />
                    </label>
                  ))}
                </div>

                <div className="rv-rubric-grid">
                  <label className="rv-rubric-field">
                    錯字每字
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={rubricForm.typo}
                      onChange={(event) => changeRubricField('typo', event.target.value)}
                    />
                  </label>
                  <label className="rv-rubric-field">
                    標點每處
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={rubricForm.punct}
                      onChange={(event) => changeRubricField('punct', event.target.value)}
                    />
                  </label>
                  <label className="rv-rubric-field">
                    扣分上限
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={rubricForm.cap}
                      onChange={(event) => changeRubricField('cap', event.target.value)}
                    />
                  </label>
                </div>

                <div className="rv-grade-editor">
                  <div className="rv-grade-head">
                    <span>等第門檻</span>
                    <button className="small" onClick={addGrade}>
                      新增等第
                    </button>
                  </div>

                  {rubricForm.grades.map((grade, index) => (
                    <div key={grade.key} className="rv-grade-row">
                      <input
                        value={grade.label}
                        placeholder={`等第 ${index + 1}，例如 優`}
                        aria-label={`第 ${index + 1} 列等第名稱`}
                        onChange={(event) => changeGrade(grade.key, 'label', event.target.value)}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={grade.min}
                        aria-label={`第 ${index + 1} 列最低分`}
                        onChange={(event) => changeGrade(grade.key, 'min', event.target.value)}
                      />
                      <button className="small" onClick={() => removeGrade(grade.key)}>
                        刪除
                      </button>
                    </div>
                  ))}

                  {rubricForm.grades.length === 0 && (
                    <p className="rv-warn">至少需要一個等第。</p>
                  )}

                  <p className="rv-note">
                    目前總分 {previewTotal ?? '—'} 會落在「{previewGrade ?? '—'}」；
                    儲存時依最低分由高到低排序。
                  </p>

                  {gradeErrors.length > 0 && (
                    <ul className="rv-grade-errors">
                      {gradeErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className={rubricSumOk ? 'rv-note' : 'rv-warn'}>
                  三項合計 {Number.isFinite(rubricSum) ? rubricSum : '—'}／100
                  {!rubricItemsOk && '（三項滿分需為正數）'}
                </p>
                {!rubricDeductionOk && (
                  <p className="rv-warn">扣分需為 0 以上，上限不可超過 100。</p>
                )}
                {rubricError && <p className="rv-warn">{rubricError}</p>}

                {rubricConfirmCount > 0 ? (
                  <div className="rv-rubric-confirm">
                    <p>
                      已有 {rubricConfirmCount} 份評分，變更量規只影響之後的計算；已儲存的分數與等第不會自動改寫。
                    </p>
                    <p className="rv-muted">
                      目前這份的預覽會立即用新量規重算，按「完成批閱」後才寫入。
                    </p>
                    <div className="rv-card-actions">
                      <button onClick={() => setRubricConfirmCount(0)}>取消</button>
                      <button
                        className="primary"
                        disabled={rubricSaving}
                        onClick={() => void applyRubric()}
                      >
                        {rubricSaving ? '儲存中…' : '仍要變更'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rv-card-actions">
                    <button onClick={closeRubricEditor}>取消</button>
                    <button
                      className="primary"
                      disabled={!rubricFormValid || rubricSaving}
                      onClick={() => void handleRubricSave()}
                    >
                      {rubricSaving ? '儲存中…' : '儲存量規'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {rubric?.items.map((item) => (
              <label key={item.id} className="rv-score-row">
                <span className="rv-score-name">{item.name}</span>
                <input
                  type="number"
                  min={0}
                  max={item.max}
                  step={0.5}
                  value={scoreItems[item.id] ?? ''}
                  onChange={(event) => handleScoreChange(item.id, event.target.value)}
                />
                <span className="rv-score-max">/ {item.max}</span>
              </label>
            ))}

            <div className="rv-deduct">
              <span>
                自動扣分（錯字 {typoCount} × {rubric?.deduction.typo_per ?? 0}）
              </span>
              <strong>−{autoDeduction}</strong>
            </div>

            <label className="rv-score-row">
              <span className="rv-score-name">手動覆寫</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={override}
                placeholder="自動"
                onChange={(event) => {
                  setOverride(event.target.value)
                  markDirty()
                }}
              />
              <button
                className="small"
                onClick={() => {
                  setOverride('')
                  markDirty()
                }}
              >
                清除
              </button>
            </label>

            <div className="rv-total">
              <span>
                總分 <strong>{computed?.total ?? '—'}</strong>
              </span>
              <span className="rv-grade">{computed?.grade ?? '—'}</span>
            </div>
          </section>

          <section className="rv-card">
            <div className="rv-card-head">
              <h3>總評</h3>
              <span className={finalChars >= minChars ? 'rv-count ok' : 'rv-count warn'}>
                {finalChars} / {minChars} 字
              </span>
            </div>
            <textarea
              ref={finalTextRef}
              className="rv-final"
              rows={5}
              value={finalText}
              placeholder="給學生的整體回饋（空白與標點不計）"
              onFocus={() => {
                focusRef.current = 'final'
              }}
              onChange={(event) => updateFinalText(event.target.value)}
            />
            <div className="rv-final-actions">
              <button className="small" onClick={() => setLibraryOpen(true)}>
                從評語庫插入
              </button>
              <span className="rv-muted">點評語庫條目會插入到最近聚焦欄位</span>
            </div>

            {reuseBlocked ? (
              <p className="rv-warn">
                此總評同批已用 {reuse.count} 次（座號 {reuse.seats.join('、')}），已達上限
                {assignment?.rules.final_max_reuse}，請改寫後再完成。
              </p>
            ) : reuse.count > 0 ? (
              <p className="rv-note">
                同批已有 {reuse.count} 份使用相同總評（座號 {reuse.seats.join('、')}）。
              </p>
            ) : null}
          </section>

          <section className="rv-card rv-complete">
            <div className="rv-complete-actions">
              <button
                className="primary large"
                disabled={!work || !assignment || loading}
                onClick={() => void handleComplete()}
              >
                完成批閱
              </button>
              <button
                className="large"
                disabled={!work || work.status !== 'done' || loading}
                title={work?.status === 'done' ? '開啟一頁 A4 回饋單' : '完成批閱後才可產生'}
                onClick={() => void handleOpenFeedback()}
              >
                回饋單
              </button>
            </div>
            {issues.length > 0 && (
              <ul className="rv-issues">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <p className="rv-muted">
              完成後自動載入下一份待批作品。
            </p>
          </section>
        </aside>
      </div>

      {notice && <div className={`toast toast--${notice.kind}`}>{notice.text}</div>}
    </div>
  )
}
