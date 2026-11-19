import type { AssignmentFile, Student, WorkFile, WorkStatus } from './schema'
import {
  computeScore,
  countFinalChars,
  normalizeComment,
  type ComputedScore
} from './review'

/**
 * 作業層級的批次檢查。
 * 只做純資料運算，不碰檔案系統；缺頁檔案由 main 端確認後再用
 * `appendMissingPageIssues` 補上，方便單獨測試規則。
 */

export type AuditIssueType =
  | 'missing'
  | 'final_short'
  | 'final_reuse'
  | 'unscored'
  | 'missing_page'
  | 'incomplete'

export const AUDIT_ISSUE_LABELS: Record<AuditIssueType, string> = {
  missing: '未匯入',
  final_short: '總評不足',
  final_reuse: '總評重複超限',
  unscored: '未評分',
  missing_page: '缺頁檔案',
  incomplete: '尚未完成'
}

export interface AuditIssue {
  type: AuditIssueType
  /** true 會阻擋完成；false 僅提醒（例如尚未完成批閱）。 */
  blocking: boolean
  message: string
}

export interface AuditWorkRow {
  seat: string
  name: string
  /** 尚未匯入時為 missing。 */
  status: WorkStatus | 'missing'
  imported: boolean
  issues: AuditIssue[]
  /** 是否有會阻擋完成的問題。 */
  blocked: boolean
  finalChars: number
  score: ComputedScore | null
}

export interface AuditTotals {
  /** 在學人數 */
  students: number
  imported: number
  pending: number
  grading: number
  done: number
  /** 名單有學生但沒有 work.json */
  missing: number
  /** 會阻擋完成的問題條數 */
  problems: number
  /** 僅提醒的問題條數（目前只有「尚未完成」） */
  warnings: number
  /** problems + warnings */
  issues: number
}

export interface AssignmentAudit {
  assignmentId: string
  generatedAt: string
  totals: AuditTotals
  /** 沒有任何會阻擋完成的問題 */
  clean: boolean
  /** 依座號排序，涵蓋所有在學學生 */
  rows: AuditWorkRow[]
}

const makeIssue = (
  type: AuditIssueType,
  message: string,
  blocking = true
): AuditIssue => ({ type, message, blocking })

const STATUS_TEXT: Record<WorkStatus, string> = {
  pending: '待批',
  grading: '批閱中',
  done: '已批'
}

/** 量規分項的缺漏與超範圍合併成一個問題，避免同一份作品洗版。 */
function scoreIssue(
  work: WorkFile,
  assignment: Pick<AssignmentFile, 'rubric'>
): AuditIssue | null {
  const items = work.scores?.items ?? {}
  const missing: string[] = []
  const outOfRange: string[] = []

  for (const item of assignment.rubric.items) {
    const value = items[item.id]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      missing.push(item.name)
      continue
    }
    if (value < 0 || value > item.max) {
      outOfRange.push(`${item.name} ${value}（上限 ${item.max}）`)
    }
  }

  const parts: string[] = []
  if (missing.length > 0) parts.push(`未評分：${missing.join('、')}`)
  if (outOfRange.length > 0) parts.push(`分數超出範圍：${outOfRange.join('、')}`)
  if (parts.length === 0) return null

  return makeIssue('unscored', parts.join('；'))
}

function finalize(
  assignmentId: string,
  studentCount: number,
  rows: AuditWorkRow[],
  generatedAt: string
): AssignmentAudit {
  const totals: AuditTotals = {
    students: studentCount,
    imported: 0,
    pending: 0,
    grading: 0,
    done: 0,
    missing: 0,
    problems: 0,
    warnings: 0,
    issues: 0
  }

  for (const row of rows) {
    if (row.imported) {
      totals.imported += 1
      if (row.status === 'pending') totals.pending += 1
      if (row.status === 'grading') totals.grading += 1
      if (row.status === 'done') totals.done += 1
    } else {
      totals.missing += 1
    }

    for (const issue of row.issues) {
      totals.issues += 1
      if (issue.blocking) totals.problems += 1
      else totals.warnings += 1
    }
  }

  return {
    assignmentId,
    generatedAt,
    totals,
    clean: totals.problems === 0,
    rows
  }
}

/**
 * 掃描整份作業。`students` 只計入在學名單，`works` 以座號為鍵；
 * 同一座號若有多筆只取第一筆（正常情況不會發生）。
 */
export function auditWorks(
  assignment: Pick<AssignmentFile, 'id' | 'rubric' | 'rules'>,
  students: readonly Student[],
  works: readonly WorkFile[],
  generatedAt: string = new Date().toISOString()
): AssignmentAudit {
  const enrolled = students
    .filter((student) => student.active !== false)
    .sort((a, b) => a.seat.localeCompare(b.seat))
  const scope = new Set(enrolled.map((student) => student.seat))

  const workBySeat = new Map<string, WorkFile>()
  for (const work of works) {
    if (!scope.has(work.seat) || workBySeat.has(work.seat)) continue
    workBySeat.set(work.seat, work)
  }

  // 先依座號決定重複順序：前 final_max_reuse 次合法，之後才標記。
  const reuseSeats = new Map<string, string[]>()
  for (const work of [...workBySeat.values()].sort((a, b) => a.seat.localeCompare(b.seat))) {
    const normalized = normalizeComment(work.final_comment?.text ?? '')
    if (!normalized) continue
    const list = reuseSeats.get(normalized) ?? []
    list.push(work.seat)
    reuseSeats.set(normalized, list)
  }

  const rows: AuditWorkRow[] = enrolled.map((student) => {
    const work = workBySeat.get(student.seat)

    if (!work) {
      return {
        seat: student.seat,
        name: student.name,
        status: 'missing',
        imported: false,
        issues: [
          makeIssue('missing', '名單有這位學生，但尚未匯入作品（缺 work.json）')
        ],
        blocked: true,
        finalChars: 0,
        score: null
      }
    }

    const issues: AuditIssue[] = []
    const finalText = work.final_comment?.text ?? ''
    const finalChars = countFinalChars(finalText)
    const minChars = assignment.rules.final_min_chars

    if (finalChars < minChars) {
      issues.push(
        makeIssue('final_short', `總評不足 ${minChars} 字（目前 ${finalChars} 字）`)
      )
    }

    const normalized = normalizeComment(finalText)
    if (normalized) {
      const group = reuseSeats.get(normalized) ?? []
      const index = group.indexOf(work.seat)
      const priorSeats = index > 0 ? group.slice(0, index) : []
      if (priorSeats.length >= assignment.rules.final_max_reuse) {
        issues.push(
          makeIssue(
            'final_reuse',
            `相同的總評已用於座號 ${priorSeats.join('、')}（${priorSeats.length} 次），這是第 ${
              priorSeats.length + 1
            } 次，超過上限 ${assignment.rules.final_max_reuse} 次`
          )
        )
      }
    }

    const scoreProblem = scoreIssue(work, assignment)
    if (scoreProblem) issues.push(scoreProblem)

    if (work.status !== 'done') {
      issues.push(
        makeIssue(
          'incomplete',
          `尚未完成批閱（目前：${STATUS_TEXT[work.status]}）`,
          false
        )
      )
    }

    const score = computeScore(
      work.annotations,
      work.scores?.items ?? {},
      assignment.rubric,
      work.scores?.deduction.override ?? null
    )

    return {
      seat: student.seat,
      name: student.name,
      status: work.status,
      imported: true,
      issues,
      blocked: issues.some((issue) => issue.blocking),
      finalChars,
      score
    }
  })

  return finalize(assignment.id, enrolled.length, rows, generatedAt)
}

/**
 * 補上「work.json 有頁面紀錄、但圖片檔不存在」的問題。
 * `missingBySeat` 的值是缺少的檔名清單。
 */
export function appendMissingPageIssues(
  audit: AssignmentAudit,
  missingBySeat: ReadonlyMap<string, readonly string[]>
): AssignmentAudit {
  if (missingBySeat.size === 0) return audit

  const rows = audit.rows.map((row) => {
    const files = missingBySeat.get(row.seat)
    if (!files || files.length === 0) return row
    const issues = [
      ...row.issues,
      makeIssue('missing_page', `缺頁檔案：${files.join('、')}`)
    ]
    return { ...row, issues, blocked: issues.some((issue) => issue.blocking) }
  })

  return finalize(audit.assignmentId, audit.totals.students, rows, audit.generatedAt)
}
