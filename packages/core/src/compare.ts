import type { AssignmentStats, StudentStatsRow } from './stats'

/**
 * G4「與上次比較」：同一班級、兩份作業的成績與弱項類別比較。
 * 只做純資料運算，不改動來源統計；檔案讀寫與 IPC 由 main 端負責。
 *
 * 一律以座號對齊，不以姓名猜測。班級平均只以「兩邊都有 done 分數」的
 * compared 學生為母體，避免新作品或缺考造成假進步／假退步。
 */

export type CompareStatus =
  | 'improved'
  | 'declined'
  | 'same'
  | 'new'
  | 'missing'
  | 'incomplete'

export const COMPARE_STATUS_LABELS: Record<CompareStatus, string> = {
  improved: '進步',
  declined: '退步',
  same: '持平',
  new: '新作品',
  missing: '缺資料',
  incomplete: '資料不足'
}

/** 弱項只比這四類，使用 StudentStatsRow.counts。 */
export const WEAKNESS_COMPARE_CATEGORIES = [
  'typo',
  'sentence',
  'structure',
  'other'
] as const

export type WeaknessCompareCategory = (typeof WEAKNESS_COMPARE_CATEGORIES)[number]

export const WEAKNESS_COMPARE_LABELS: Record<WeaknessCompareCategory, string> = {
  typo: '錯字',
  sentence: '語句',
  structure: '結構',
  other: '其他'
}

export interface ComparedStudentRow {
  seat: string
  name: string
  previousScore: number | null
  currentScore: number | null
  /** 只有兩邊都有 done 分數時才有值，否則為 null。 */
  delta: number | null
  previousGrade: string | null
  currentGrade: string | null
  previousCounted: boolean
  currentCounted: boolean
  status: CompareStatus
}

export interface CompareRankItem {
  seat: string
  name: string
  delta: number
  previousScore: number
  currentScore: number
}

export interface CompareWeaknessRow {
  category: WeaknessCompareCategory
  label: string
  /** 以 compared 學生為母體的每份平均次數；compared 為 0 時為 null。 */
  previousPerStudent: number | null
  currentPerStudent: number | null
  /** 本次平均－上次平均；正值代表變多（退步），負值代表改善。 */
  delta: number | null
}

export interface ComparisonSummary {
  students: number
  compared: number
  improved: number
  declined: number
  same: number
  new: number
  missing: number
  incomplete: number
  averagePrevious: number | null
  averageCurrent: number | null
  averageDelta: number | null
  topImproved: CompareRankItem[]
  topDeclined: CompareRankItem[]
}

export interface AssignmentComparison {
  generatedAt: string
  currentAssignmentId: string
  currentTitle: string
  previousAssignmentId: string
  previousTitle: string
  summary: ComparisonSummary
  weaknesses: CompareWeaknessRow[]
  students: ComparedStudentRow[]
}

const round1 = (value: number): number => Math.round(value * 10) / 10

const RANK_LIMIT = 5

type DoneRow = StudentStatsRow & { score: number }

function doneRow(row: StudentStatsRow | undefined): DoneRow | null {
  if (!row || !row.counted || typeof row.score !== 'number') return null
  return row as DoneRow
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/** 平均先各自四捨五入到一位小數，再由兩邊平均相減，確保顯示值與 Δ 一致。 */
function deltaOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null
  return round1(current - previous)
}

function compareStatus(
  previous: DoneRow | null,
  current: DoneRow | null
): CompareStatus {
  if (previous && current) {
    if (current.score > previous.score) return 'improved'
    if (current.score < previous.score) return 'declined'
    return 'same'
  }
  if (current) return 'new'
  if (previous) return 'missing'
  return 'incomplete'
}

function toRankItem(row: ComparedStudentRow): CompareRankItem {
  return {
    seat: row.seat,
    name: row.name,
    delta: row.delta ?? 0,
    previousScore: row.previousScore ?? 0,
    currentScore: row.currentScore ?? 0
  }
}

/** 取進步／退步前 5，delta 相同時依座號排序。 */
function topByDelta(
  rows: readonly ComparedStudentRow[],
  direction: 'improved' | 'declined'
): CompareRankItem[] {
  return rows
    .filter((row) => typeof row.delta === 'number')
    .filter((row) =>
      direction === 'improved' ? (row.delta ?? 0) > 0 : (row.delta ?? 0) < 0
    )
    .sort((a, b) => {
      const left = a.delta ?? 0
      const right = b.delta ?? 0
      if (left !== right) return direction === 'improved' ? right - left : left - right
      return a.seat.localeCompare(b.seat)
    })
    .slice(0, RANK_LIMIT)
    .map(toRankItem)
}

function compareWeaknesses(
  current: AssignmentStats,
  previous: AssignmentStats,
  comparedSeats: ReadonlySet<string>
): CompareWeaknessRow[] {
  const currentRows = new Map(current.students.map((row) => [row.seat, row]))
  const previousRows = new Map(previous.students.map((row) => [row.seat, row]))
  const denominator = comparedSeats.size

  return WEAKNESS_COMPARE_CATEGORIES.map((category) => {
    let previousTotal = 0
    let currentTotal = 0

    for (const seat of comparedSeats) {
      previousTotal += previousRows.get(seat)?.counts[category] ?? 0
      currentTotal += currentRows.get(seat)?.counts[category] ?? 0
    }

    const previousPerStudent =
      denominator > 0 ? round1(previousTotal / denominator) : null
    const currentPerStudent =
      denominator > 0 ? round1(currentTotal / denominator) : null

    return {
      category,
      label: WEAKNESS_COMPARE_LABELS[category],
      previousPerStudent,
      currentPerStudent,
      delta: deltaOf(currentPerStudent, previousPerStudent)
    }
  })
}

/**
 * 比較兩份作業統計。`generatedAt` 可注入，方便測試。
 * 回傳值為新物件，來源 `current`／`previous` 不會被修改。
 */
export function compareAssignmentStats(
  current: AssignmentStats,
  previous: AssignmentStats,
  generatedAt: string = new Date().toISOString()
): AssignmentComparison {
  const currentRows = new Map(current.students.map((row) => [row.seat, row]))
  const previousRows = new Map(previous.students.map((row) => [row.seat, row]))
  const seats = [...new Set([...currentRows.keys(), ...previousRows.keys()])].sort((a, b) =>
    a.localeCompare(b)
  )

  const students: ComparedStudentRow[] = seats.map((seat) => {
    const currentRow = currentRows.get(seat)
    const previousRow = previousRows.get(seat)
    const currentDone = doneRow(currentRow)
    const previousDone = doneRow(previousRow)
    const status = compareStatus(previousDone, currentDone)
    const previousScore = previousDone ? previousDone.score : null
    const currentScore = currentDone ? currentDone.score : null

    return {
      seat,
      // 名單以本次為主；本次沒有這位學生（例如已轉出）才退回上次姓名。
      name: currentRow?.name ?? previousRow?.name ?? '',
      previousScore,
      currentScore,
      delta:
        previousScore !== null && currentScore !== null
          ? round1(currentScore - previousScore)
          : null,
      previousGrade: previousDone?.grade ?? null,
      currentGrade: currentDone?.grade ?? null,
      previousCounted: Boolean(previousDone),
      currentCounted: Boolean(currentDone),
      status
    }
  })

  const comparedRows = students.filter(
    (row) => row.previousScore !== null && row.currentScore !== null
  )
  const comparedSeats = new Set(comparedRows.map((row) => row.seat))
  const averagePrevious = average(
    comparedRows.map((row) => row.previousScore as number)
  )
  const averageCurrent = average(comparedRows.map((row) => row.currentScore as number))

  const countStatus = (status: CompareStatus): number =>
    students.filter((row) => row.status === status).length

  const summary: ComparisonSummary = {
    students: students.length,
    compared: comparedRows.length,
    improved: countStatus('improved'),
    declined: countStatus('declined'),
    same: countStatus('same'),
    new: countStatus('new'),
    missing: countStatus('missing'),
    incomplete: countStatus('incomplete'),
    averagePrevious,
    averageCurrent,
    averageDelta: deltaOf(averageCurrent, averagePrevious),
    topImproved: topByDelta(comparedRows, 'improved'),
    topDeclined: topByDelta(comparedRows, 'declined')
  }

  return {
    generatedAt,
    currentAssignmentId: current.assignmentId,
    currentTitle: current.title,
    previousAssignmentId: previous.assignmentId,
    previousTitle: previous.title,
    summary,
    weaknesses: compareWeaknesses(current, previous, comparedSeats),
    students
  }
}
