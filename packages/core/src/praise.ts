import { normalizeComment } from './review'
import type { WorkFile } from './schema'

/**
 * G6 佳句庫：跨作業收集 praise 批注，去識別後供「本班／全部班級」查看與複製。
 * 純資料運算，不做任何檔案讀寫；來源與範圍由呼叫端決定。
 *
 * 只收 `status === 'done'` 的作品，避免批閱中的半成品佳句混入。
 * 每一筆輸出都不含座號、姓名等任何學生識別欄位。
 */

/** 作業資訊 map 的值；id → title / due_at。 */
export interface PraiseAssignmentInfo {
  title: string
  due_at?: string
}

/** 單筆佳句的來源作業參照。 */
export interface PraiseAssignmentRef {
  id: string
  title: string
  dueAt?: string
}

/** 去重後的一筆佳句。 */
export interface PraiseBankEntry {
  /** 第一次出現的原文。 */
  text: string
  /** 去變數、標點、空白後的正規化字串，用來去重。 */
  normalized: string
  /** 出現總次數。 */
  count: number
  /** 出現在幾份不同作品。 */
  workCount: number
  /** 來源作業（去重、依 id 排序）。 */
  assignments: PraiseAssignmentRef[]
  /** 最早使用時間（ISO；annotation.created_at，缺則 work.updated_at）。 */
  firstAt: string
  /** 最晚使用時間（ISO）。 */
  lastAt: string
}

export interface PraiseBank {
  generatedAt: string
  totalTexts: number
  totalUses: number
  entries: PraiseBankEntry[]
}

interface PraiseAccumulator {
  text: string
  normalized: string
  count: number
  workIds: Set<number>
  assignmentIds: Set<string>
  firstAtMs: number | null
  lastAtMs: number | null
  firstAt: string | null
  lastAt: string | null
}

function toMs(value: string | undefined | null): number | null {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

/**
 * 彙整佳句庫。以 `normalizeComment` 去重，保留第一次出現的原文；
 * 排序為 count 由高到低、lastAt 由新到舊、text 依 zh-Hant。
 * `assignments` 為 id → title/due_at 的對照，缺漏的作業以 id 當標題。
 */
export function buildPraiseBank(
  works: readonly WorkFile[],
  assignments: ReadonlyMap<string, PraiseAssignmentInfo>,
  generatedAt: string = new Date().toISOString()
): PraiseBank {
  const acc = new Map<string, PraiseAccumulator>()

  works.forEach((work, workIndex) => {
    if (work.status !== 'done') return

    for (const annotation of work.annotations) {
      if (annotation.category !== 'praise') continue

      const text = annotation.text ?? ''
      const normalized = normalizeComment(text)
      if (!normalized) continue

      const at = annotation.created_at || work.updated_at
      const atMs = toMs(at)

      let entry = acc.get(normalized)
      if (!entry) {
        entry = {
          text,
          normalized,
          count: 0,
          workIds: new Set<number>(),
          assignmentIds: new Set<string>(),
          firstAtMs: null,
          lastAtMs: null,
          firstAt: null,
          lastAt: null
        }
        acc.set(normalized, entry)
      }

      entry.count += 1
      entry.workIds.add(workIndex)
      entry.assignmentIds.add(work.assignment_id)

      if (atMs !== null) {
        if (entry.firstAtMs === null || atMs < entry.firstAtMs) {
          entry.firstAtMs = atMs
          entry.firstAt = at
        }
        if (entry.lastAtMs === null || atMs > entry.lastAtMs) {
          entry.lastAtMs = atMs
          entry.lastAt = at
        }
      } else if (entry.firstAt === null) {
        // 時間無法解析時仍保留原始字串，避免欄位空白。
        entry.firstAt = at
        entry.lastAt = at
      }
    }
  })

  const entries: PraiseBankEntry[] = [...acc.values()]
    .map((entry) => ({
      text: entry.text,
      normalized: entry.normalized,
      count: entry.count,
      workCount: entry.workIds.size,
      assignments: [...entry.assignmentIds]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => {
          const info = assignments.get(id)
          return {
            id,
            title: info?.title ?? id,
            ...(info?.due_at ? { dueAt: info.due_at } : {})
          }
        }),
      firstAt: entry.firstAt ?? '',
      lastAt: entry.lastAt ?? ''
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      const aLast = toMs(a.lastAt)
      const bLast = toMs(b.lastAt)
      if (aLast !== null && bLast !== null && aLast !== bLast) return bLast - aLast
      return a.text.localeCompare(b.text, 'zh-Hant')
    })

  const totalUses = entries.reduce((sum, entry) => sum + entry.count, 0)

  return {
    generatedAt,
    totalTexts: entries.length,
    totalUses,
    entries
  }
}
