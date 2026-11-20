import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeFileName, type WorkSummary } from '@essay-grader/core'
import { currentRoot, listWorks } from '../data/repository'
import { logInfo, logWarn } from '../logger'
import { exportFeedbackPdf, feedbackBatchDir } from './service'

export type BatchFeedbackStatus =
  | 'exported'
  | 'skipped'
  | 'failed'
  | 'cancelled'

export interface BatchFeedbackItem {
  seat: string
  name: string
  status: BatchFeedbackStatus
  /** `_feedback/` 內的中文檔名；跳過或失敗時為空字串。 */
  fileName: string
  /** 實際寫出的 PDF 路徑；跳過、失敗或取消時為空字串。 */
  path: string
  reason: string
  ms: number
}

export interface BatchFeedbackReport {
  schema_version: 1
  jobId: string
  classId: string
  assignmentId: string
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

export interface BatchFeedbackProgress {
  jobId: string
  classId: string
  assignmentId: string
  /** 1 起算 */
  index: number
  total: number
  seat: string
  name: string
  status: BatchFeedbackStatus
  message: string
  /** 目前已處理完成的份數（含跳過與失敗） */
  completed: number
}

export interface BatchFeedbackInfo {
  outputDir: string
  /** 可輸出的份數：done 且有分數 */
  exportable: number
  /** 目前作業內未完成或未評分的份數 */
  unfinished: number
  total: number
}

export interface BatchFeedbackOptions {
  classId: string
  assignmentId: string
  onProgress?: (progress: BatchFeedbackProgress) => void
  shouldCancel?: () => boolean
}

interface ActiveJob {
  id: string
  cancelled: boolean
  promise: Promise<BatchFeedbackReport> | null
}

let activeJob: ActiveJob | null = null

export function currentBatchJobId(): string | null {
  return activeJob?.id ?? null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeFileAtomic(path: string, data: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

function batchFileName(seat: string, name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return `S${seat}_回饋單.pdf`
  return `S${seat}_${sanitizeFileName(trimmed)}_回饋單.pdf`
}

function escapeCsv(value: string | number): string {
  const text = String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function reportToCsv(report: BatchFeedbackReport): string {
  const header = ['座號', '姓名', '狀態', '檔名', '輸出路徑', '錯誤原因', '耗時(ms)']
  const rows = report.items.map((item) => [
    item.seat,
    item.name,
    item.status,
    item.fileName,
    item.path,
    item.reason,
    item.ms
  ])
  const lines = [header, ...rows].map((row) => row.map(escapeCsv).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

async function writeReport(dir: string, report: BatchFeedbackReport): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFileAtomic(
    join(dir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
  await writeFileAtomic(join(dir, 'report.csv'), reportToCsv(report))
}

function skipReason(work: WorkSummary): string {
  if (work.status === 'grading') return '批閱中，尚未完成'
  if (work.status === 'pending') return '尚未開始批閱'
  if (!work.hasScores) return '已批但尚未評分'
  return '不符合輸出條件'
}

/** 批次輸出前的資訊；只讀資料，不建立資料夾。 */
export async function getBatchFeedbackInfo(
  classId: string,
  assignmentId: string
): Promise<BatchFeedbackInfo> {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫')

  const works = await listWorks(classId, assignmentId)
  const exportable = works.filter(
    (work) => work.status === 'done' && work.hasScores
  ).length

  return {
    outputDir: feedbackBatchDir(root, classId, assignmentId),
    exportable,
    unfinished: works.length - exportable,
    total: works.length
  }
}

/**
 * 逐份匯出整班回饋單。
 * 只處理 `done` 且有分數的作品；其餘列為 skipped。
 * 單份失敗（例如溢頁）只記在該筆，不中斷整批。
 */
export function startBatchFeedback(
  options: BatchFeedbackOptions
): Promise<BatchFeedbackReport> {
  if (activeJob) {
    return Promise.reject(new Error('已有批次回饋單正在進行，請等待完成或先取消'))
  }

  const jobId = randomUUID()
  const job: ActiveJob = { id: jobId, cancelled: false, promise: null }
  const promise = runBatch(job, options)
  job.promise = promise
  activeJob = job

  void promise
    .catch(() => undefined)
    .finally(() => {
      if (activeJob === job) activeJob = null
    })

  return promise
}

/** 要求目前在跑的批次在下一份開始前停止；回傳完整報告。 */
export async function cancelBatchFeedback(
  jobId: string
): Promise<{ canceled: boolean; reason?: string; report?: BatchFeedbackReport }> {
  if (!activeJob || activeJob.id !== jobId) {
    return { canceled: false, reason: '找不到執行中的批次回饋單' }
  }

  activeJob.cancelled = true
  const report = activeJob.promise ? await activeJob.promise : undefined
  return { canceled: true, ...(report ? { report } : {}) }
}

async function runBatch(
  job: ActiveJob,
  options: BatchFeedbackOptions
): Promise<BatchFeedbackReport> {
  const root = currentRoot()
  if (!root) throw new Error('尚未開啟資料庫')

  const { classId, assignmentId } = options
  const started = Date.now()
  const works = await listWorks(classId, assignmentId)
  const total = works.length
  const outputDir = feedbackBatchDir(root, classId, assignmentId)

  await mkdir(outputDir, { recursive: true })

  const items: BatchFeedbackItem[] = []
  let completed = 0
  let exported = 0
  let skipped = 0
  let failed = 0
  let cancelled = 0

  const emit = (item: BatchFeedbackItem, index: number, message: string): void => {
    if (!options.onProgress) return
    try {
      options.onProgress({
        jobId: job.id,
        classId,
        assignmentId,
        index,
        total,
        seat: item.seat,
        name: item.name,
        status: item.status,
        message,
        completed
      })
    } catch {
      // 進度回呼失敗不影響批次
    }
  }

  for (let index = 0; index < works.length; index += 1) {
    const work = works[index]!
    const position = index + 1

    if (job.cancelled || options.shouldCancel?.()) {
      job.cancelled = true
      for (let rest = index; rest < works.length; rest += 1) {
        const pendingWork = works[rest]!
        items.push({
          seat: pendingWork.seat,
          name: pendingWork.name,
          status: 'cancelled',
          fileName: '',
          path: '',
          reason: '已取消，尚未輸出',
          ms: 0
        })
        cancelled += 1
      }
      break
    }

    if (work.status !== 'done' || !work.hasScores) {
      const item: BatchFeedbackItem = {
        seat: work.seat,
        name: work.name,
        status: 'skipped',
        fileName: '',
        path: '',
        reason: skipReason(work),
        ms: 0
      }
      items.push(item)
      skipped += 1
      completed += 1
      emit(item, position, item.reason)
      continue
    }

    const itemStarted = Date.now()
    const fileName = batchFileName(work.seat, work.name)

    try {
      const pdf = await exportFeedbackPdf(classId, assignmentId, work.seat)
      const target = join(outputDir, fileName)
      await writeFileAtomic(target, await readFile(pdf.path))

      const item: BatchFeedbackItem = {
        seat: work.seat,
        name: work.name,
        status: 'exported',
        fileName,
        path: target,
        reason: '',
        ms: Date.now() - itemStarted
      }
      items.push(item)
      exported += 1
      completed += 1
      emit(item, position, `已輸出 ${fileName}`)
    } catch (error) {
      const item: BatchFeedbackItem = {
        seat: work.seat,
        name: work.name,
        status: 'failed',
        fileName: '',
        path: '',
        reason: messageOf(error),
        ms: Date.now() - itemStarted
      }
      items.push(item)
      failed += 1
      completed += 1
      emit(item, position, item.reason)
    }

    // 讓事件迴圈有機會更新 UI，也避免長時間佔住主程序。
    await new Promise((resolve) => setImmediate(resolve))
  }

  const report: BatchFeedbackReport = {
    schema_version: 1,
    jobId: job.id,
    classId,
    assignmentId,
    generatedAt: new Date().toISOString(),
    total,
    exported,
    skipped,
    failed,
    cancelled,
    elapsedMs: Date.now() - started,
    outputDir,
    items
  }

  try {
    await writeReport(outputDir, report)
  } catch (error) {
    logWarn(`[feedback] 批次報告寫入失敗：${messageOf(error)}`)
    throw error
  }

  logInfo(
    `[feedback] 批次完成：total=${total} exported=${exported} skipped=${skipped} failed=${failed} cancelled=${cancelled}`
  )

  return report
}
