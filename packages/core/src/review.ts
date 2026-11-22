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

/** 近似重複判定的相似度門檻（0–1）。 */
export const FINAL_SIMILARITY_THRESHOLD = 0.85

export interface FinalReuseMatch {
  seat: string
  similarity: number
  exact: boolean
}

export interface FinalReuseResult {
  count: number
  seats: string[]
  matches: FinalReuseMatch[]
}

/**
 * 兩段總評的相似度（0–1）：先正規化，再用字元 bigram 的 Jaccard 相似度；
 * 長度為 1 時改用 unigram，避免 bigram 為空。不回傳負值、也不依賴英文斷詞。
 */
export function commentSimilarity(a: string, b: string): number {
  const na = normalizeComment(a)
  const nb = normalizeComment(b)
  if (!na || !nb) return 0
  if (na === nb) return 1

  const grams = (text: string): string[] => {
    const chars = [...text]
    if (chars.length === 1) return chars
    const result: string[] = []
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const left = chars[i]
      const right = chars[i + 1]
      if (left !== undefined && right !== undefined) result.push(left + right)
    }
    return result
  }

  const setA = new Set(grams(na))
  const setB = new Set(grams(nb))
  let intersection = 0
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 在候選總評中找出與 target 相同或近似的項目。
 * 排除空文字（target 或候選）；是否排除自己由呼叫端處理。
 * exact=true 表示正規化後完全相同；相似度 >= threshold 才列入。
 * 結果依 similarity 由高到低、seat 由小到大排序。
 */
export function findSimilarFinalComments(
  targetText: string,
  candidates: readonly { seat: string; text: string }[],
  threshold: number = FINAL_SIMILARITY_THRESHOLD
): FinalReuseMatch[] {
  const target = normalizeComment(targetText)
  if (!target) return []

  const matches: FinalReuseMatch[] = []
  for (const candidate of candidates) {
    const text = candidate?.text ?? ''
    const normalized = normalizeComment(text)
    if (!normalized) continue

    const similarity = commentSimilarity(targetText, text)
    if (similarity < threshold) continue

    matches.push({
      seat: candidate.seat,
      similarity,
      exact: normalized === target
    })
  }

  matches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity
    return a.seat.localeCompare(b.seat)
  })

  return matches
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

/**
 * 依 rubric.items 的 max 比例把 total 分配到各分項，以 0.5 為最小單位。
 * 總和等於四捨五入到 0.5 的目標（不超過各分項滿分總和）。
 *
 * 演算法：前 n-1 項取 floor(ideal*2)/2，最後一項補差額；若最後一項超過
 * 其 max，把多餘往回分給還有空間的項目（每步 0.5，優先給最靠近最後一項的）。
 * 空量規回傳空物件；total 非法、total <= 0 或滿分總和 <= 0 時回傳全 0。
 */
export function distributeScore(total: number, rubric: Rubric): Record<string, number> {
  const items = rubric?.items ?? []
  const result: Record<string, number> = {}

  if (items.length === 0) return result

  const maxes = items.map((item) => Math.max(0, item.max))
  const maxSum = maxes.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0 || maxSum <= 0) {
    for (const item of items) result[item.id] = 0
    return result
  }

  const target = Math.min(maxSum, Math.round(total * 2) / 2)
  const lastIndex = items.length - 1

  // 前 n-1 項取 floor(ideal*2)/2，最後一項補差額。
  const values: number[] = []
  let sum = 0
  for (let index = 0; index < lastIndex; index += 1) {
    const max = maxes[index] ?? 0
    const ideal = max === 0 ? 0 : (target * max) / maxSum
    values[index] = Math.min(max, Math.floor(ideal * 2) / 2)
    sum += values[index] ?? 0
  }

  let lastValue = target - sum
  let overflow = lastValue - (maxes[lastIndex] ?? 0)
  if (overflow > 0) {
    lastValue = maxes[lastIndex] ?? 0
    for (let index = lastIndex - 1; index >= 0 && overflow >= 0.5 - 1e-9; index -= 1) {
      const spare = (maxes[index] ?? 0) - (values[index] ?? 0)
      if (spare < 0.5 - 1e-9) continue
      values[index] = Math.round(((values[index] ?? 0) + 0.5) * 2) / 2
      overflow -= 0.5
    }
  }
  values[lastIndex] = Math.round(lastValue * 2) / 2

  items.forEach((item, index) => {
    result[item.id] = values[index] ?? 0
  })
  return result
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
      `總評同批已用 ${reusedByOthers} 次（含相同或近似），第 ${reusedByOthers + 1} 次須改寫`
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
