import { computeScore, resolveGrade } from './review'
import type { Annotation, AssignmentFile, ClassFile, WorkFile } from './schema'

/**
 * 一頁回饋單的資料模型。
 * 只由 work.json、assignment.json、class.json 推導，不另存檔案，
 * 因此量規或等第門檻變更後，重新預覽就會反映最新設定；
 * 分數與等第仍以 work.scores 的已完成快照為準。
 */
export interface FeedbackItem {
  id: string
  name: string
  score: number
  max: number
}

export interface FeedbackTypo {
  wrong: string
  correct: string
  count: number
}

export interface FeedbackRewrite {
  original: string
  revised: string
  reason?: string
}

export interface FeedbackScore {
  items: FeedbackItem[]
  itemsTotal: number
  typoDeduction: number
  punctDeduction: number
  override: number | null
  deduction: number
  cap: number
  total: number
  grade?: string
}

export interface FeedbackCounts {
  /** 錯字批注總數（含未填 wrong／correct 的） */
  typos: number
  /** 語句批注總數（含未填建議改寫的） */
  sentences: number
  structures: number
  praises: number
}

export interface FeedbackSheet {
  classId: string
  className: string
  teacher?: string
  seat: string
  name: string
  title: string
  /** 批閱日期（work.updated_at 的 ISO 日期） */
  gradedAt: string
  score: FeedbackScore
  comment: string
  typos: FeedbackTypo[]
  rewrites: FeedbackRewrite[]
  praises: string[]
  counts: FeedbackCounts
  truncated: {
    typos: boolean
    rewrites: boolean
    praises: boolean
  }
}

/** 一頁放不下的內容會先截掉；完整內容仍在 work.json。 */
export const FEEDBACK_LIMITS = {
  typos: 12,
  rewrites: 6,
  praises: 4
} as const

/** 程式產出的固定檔名，放在學生資料夾內。 */
export function feedbackPdfFileName(seat: string): string {
  return `S${seat}_feedback.pdf`
}

/**
 * 給人看的另存檔名。Windows 不接受 `<>:"/\|?*` 與控制字元，
 * 這裡一律換成底線；空字串回到 `未命名`。
 */
export function sanitizeFileName(value: string, fallback = '未命名'): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
    .trim()

  return cleaned || fallback
}

export interface FeedbackExportNameInput {
  className: string
  title: string
  seat: string
  name: string
  gradedAt: string
}

/**
 * 另存用的中文檔名，例如：
 * `高中302_我的母親_S07_王小明_回饋單_2026-11-19.pdf`
 * 這個檔案只給人看，程式不再解析。
 */
export function feedbackExportFileName(input: FeedbackExportNameInput): string {
  const date = input.gradedAt.slice(0, 10).replace(/[^0-9-]/g, '') || '未定'
  return `${sanitizeFileName(input.className)}_${sanitizeFileName(
    input.title
  )}_S${input.seat}_${sanitizeFileName(input.name)}_回饋單_${date}.pdf`
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const textOf = (value: string | undefined): string => (value ?? '').trim()

function collectTypos(annotations: Annotation[]): {
  all: FeedbackTypo[]
  total: number
} {
  const map = new Map<string, FeedbackTypo>()
  let total = 0

  for (const annotation of annotations) {
    if (annotation.category !== 'typo') continue
    total += 1

    const wrong = textOf(annotation.meta?.wrong)
    const correct = textOf(annotation.meta?.correct)
    if (!wrong && !correct) continue

    const key = `${wrong}\u0000${correct}`
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
    } else {
      map.set(key, { wrong, correct, count: 1 })
    }
  }

  const all = [...map.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.wrong.localeCompare(b.wrong, 'zh-Hant') ||
      a.correct.localeCompare(b.correct, 'zh-Hant')
  )

  return { all, total }
}

function collectRewrites(annotations: Annotation[]): FeedbackRewrite[] {
  const map = new Map<string, FeedbackRewrite>()

  for (const annotation of annotations) {
    if (annotation.category !== 'sentence') continue
    const revised = textOf(annotation.meta?.revised)
    if (!revised) continue

    const original = textOf(annotation.meta?.original)
    const reason = textOf(annotation.meta?.reason)
    const key = `${original}\u0000${revised}`
    if (map.has(key)) continue

    map.set(key, {
      original,
      revised,
      ...(reason ? { reason } : {})
    })
  }

  return [...map.values()]
}

function collectPraises(annotations: Annotation[]): string[] {
  const seen = new Set<string>()
  const praises: string[] = []

  for (const annotation of annotations) {
    if (annotation.category !== 'praise') continue
    const text = textOf(annotation.text)
    if (!text || seen.has(text)) continue
    seen.add(text)
    praises.push(text)
  }

  return praises
}

/**
 * 由一份作品組出回饋單。
 * - 分數：優先使用 work.scores 的完成快照；沒有才即時計算。
 * - 等第：快照有就用，沒有才依目前量規換算。
 * - 錯字：只列有 wrong／correct 的，依出現次數排序。
 * - 詞句：只列有 revised 的 D25 建議改寫。
 */
export function buildFeedbackSheet(input: {
  classFile: ClassFile
  assignment: AssignmentFile
  work: WorkFile
}): FeedbackSheet {
  const { classFile, assignment, work } = input
  const rubric = assignment.rubric
  const annotations = work.annotations
  const stored = work.scores

  const fallback = computeScore(
    annotations,
    stored?.items ?? {},
    rubric,
    stored?.deduction.override ?? null
  )

  const items: FeedbackItem[] = rubric.items.map((item) => ({
    id: item.id,
    name: item.name,
    score: clamp(stored?.items[item.id] ?? 0, 0, item.max),
    max: item.max
  }))
  const itemsTotal = items.reduce((sum, item) => sum + item.score, 0)

  const typoDeduction = stored?.deduction.typo ?? fallback.deduction
  const punctDeduction = stored?.deduction.punct ?? 0
  const override = stored?.deduction.override ?? null
  const deduction = Math.min(
    rubric.deduction.cap,
    Math.max(0, override ?? typoDeduction + punctDeduction)
  )
  const total = stored?.total ?? fallback.total
  const grade = stored?.grade ?? resolveGrade(total, rubric)

  const typoResult = collectTypos(annotations)
  const rewrites = collectRewrites(annotations)
  const praises = collectPraises(annotations)

  return {
    classId: classFile.id,
    className: classFile.name,
    ...(classFile.teacher ? { teacher: classFile.teacher } : {}),
    seat: work.seat,
    name: work.name,
    title: assignment.title,
    gradedAt: work.updated_at.slice(0, 10),
    score: {
      items,
      itemsTotal,
      typoDeduction,
      punctDeduction,
      override,
      deduction,
      cap: rubric.deduction.cap,
      total,
      ...(grade ? { grade } : {})
    },
    comment: work.final_comment?.text ?? '',
    typos: typoResult.all.slice(0, FEEDBACK_LIMITS.typos),
    rewrites: rewrites.slice(0, FEEDBACK_LIMITS.rewrites),
    praises: praises.slice(0, FEEDBACK_LIMITS.praises),
    counts: {
      typos: typoResult.total,
      sentences: annotations.filter((annotation) => annotation.category === 'sentence').length,
      structures: annotations.filter((annotation) => annotation.category === 'structure').length,
      praises: praises.length
    },
    truncated: {
      typos: typoResult.all.length > FEEDBACK_LIMITS.typos,
      rewrites: rewrites.length > FEEDBACK_LIMITS.rewrites,
      praises: praises.length > FEEDBACK_LIMITS.praises
    }
  }
}
