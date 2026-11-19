import type { Annotation, AssignmentFile, GradeBand, Rubric, WorkFile } from './schema'

/** 去變數、標點、空白，用來比對重複與計算總評字數。 */
export function normalizeComment(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

export function countFinalChars(text: string): number {
  return normalizeComment(text).length
}

export interface ComputedScore {
  itemsTotal: number
  deduction: number
  total: number
  grade?: string
}

export function calcDeduction(
  annotations: Annotation[],
  rubric: Rubric,
  override: number | null
): number {
  const typoCount = annotations.filter((annotation) => annotation.category === 'typo').length
  const auto = typoCount * rubric.deduction.typo_per
  const raw = override ?? auto
  return Math.min(rubric.deduction.cap, Math.max(0, raw))
}

/** 依最低分由高到低排序，回傳新陣列，不改動來源。 */
export function sortGradeBands<T extends Pick<GradeBand, 'label' | 'min'>>(
  grades: readonly T[]
): T[] {
  return [...grades].sort((a, b) => b.min - a.min)
}

/**
 * 等第門檻的共用驗證：至少一筆、名稱去空白後不可為空或重複、
 * 最低分必須是 0–100 的數字且不可重複。
 * 回傳空陣列代表通過；錯誤訊息給 UI 與 IPC 直接顯示。
 */
export function validateGradeBands(grades: readonly GradeBand[]): string[] {
  if (!Array.isArray(grades) || grades.length === 0) return ['等第門檻至少需要 1 筆']

  const errors: string[] = []
  const seenLabels = new Set<string>()
  const seenMins = new Set<number>()

  grades.forEach((grade, index) => {
    const row = index + 1
    const label = typeof grade?.label === 'string' ? grade.label.trim() : ''
    if (!label) {
      errors.push(`第 ${row} 列等第名稱不可空白`)
    } else if (seenLabels.has(label)) {
      errors.push(`等第名稱「${label}」重複`)
    } else {
      seenLabels.add(label)
    }

    const min = grade?.min
    if (typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > 100) {
      errors.push(`第 ${row} 列等第最低分必須是 0–100 的數字`)
    } else if (seenMins.has(min)) {
      errors.push(`等第最低分 ${min} 重複`)
    } else {
      seenMins.add(min)
    }
  })

  return errors
}

export function resolveGrade(total: number, rubric: Rubric): string | undefined {
  return sortGradeBands(rubric.grades).find((band) => total >= band.min)?.label
}

export function computeScore(
  annotations: Annotation[],
  items: Record<string, number>,
  rubric: Rubric,
  override: number | null = null
): ComputedScore {
  const itemsTotal = rubric.items.reduce(
    (sum, item) => sum + Math.min(Math.max(items[item.id] ?? 0, 0), item.max),
    0
  )
  const deduction = calcDeduction(annotations, rubric, override)
  const total = Math.max(0, Math.round((itemsTotal - deduction) * 10) / 10)
  return { itemsTotal, deduction, total, grade: resolveGrade(total, rubric) }
}

export interface WorkValidation {
  ok: boolean
  issues: string[]
  score: ComputedScore
  finalChars: number
}

/** 完成批閱前的檢查：總評字數、分項、重複次數。 */
export function validateWork(
  work: WorkFile,
  assignment: AssignmentFile,
  reusedByOthers: number
): WorkValidation {
  const issues: string[] = []
  const rubric = assignment.rubric
  const finalText = work.final_comment?.text ?? ''
  const finalChars = countFinalChars(finalText)
  const minChars = assignment.rules.final_min_chars

  if (finalChars < minChars) {
    issues.push(`總評不足 ${minChars} 字（目前 ${finalChars} 字）`)
  }

  if (work.pages.length === 0) {
    issues.push('沒有頁面')
  }

  const items = work.scores?.items ?? {}
  for (const item of rubric.items) {
    const value = items[item.id]
    if (typeof value !== 'number') {
      issues.push(`未評分：${item.name}`)
      continue
    }
    if (value < 0 || value > item.max) {
      issues.push(`${item.name} 超出 0–${item.max}`)
    }
  }

  if (reusedByOthers >= assignment.rules.final_max_reuse) {
    issues.push(
      `總評同批已用 ${reusedByOthers} 次，第 ${reusedByOthers + 1} 次須改寫`
    )
  }

  const score = computeScore(
    work.annotations,
    items,
    rubric,
    work.scores?.deduction.override ?? null
  )

  return { ok: issues.length === 0, issues, score, finalChars }
}
