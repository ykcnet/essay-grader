import {
  ANNOTATION_CATEGORY_LABELS,
  SENTENCE_SUBTYPES,
  STRUCTURE_SUBTYPES,
  type AnnotationCategory
} from './constants'
import { computeScore, countFinalChars, resolveGrade, sortGradeBands } from './review'
import type {
  Annotation,
  AssignmentFile,
  Student,
  WorkFile,
  WorkStatus
} from './schema'

/**
 * 作業層級統計（G1 弱項排行、G2 常錯字、G3 個人弱項）。
 * 只做純資料運算；檔案讀寫與 CSV 落盤由 main 端負責。
 *
 * 統計範圍固定為 `status === 'done'` 的作品，避免批閱中的資料讓班級數字跳動；
 * 未完成與未匯入的學生仍會列在個人表，但標示為「不計入」。
 */

/** 算作弱項的批注類別；佳句與一般評語不列入。 */
const WEAKNESS_CATEGORIES: readonly AnnotationCategory[] = [
  'typo',
  'sentence',
  'structure',
  'other'
]

const WEAKNESS_ORDER = new Map<AnnotationCategory, number>(
  WEAKNESS_CATEGORIES.map((category, index) => [category, index])
)

const SENTENCE_LABELS = new Map<string, string>(
  SENTENCE_SUBTYPES.map((item) => [item.id, item.label])
)
const STRUCTURE_LABELS = new Map<string, string>(
  STRUCTURE_SUBTYPES.map((item) => [item.id, item.label])
)

export const WORK_STATUS_LABELS: Record<WorkStatus | 'missing', string> = {
  pending: '待批',
  grading: '批閱中',
  done: '已批',
  missing: '未匯入'
}

export interface WeaknessRankItem {
  key: string
  category: AnnotationCategory
  categoryLabel: string
  subtype?: string
  /** 子類名稱；沒有子類時就是類別名稱。 */
  label: string
  count: number
  /** 占全部弱項批注的比例，0–1。 */
  share: number
  /** 有這個弱項的學生數。 */
  students: number
}

export interface TypoRankItem {
  wrong: string
  correct: string
  count: number
  students: number
  seats: string[]
}

export interface StudentWeaknessItem {
  key: string
  category: AnnotationCategory
  categoryLabel: string
  subtype?: string
  label: string
  count: number
}

export interface StudentStatsRow {
  seat: string
  name: string
  status: WorkStatus | 'missing'
  imported: boolean
  /** 只有已批作品才計入班級統計。 */
  counted: boolean
  score: number | null
  grade?: string
  items: Record<string, number>
  weaknesses: StudentWeaknessItem[]
  counts: {
    typo: number
    sentence: number
    structure: number
    praise: number
    other: number
  }
  finalChars: number
  updatedAt?: string
}

export interface GradeCount {
  label: string
  count: number
}

export interface ItemAverage {
  id: string
  name: string
  max: number
  average: number | null
  percent: number | null
}

export interface StatsSummary {
  students: number
  imported: number
  done: number
  notDone: number
  missing: number
  average: number | null
  median: number | null
  high: number | null
  low: number | null
  grades: GradeCount[]
  items: ItemAverage[]
}

export interface AssignmentStats {
  assignmentId: string
  title: string
  generatedAt: string
  summary: StatsSummary
  categories: WeaknessRankItem[]
  weaknesses: WeaknessRankItem[]
  typos: TypoRankItem[]
  students: StudentStatsRow[]
}

const round1 = (value: number): number => Math.round(value * 10) / 10

const isWeaknessCategory = (category: AnnotationCategory): boolean =>
  WEAKNESS_ORDER.has(category)

function subtypeLabel(category: AnnotationCategory, subtype: string | undefined): string {
  if (!subtype) return ''
  if (category === 'sentence') return SENTENCE_LABELS.get(subtype) ?? subtype
  if (category === 'structure') return STRUCTURE_LABELS.get(subtype) ?? subtype
  return subtype
}

function weaknessKey(category: AnnotationCategory, subtype: string | undefined): string {
  return `${category}:${subtype || 'general'}`
}

function weaknessLabel(category: AnnotationCategory, subtype: string | undefined): string {
  return subtypeLabel(category, subtype) || ANNOTATION_CATEGORY_LABELS[category]
}

function toWeaknessItem(annotation: Annotation): {
  key: string
  category: AnnotationCategory
  categoryLabel: string
  subtype?: string
  label: string
} {
  const subtype = annotation.subtype?.trim() || undefined
  return {
    key: weaknessKey(annotation.category, subtype),
    category: annotation.category,
    categoryLabel: ANNOTATION_CATEGORY_LABELS[annotation.category],
    ...(subtype ? { subtype } : {}),
    label: weaknessLabel(annotation.category, subtype)
  }
}

interface WeaknessAccumulator {
  key: string
  category: AnnotationCategory
  subtype?: string
  label: string
  count: number
  seats: Set<string>
}

interface TypoAccumulator {
  wrong: string
  correct: string
  count: number
  seats: Set<string>
}

function collectWeaknesses(works: readonly WorkFile[]): {
  weaknesses: WeaknessRankItem[]
  categories: WeaknessRankItem[]
} {
  const detail = new Map<string, WeaknessAccumulator>()
  const broad = new Map<AnnotationCategory, WeaknessAccumulator>()
  let total = 0

  for (const work of works) {
    for (const annotation of work.annotations) {
      if (!isWeaknessCategory(annotation.category)) continue
      total += 1

      const item = toWeaknessItem(annotation)
      const detailEntry =
        detail.get(item.key) ??
        {
          ...item,
          count: 0,
          seats: new Set<string>()
        }
      detailEntry.count += 1
      detailEntry.seats.add(work.seat)
      detail.set(item.key, detailEntry)

      const broadEntry =
        broad.get(annotation.category) ??
        {
          key: annotation.category,
          category: annotation.category,
          label: ANNOTATION_CATEGORY_LABELS[annotation.category],
          count: 0,
          seats: new Set<string>()
        }
      broadEntry.count += 1
      broadEntry.seats.add(work.seat)
      broad.set(annotation.category, broadEntry)
    }
  }

  const toRank = (entry: WeaknessAccumulator): WeaknessRankItem => ({
    key: entry.key,
    category: entry.category,
    categoryLabel: ANNOTATION_CATEGORY_LABELS[entry.category],
    ...(entry.subtype ? { subtype: entry.subtype } : {}),
    label: entry.label,
    count: entry.count,
    share: total > 0 ? entry.count / total : 0,
    students: entry.seats.size
  })

  const byRank = (a: WeaknessAccumulator, b: WeaknessAccumulator): number =>
    b.count - a.count ||
    (WEAKNESS_ORDER.get(a.category) ?? 99) - (WEAKNESS_ORDER.get(b.category) ?? 99) ||
    a.label.localeCompare(b.label, 'zh-Hant')

  const weaknesses = [...detail.values()].sort(byRank).map(toRank)
  const categories = [...broad.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        (WEAKNESS_ORDER.get(a.category) ?? 99) - (WEAKNESS_ORDER.get(b.category) ?? 99)
    )
    .map(toRank)

  return { weaknesses, categories }
}

function collectTypos(works: readonly WorkFile[]): TypoRankItem[] {
  const map = new Map<string, TypoAccumulator>()

  for (const work of works) {
    for (const annotation of work.annotations) {
      if (annotation.category !== 'typo') continue
      const wrong = (annotation.meta?.wrong ?? '').trim()
      const correct = (annotation.meta?.correct ?? '').trim()
      if (!wrong && !correct) continue

      const key = `${wrong}\u0000${correct}`
      const entry = map.get(key) ?? { wrong, correct, count: 0, seats: new Set<string>() }
      entry.count += 1
      entry.seats.add(work.seat)
      map.set(key, entry)
    }
  }

  return [...map.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.seats.size - a.seats.size ||
        a.wrong.localeCompare(b.wrong, 'zh-Hant') ||
        a.correct.localeCompare(b.correct, 'zh-Hant')
    )
    .map((entry) => ({
      wrong: entry.wrong,
      correct: entry.correct,
      count: entry.count,
      students: entry.seats.size,
      seats: [...entry.seats].sort((a, b) => a.localeCompare(b))
    }))
}

function countCategories(annotations: readonly Annotation[]): StudentStatsRow['counts'] {
  const counts = { typo: 0, sentence: 0, structure: 0, praise: 0, other: 0 }
  for (const annotation of annotations) {
    if (annotation.category === 'typo') counts.typo += 1
    if (annotation.category === 'sentence') counts.sentence += 1
    if (annotation.category === 'structure') counts.structure += 1
    if (annotation.category === 'praise') counts.praise += 1
    if (annotation.category === 'other') counts.other += 1
  }
  return counts
}

function studentWeaknesses(annotations: readonly Annotation[]): StudentWeaknessItem[] {
  const map = new Map<string, StudentWeaknessItem>()

  for (const annotation of annotations) {
    if (!isWeaknessCategory(annotation.category)) continue
    const item = toWeaknessItem(annotation)
    const entry = map.get(item.key) ?? { ...item, count: 0 }
    entry.count += 1
    map.set(item.key, entry)
  }

  return [...map.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        (WEAKNESS_ORDER.get(a.category) ?? 99) - (WEAKNESS_ORDER.get(b.category) ?? 99) ||
        a.label.localeCompare(b.label, 'zh-Hant')
    )
    .slice(0, 3)
}

function summarize(
  assignment: AssignmentFile,
  rows: readonly StudentStatsRow[]
): StatsSummary {
  const importedRows = rows.filter((row) => row.imported)
  const countedRows = rows.filter((row) => row.counted)
  const doneRows = countedRows.filter(
    (row) => typeof row.score === 'number'
  ) as Array<StudentStatsRow & { score: number }>
  const scores = doneRows.map((row) => row.score).sort((a, b) => a - b)

  const average =
    scores.length > 0
      ? round1(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null
  const median =
    scores.length > 0
      ? scores.length % 2 === 1
        ? scores[(scores.length - 1) / 2]
        : round1((scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2)
      : null

  // 等第依目前量規由高到低；舊資料若有其他名稱，接在後面。
  const gradeLabels = sortGradeBands(assignment.rubric.grades).map((grade) => grade.label)
  const gradeCounts = new Map<string, number>()
  for (const label of gradeLabels) gradeCounts.set(label, 0)
  for (const row of doneRows) {
    if (!row.grade) continue
    gradeCounts.set(row.grade, (gradeCounts.get(row.grade) ?? 0) + 1)
  }
  const grades = [...gradeCounts.entries()]
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label, count }))

  const items: ItemAverage[] = assignment.rubric.items.map((item) => {
    const values = doneRows
      .map((row) => row.items[item.id])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const itemAverage =
      values.length > 0
        ? round1(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null
    return {
      id: item.id,
      name: item.name,
      max: item.max,
      average: itemAverage,
      percent:
        itemAverage === null || item.max <= 0
          ? null
          : round1((itemAverage / item.max) * 100)
    }
  })

  return {
    students: rows.length,
    imported: importedRows.length,
    done: countedRows.length,
    notDone: importedRows.length - countedRows.length,
    missing: rows.length - importedRows.length,
    average,
    median,
    high: scores.length > 0 ? scores[scores.length - 1] : null,
    low: scores.length > 0 ? scores[0] : null,
    grades,
    items
  }
}

/** 建立整份作業的統計；`generatedAt` 可注入，方便測試。 */
export function buildAssignmentStats(
  assignment: AssignmentFile,
  students: readonly Student[],
  works: readonly WorkFile[],
  generatedAt: string = new Date().toISOString()
): AssignmentStats {
  const enrolled = students
    .filter((student) => student.active !== false)
    .sort((a, b) => a.seat.localeCompare(b.seat))
  const scope = new Set(enrolled.map((student) => student.seat))
  const workBySeat = new Map<string, WorkFile>()

  for (const work of works) {
    if (!scope.has(work.seat) || workBySeat.has(work.seat)) continue
    workBySeat.set(work.seat, work)
  }

  const doneWorks = [...workBySeat.values()]
    .filter((work) => work.status === 'done')
    .sort((a, b) => a.seat.localeCompare(b.seat))
  const weaknessResult = collectWeaknesses(doneWorks)
  const typos = collectTypos(doneWorks)

  const rows: StudentStatsRow[] = enrolled.map((student) => {
    const work = workBySeat.get(student.seat)

    if (!work) {
      return {
        seat: student.seat,
        name: student.name,
        status: 'missing',
        imported: false,
        counted: false,
        score: null,
        items: {},
        weaknesses: [],
        counts: { typo: 0, sentence: 0, structure: 0, praise: 0, other: 0 },
        finalChars: 0
      }
    }

    const computed = computeScore(
      work.annotations,
      work.scores?.items ?? {},
      assignment.rubric,
      work.scores?.deduction.override ?? null
    )
    const score =
      typeof work.scores?.total === 'number' ? work.scores.total : computed.total
    const grade = work.scores?.grade ?? resolveGrade(score, assignment.rubric)
    const counted = work.status === 'done'

    return {
      seat: work.seat,
      name: work.name,
      status: work.status,
      imported: true,
      counted,
      score,
      ...(grade ? { grade } : {}),
      items: { ...(work.scores?.items ?? {}) },
      weaknesses: counted ? studentWeaknesses(work.annotations) : [],
      counts: countCategories(work.annotations),
      finalChars: countFinalChars(work.final_comment?.text ?? ''),
      updatedAt: work.updated_at
    }
  })

  return {
    assignmentId: assignment.id,
    title: assignment.title,
    generatedAt,
    summary: summarize(assignment, rows),
    categories: weaknessResult.categories,
    weaknesses: weaknessResult.weaknesses,
    typos,
    students: rows
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export interface StatsCsvFile {
  name: string
  content: string
}

const csvCell = (value: string | number | null | undefined): string => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** UTF-8 BOM＋CRLF，Excel 直接開啟中文不會亂碼。 */
const csvDocument = (rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string =>
  `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`

const percent = (share: number): string => `${(share * 100).toFixed(1)}%`

/** 產生四個 CSV：成績、弱項排行、常錯字、個人弱項。 */
export function statsToCsvFiles(stats: AssignmentStats): StatsCsvFile[] {
  const itemNames = stats.summary.items.map((item) => item.name)

  const scores = csvDocument([
    [
      '座號',
      '姓名',
      '狀態',
      '計入統計',
      '總分',
      '等第',
      ...itemNames,
      '錯字批注',
      '語句批注',
      '結構批注',
      '佳句批注',
      '其他批注',
      '總評字數',
      '更新時間'
    ],
    ...stats.students.map((row) => [
      row.seat,
      row.name,
      WORK_STATUS_LABELS[row.status],
      row.counted ? '是' : '否',
      row.score ?? '',
      row.grade ?? '',
      ...stats.summary.items.map((item) => row.items[item.id] ?? ''),
      row.counts.typo,
      row.counts.sentence,
      row.counts.structure,
      row.counts.praise,
      row.counts.other,
      row.finalChars,
      row.updatedAt ?? ''
    ])
  ])

  const weaknesses = csvDocument([
    ['排名', '類型', '子類', '次數', '占比', '涉及人數'],
    ...stats.weaknesses.map((item, index) => [
      index + 1,
      item.categoryLabel,
      item.subtype ? item.label : '',
      item.count,
      percent(item.share),
      item.students
    ])
  ])

  const typos = csvDocument([
    ['排名', '錯字', '正確', '次數', '人數', '座號'],
    ...stats.typos.map((item, index) => [
      index + 1,
      item.wrong,
      item.correct,
      item.count,
      item.students,
      item.seats.join('、')
    ])
  ])

  const studentWeakness = csvDocument([
    ['座號', '姓名', '狀態', '總分', '等第', '前三弱項', '錯字次數', '批注總數'],
    ...stats.students.map((row) => [
      row.seat,
      row.name,
      WORK_STATUS_LABELS[row.status],
      row.score ?? '',
      row.grade ?? '',
      row.weaknesses.map((item) => `${item.label} ${item.count}`).join('、'),
      row.counts.typo,
      row.counts.typo + row.counts.sentence + row.counts.structure + row.counts.other
    ])
  ])

  return [
    { name: 'scores.csv', content: scores },
    { name: 'weakness-ranking.csv', content: weaknesses },
    { name: 'common-typos.csv', content: typos },
    { name: 'student-weakness.csv', content: studentWeakness }
  ]
}
