import { app, BrowserWindow } from 'electron'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import {
  sanitizeFileName,
  type Annotation,
  type WorkFile
} from '@essay-grader/core'
import {
  auditAssignment,
  closeDatabase,
  createAssignment,
  createClass,
  getAssignmentStats,
  loadWork,
  openDatabase,
  saveClass,
  saveWork
} from './data/repository'
import { logInfo } from './logger'
import { startBatchFeedback } from './feedback/batch'
import { feedbackBatchDir } from './feedback/service'

/**
 * `--soak`：以真實資料庫流程做連續操作壓力測試。
 * 重點是批次回饋單反覆開關隱藏視窗時，記憶體與視窗數是否穩定。
 */

const CLASS_NAME = '高中soak'
const TEACHER = 'soak'
const TITLE = 'soak 壓力測試'
const STUDENT_COUNT = 45
const DEFAULT_MINUTES = 10
const SETTLE_MS = 700
const SAMPLE_INTERVAL_MS = 60_000

const THRESHOLDS = {
  finalMB: 700,
  peakMB: 800,
  growthMB: 180
}

interface MemorySample {
  at: string
  elapsedSec: number
  privateMB: number
  processes: number
  windows: number
  cycle: number
  pdfs: number
}

interface SoakReport {
  schema_version: 1
  mode: 'soak'
  minutes: number
  elapsedMinutes: number
  startedAt: string
  endedAt: string
  cycles: number
  batches: number
  pdfs: number
  audits: number
  statsRuns: number
  autosaves: number
  warmup: {
    exported: number
    failed: number
    ms: number
  }
  cycleTimings: Array<{ cycle: number; ms: number; pdfs: number }>
  memory: {
    baselineMB: number
    finalMB: number
    peakMB: number
    growthMB: number
    series: MemorySample[]
    measurementMethod: string
    thresholds: typeof THRESHOLDS
  }
  windows: {
    baseline: number
    maxDuringBatch: number
    maxAfterBatch: number
    final: number
    leaked: boolean
  }
  finalPdf: {
    checked: number
    onePage: number
    over20kb: number
    failed: string[]
  }
  works: {
    checked: number
    readable: number
    onePage: number
    scoreUnchanged: number
    failed: string[]
  }
  checks: {
    auditClean: boolean
    statsDone: boolean
    batchesComplete: boolean
    windowsStable: boolean
    worksIntact: boolean
    finalPdfValid: boolean
    memoryWithinThreshold: boolean
    noErrors: boolean
  }
  errors: string[]
  pass: boolean
}

const pad = (value: number): string => String(value).padStart(2, '0')
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function parseMinutes(argv: string[]): number {
  const inline = argv.find((arg) => arg.startsWith('--soak-minutes='))
  const raw = inline
    ? inline.slice('--soak-minutes='.length)
    : argv[argv.indexOf('--soak-minutes') + 1]
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MINUTES
  return Math.min(120, Math.max(0.1, value))
}

function countPdfPages(pdf: Buffer): number {
  const raw = pdf.toString('latin1')
  return (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 逐行程加總 private bytes（kB）；型別沒有時退回 working set／resident set。 */
function readMemory(): {
  mb: number
  processes: number
  method: 'private' | 'workingSetSize' | 'residentSet'
} {
  let totalKb = 0
  let fallback: 'workingSetSize' | 'residentSet' | null = null
  const metrics = app.getAppMetrics()

  for (const metric of metrics) {
    // Electron 45 執行時提供 privateBytes，但 d.ts 目前寫成 private。
    const memory = metric.memory as unknown as {
      privateBytes?: number
      private?: number
      workingSetSize?: number
      residentSet?: number
    }
    const privateBytes =
      typeof memory.privateBytes === 'number' && Number.isFinite(memory.privateBytes)
        ? memory.privateBytes
        : typeof memory.private === 'number' && Number.isFinite(memory.private)
          ? memory.private
          : null
    if (privateBytes !== null) {
      totalKb += privateBytes
      continue
    }
    if (typeof memory.workingSetSize === 'number' && Number.isFinite(memory.workingSetSize)) {
      totalKb += memory.workingSetSize
      fallback = 'workingSetSize'
      continue
    }
    totalKb += memory.residentSet ?? 0
    fallback = 'residentSet'
  }

  return {
    mb: Math.round(totalKb / 1024),
    processes: metrics.length,
    method: fallback ?? 'private'
  }
}

function memoryMethodText(method: 'private' | 'workingSetSize' | 'residentSet'): string {
  if (method === 'private') {
    return 'app.getAppMetrics() 逐行程加總 memory.privateBytes（kB→MB）'
  }
  if (method === 'workingSetSize') {
    return 'app.getAppMetrics() 逐行程加總 workingSetSize（privateBytes 不可用，退回 working set）'
  }
  return 'app.getAppMetrics() 逐行程加總 memory.residentSet（privateBytes 與 working set 皆不可用）'
}

function annotation(
  seat: string,
  index: number,
  category: Annotation['category'],
  text: string,
  meta?: Annotation['meta']
): Annotation {
  return {
    id: `soak-${seat}-${String(index).padStart(2, '0')}`,
    page_id: 'p1',
    anchor: { x: 0.06 + (index % 70) * 0.012, y: 0.14 + (index % 6) * 0.1 },
    category,
    text,
    ...(meta ? { meta } : {}),
    created_at: '2026-11-20T09:00:00.000Z'
  }
}

/** 每份總評都不同，避免觸發 final_reuse；去標點後仍 ≥30 字。 */
function finalComment(seat: string): string {
  const n = Number(seat)
  return `第 ${n} 號作品以校園生活為題，從打掃時間的具體場景寫出心情轉折，段落安排清楚，語句大致通順；結尾若能回應題旨並補上一句自我反思，主旨會更集中，情感也更有層次。`
}

/** autosave 固定覆寫這段，長度不隨循環累加；每份仍不同。 */
function autosaveComment(seat: string, cycle: number): string {
  const n = Number(seat)
  return `第 ${n} 號 soak 第 ${cycle} 圈自動儲存：以固定長度文字覆寫總評，確認載入、儲存與重新載入內容一致，且不影響分數與頁數，也不產生重複總評。`
}

function makeWork(
  classId: string,
  assignmentId: string,
  seat: string,
  name: string,
  scoreTotal: number
): WorkFile {
  const n = Number(seat)
  const items = {
    content: 30 + (n % 7),
    structure: 22 + (n % 5),
    language: 21 + (n % 6)
  }
  const annotations: Annotation[] = [
    annotation(seat, 1, 'typo', '在再不分', { wrong: '在', correct: '再' }),
    annotation(seat, 2, 'typo', '的得不分', { wrong: '的', correct: '得' }),
    annotation(seat, 3, 'sentence', '語句可再精簡', {
      original: '我因為下雨的關係所以沒有去學校。',
      revised: '因為下雨，我沒有去學校。',
      reason: '刪去冗贅的因果連接詞'
    }),
    annotation(seat, 4, 'structure', '段落之間補一句過渡。'),
    annotation(seat, 5, 'praise', '「母親的手像一張舊地圖。」比喻新鮮。')
  ]

  return {
    schema_version: 1,
    class_id: classId,
    assignment_id: assignmentId,
    seat,
    name,
    status: 'done',
    pages: [{ id: 'p1', file: 'p1.jpg', width: 320, height: 440 }],
    annotations,
    scores: {
      items,
      deduction: { typo: 1, punct: 0, override: null },
      total: scoreTotal,
      grade: scoreTotal >= 85 ? 'A+' : scoreTotal >= 75 ? 'B++' : 'B+'
    },
    final_comment: { text: finalComment(seat) },
    updated_at: '2026-11-20T09:00:00.000Z'
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function runSoak(): Promise<number> {
  const minutes = parseMinutes(process.argv)
  const targetMs = minutes * 60_000
  const repoRoot = join(app.getAppPath(), '..', '..')
  const workDir = join(repoRoot, 'spike-out', 'soak')
  const dbRoot = join(workDir, 'db')
  const assets = join(workDir, 'assets')
  const userData = join(workDir, 'userData')
  const reportPath = join(repoRoot, 'spike-out', 'soak-report.json')
  const startedAt = new Date()

  await rm(workDir, { recursive: true, force: true })
  await mkdir(dbRoot, { recursive: true })
  await mkdir(assets, { recursive: true })
  await mkdir(userData, { recursive: true })
  app.setPath('userData', userData)

  const errors: string[] = []
  const onUncaught = (error: unknown): void => {
    errors.push(`uncaughtException: ${messageOf(error)}`)
  }
  const onRejection = (reason: unknown): void => {
    errors.push(`unhandledRejection: ${messageOf(reason)}`)
  }
  const onChildGone = (_event: unknown, details: { type?: string; reason?: string }): void => {
    errors.push(`child-process-gone: ${details.type ?? 'unknown'}/${details.reason ?? 'unknown'}`)
  }
  const onRenderGone = (_event: unknown, _webContents: unknown, details: { reason?: string }): void => {
    errors.push(`render-process-gone: ${details.reason ?? 'unknown'}`)
  }
  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onRejection)
  app.on('child-process-gone', onChildGone)
  app.on('render-process-gone', onRenderGone)

  let cycles = 0
  let batches = 0
  let pdfs = 0
  let audits = 0
  let statsRuns = 0
  let autosaves = 0
  let auditClean = true
  let statsDone = true
  let batchesComplete = true
  let windowsStable = true
  let worksIntact = true
  let finalPdfValid = true

  const series: MemorySample[] = []
  const windowBaselineRef = { value: 0 }
  const counters = { cycle: 0, pdfs: 0 }
  let maxDuringBatch = 0
  let maxAfterBatch = 0
  let lastSampleAt = 0
  let lastConsoleMinute = -1
  let sampleTimer: ReturnType<typeof setInterval> | null = null
  let windowTimer: ReturnType<typeof setInterval> | null = null
  let measurementMethod: 'private' | 'workingSetSize' | 'residentSet' = 'private'

  const sample = (force = false): MemorySample | null => {
    const now = Date.now()
    if (!force && now - lastSampleAt < 5_000) return null
    lastSampleAt = now
    const memory = readMemory()
    measurementMethod = memory.method
    const entry: MemorySample = {
      at: new Date().toISOString(),
      elapsedSec: Math.round((now - startedAt.getTime()) / 1000),
      privateMB: memory.mb,
      processes: memory.processes,
      windows: BrowserWindow.getAllWindows().length,
      cycle: counters.cycle,
      pdfs: counters.pdfs
    }
    series.push(entry)

    const elapsedMinute = Math.floor(entry.elapsedSec / 60)
    if (elapsedMinute > lastConsoleMinute) {
      lastConsoleMinute = elapsedMinute
      console.log(
        `[soak] ${String(elapsedMinute).padStart(2, '0')} 分：${entry.privateMB} MB、` +
          `${entry.processes} 行程、${entry.windows} 視窗、cycle ${entry.cycle}、` +
          `PDF ${entry.pdfs}、錯誤 ${errors.length}`
      )
    }
    return entry
  }

  const expectedScores = new Map<string, number>()
  let warmup = { exported: 0, failed: 0, ms: 0 }
  let baselineMB = 0
  const cycleTimings: Array<{ cycle: number; ms: number; pdfs: number }> = []

  try {
    console.log(
      `[soak] 開始：${minutes} 分鐘、${STUDENT_COUNT} 位學生、每圈 ${STUDENT_COUNT} 份回饋單`
    )
    await openDatabase(dbRoot, { remember: false })
    logInfo(`[soak] 暫存資料庫 ${dbRoot}`)

    const created = await createClass({
      classNo: '399',
      name: CLASS_NAME,
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: TEACHER
    })

    const students = Array.from({ length: STUDENT_COUNT }, (_, index) => {
      const seat = pad(index + 1)
      return { seat, name: `學生${seat}`, active: true }
    })
    await saveClass({
      schema_version: 1,
      id: created.id,
      name: CLASS_NAME,
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: TEACHER,
      students
    })

    const assignment = await createAssignment({
      classId: created.id,
      title: TITLE,
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-20T00:00:00.000Z'
    })

    const template = join(assets, 'page.jpg')
    await sharp({
      create: {
        width: 320,
        height: 440,
        channels: 3,
        background: { r: 248, g: 245, b: 236 }
      }
    })
      .jpeg({ quality: 55 })
      .toFile(template)

    for (const student of students) {
      const dir = join(dbRoot, created.id, assignment.id, `S${student.seat}`)
      await mkdir(dir, { recursive: true })
      await copyFile(template, join(dir, 'p1.jpg'))
      // 分數落在 rubric 範圍內，且每份略有差異，方便最後比對未被改寫。
      const total = 62 + (Number(student.seat) % 29)
      expectedScores.set(student.seat, total)
      await saveWork(
        created.id,
        assignment.id,
        student.seat,
        makeWork(created.id, assignment.id, student.seat, student.name, total)
      )
    }
    console.log(
      `[soak] 測試資料就緒：${students.length} 份 done、每份 1 頁、5 個批注`
    )

    // ---- 暖機 ------------------------------------------------------------
    const warmStarted = Date.now()
    const warmReport = await startBatchFeedback({
      classId: created.id,
      assignmentId: assignment.id
    })
    warmup = {
      exported: warmReport.exported,
      failed: warmReport.failed,
      ms: Date.now() - warmStarted
    }
    batches += 1
    pdfs += warmReport.exported
    counters.pdfs = pdfs
    if (warmReport.exported !== STUDENT_COUNT || warmReport.failed !== 0) {
      batchesComplete = false
      errors.push(
        `暖機批次異常：exported=${warmReport.exported} failed=${warmReport.failed}`
      )
    }
    maxDuringBatch = Math.max(maxDuringBatch, BrowserWindow.getAllWindows().length)
    await delay(1_500)
    windowBaselineRef.value = BrowserWindow.getAllWindows().length
    const baseline = sample(true)
    baselineMB = baseline?.privateMB ?? 0
    console.log(
      `[soak] 暖機完成：${warmup.exported} 份、${warmup.ms} ms；baseline ${baselineMB} MB、` +
        `視窗 ${windowBaselineRef.value}`
    )

    sampleTimer = setInterval(() => {
      sample()
    }, SAMPLE_INTERVAL_MS)
    windowTimer = setInterval(() => {
      maxDuringBatch = Math.max(maxDuringBatch, BrowserWindow.getAllWindows().length)
    }, 500)

    // ---- 主循環 ----------------------------------------------------------
    const deadline = Date.now() + targetMs
    while (Date.now() < deadline || cycles === 0) {
      cycles += 1
      counters.cycle = cycles
      const cycleStarted = Date.now()

      // 1) 批次檢查
      audits += 1
      const audit = await auditAssignment(created.id, assignment.id)
      const auditOk =
        audit.totals.students === STUDENT_COUNT &&
        audit.totals.imported === STUDENT_COUNT &&
        audit.totals.done === STUDENT_COUNT &&
        audit.totals.missing === 0 &&
        audit.totals.problems === 0 &&
        audit.totals.warnings === 0 &&
        audit.clean
      if (!auditOk) {
        auditClean = false
        errors.push(
          `cycle ${cycles} audit：done=${audit.totals.done} problems=${audit.totals.problems} ` +
            `warnings=${audit.totals.warnings} missing=${audit.totals.missing}`
        )
      }

      // 2) 統計
      statsRuns += 1
      const stats = await getAssignmentStats(created.id, assignment.id)
      if (
        stats.summary.students !== STUDENT_COUNT ||
        stats.summary.done !== STUDENT_COUNT ||
        stats.summary.missing !== 0
      ) {
        statsDone = false
        errors.push(
          `cycle ${cycles} stats：students=${stats.summary.students} done=${stats.summary.done} ` +
            `missing=${stats.summary.missing}`
        )
      }

      // 3) 批次回饋單：本圈最重要的壓力來源
      const batchReport = await startBatchFeedback({
        classId: created.id,
        assignmentId: assignment.id
      })
      batches += 1
      pdfs += batchReport.exported
      counters.pdfs = pdfs
      maxDuringBatch = Math.max(maxDuringBatch, BrowserWindow.getAllWindows().length)

      if (
        batchReport.total !== STUDENT_COUNT ||
        batchReport.exported !== STUDENT_COUNT ||
        batchReport.failed !== 0 ||
        batchReport.skipped !== 0 ||
        batchReport.cancelled !== 0
      ) {
        batchesComplete = false
        errors.push(
          `cycle ${cycles} batch：total=${batchReport.total} exported=${batchReport.exported} ` +
            `failed=${batchReport.failed} skipped=${batchReport.skipped} ` +
            `cancelled=${batchReport.cancelled}`
        )
      }

      const windowsAfterBatch = BrowserWindow.getAllWindows().length
      maxAfterBatch = Math.max(maxAfterBatch, windowsAfterBatch)
      if (windowsAfterBatch > windowBaselineRef.value) {
        windowsStable = false
        errors.push(
          `cycle ${cycles} 視窗未回收：${windowsAfterBatch}（baseline ${windowBaselineRef.value}）`
        )
      }

      // 4) 輪替 3 位學生做 autosave
      for (let offset = 0; offset < 3; offset += 1) {
        const seat = pad(((cycles - 1) * 3 + offset) % STUDENT_COUNT + 1)
        const expectedTotal = expectedScores.get(seat)
        try {
          const before = await loadWork(created.id, assignment.id, seat)
          const text = autosaveComment(seat, cycles)
          await saveWork(created.id, assignment.id, seat, {
            ...before,
            status: 'done',
            final_comment: { text },
            updated_at: new Date().toISOString()
          })
          const after = await loadWork(created.id, assignment.id, seat)
          const ok =
            after.final_comment?.text === text &&
            after.pages.length === 1 &&
            after.status === 'done' &&
            after.scores?.total === expectedTotal
          if (ok) {
            autosaves += 1
          } else {
            errors.push(`cycle ${cycles} S${seat} autosave 驗證失敗`)
          }
        } catch (error) {
          errors.push(`cycle ${cycles} S${seat} autosave：${messageOf(error)}`)
        }
      }

      await delay(SETTLE_MS + (cycles % 4) * 50)
      sample()
      const cycleMs = Date.now() - cycleStarted
      cycleTimings.push({ cycle: cycles, ms: cycleMs, pdfs: batchReport.exported })
      if (cycleMs > 60_000) {
        console.log(`[soak] cycle ${cycles} 耗時 ${(cycleMs / 1000).toFixed(1)} 秒`)
      }
    }

    // ---- 收尾 ------------------------------------------------------------
    if (sampleTimer) clearInterval(sampleTimer)
    sampleTimer = null
    if (windowTimer) clearInterval(windowTimer)
    windowTimer = null
    await delay(1_000)
    const finalSample = sample(true)

    // 所有 work.json 仍可讀、1 頁、分數未變
    const worksFailed: string[] = []
    let readable = 0
    let onePage = 0
    let scoreUnchanged = 0
    for (const student of students) {
      try {
        const work = await loadWork(created.id, assignment.id, student.seat)
        readable += 1
        if (work.pages.length === 1) onePage += 1
        const expected = expectedScores.get(student.seat)
        if (work.scores?.total === expected) scoreUnchanged += 1
        else worksFailed.push(`S${student.seat} 分數改變`)
        if (work.status !== 'done') worksFailed.push(`S${student.seat} 狀態不是 done`)
        if (work.pages.length !== 1) worksFailed.push(`S${student.seat} 頁數不是 1`)
      } catch (error) {
        worksFailed.push(`S${student.seat} 無法讀取：${messageOf(error)}`)
      }
    }
    worksIntact =
      readable === STUDENT_COUNT &&
      onePage === STUDENT_COUNT &&
      scoreUnchanged === STUDENT_COUNT &&
      worksFailed.length === 0

    // 最後一輪批次 PDF：1 頁、>20 KB
    const pdfFailed: string[] = []
    let onePagePdf = 0
    let over20Kb = 0
    const outputDir = feedbackBatchDir(dbRoot, created.id, assignment.id)
    const files = await readdir(outputDir)
    const pdfFiles = files.filter((file) => file.toLowerCase().endsWith('.pdf'))
    if (pdfFiles.length !== STUDENT_COUNT) {
      pdfFailed.push(`_feedback PDF 數量 ${pdfFiles.length}，預期 ${STUDENT_COUNT}`)
    }
    for (const student of students) {
      const path = join(
        outputDir,
        `S${student.seat}_${sanitizeFileName(student.name)}_回饋單.pdf`
      )
      try {
        if (!(await exists(path))) {
          pdfFailed.push(`S${student.seat} 缺少 PDF`)
          continue
        }
        const buffer = await readFile(path)
        const pages = countPdfPages(buffer)
        if (pages === 1) onePagePdf += 1
        else pdfFailed.push(`S${student.seat} PDF ${pages} 頁`)
        if (buffer.length > 20_000) over20Kb += 1
        else pdfFailed.push(`S${student.seat} PDF 僅 ${buffer.length} bytes`)
      } catch (error) {
        pdfFailed.push(`S${student.seat} PDF 讀取失敗：${messageOf(error)}`)
      }
    }
    finalPdfValid =
      pdfFiles.length === STUDENT_COUNT &&
      onePagePdf === STUDENT_COUNT &&
      over20Kb === STUDENT_COUNT &&
      pdfFailed.length === 0

    const finalWindows = BrowserWindow.getAllWindows().length
    if (finalWindows > windowBaselineRef.value) {
      windowsStable = false
      errors.push(`結束時視窗 ${finalWindows}，baseline ${windowBaselineRef.value}`)
    }

    const finalMB = finalSample?.privateMB ?? readMemory().mb
    const peakMB = series.reduce((peak, entry) => Math.max(peak, entry.privateMB), 0)
    const growthMB = finalMB - baselineMB
    const memoryWithinThreshold =
      finalMB < THRESHOLDS.finalMB &&
      peakMB < THRESHOLDS.peakMB &&
      growthMB < THRESHOLDS.growthMB

    const checks = {
      auditClean,
      statsDone,
      batchesComplete,
      windowsStable,
      worksIntact,
      finalPdfValid,
      memoryWithinThreshold,
      noErrors: errors.length === 0
    }
    const pass = Object.values(checks).every(Boolean)
    const endedAt = new Date()
    const elapsedMinutes = Math.round(((endedAt.getTime() - startedAt.getTime()) / 60_000) * 100) / 100

    const report: SoakReport = {
      schema_version: 1,
      mode: 'soak',
      minutes,
      elapsedMinutes,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      cycles,
      batches,
      pdfs,
      audits,
      statsRuns,
      autosaves,
      warmup,
      cycleTimings,
      memory: {
        baselineMB,
        finalMB,
        peakMB,
        growthMB,
        series,
        measurementMethod: memoryMethodText(measurementMethod),
        thresholds: THRESHOLDS
      },
      windows: {
        baseline: windowBaselineRef.value,
        maxDuringBatch,
        maxAfterBatch,
        final: finalWindows,
        leaked: !windowsStable
      },
      finalPdf: {
        checked: STUDENT_COUNT,
        onePage: onePagePdf,
        over20kb: over20Kb,
        failed: pdfFailed
      },
      works: {
        checked: STUDENT_COUNT,
        readable,
        onePage,
        scoreUnchanged,
        failed: worksFailed
      },
      checks,
      errors,
      pass
    }

    await writeJson(reportPath, report)

    console.log('')
    console.log(
      `[soak] 完成：${cycles} 圈、${batches} 次批次、${pdfs} 份 PDF、${autosaves} 次 autosave`
    )
    console.log(
      `[soak] 記憶體：baseline ${baselineMB} MB、final ${finalMB} MB、peak ${peakMB} MB、` +
        `growth ${growthMB} MB（門檻 ${THRESHOLDS.finalMB}/${THRESHOLDS.peakMB}/${THRESHOLDS.growthMB}）`
    )
    console.log(
      `[soak] 視窗：baseline ${windowBaselineRef.value}、批次中最多 ${maxDuringBatch}、` +
        `批次後最多 ${maxAfterBatch}、結束 ${finalWindows}`
    )
    console.log(
      `[soak] 結束驗證：works ${readable}/${STUDENT_COUNT}、PDF ${onePagePdf}/${STUDENT_COUNT} 單頁、` +
        `錯誤 ${errors.length}`
    )
    for (const [name, ok] of Object.entries(checks)) {
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`)
    }
    console.log(`[soak] 報告：${reportPath}`)

    // 先關資料庫，確認 watcher 與鎖都能正常收尾。
    await closeDatabase()
    return pass ? 0 : 1
  } catch (error) {
    if (sampleTimer) clearInterval(sampleTimer)
    if (windowTimer) clearInterval(windowTimer)
    errors.push(`fatal: ${messageOf(error)}`)
    console.error(`[soak] 執行失敗：${messageOf(error)}`)

    const finalMB = series.at(-1)?.privateMB ?? readMemory().mb
    const peakMB = series.reduce((peak, entry) => Math.max(peak, entry.privateMB), 0)
    const endedAt = new Date()
    const report: SoakReport = {
      schema_version: 1,
      mode: 'soak',
      minutes,
      elapsedMinutes:
        Math.round(((endedAt.getTime() - startedAt.getTime()) / 60_000) * 100) / 100,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      cycles,
      batches,
      pdfs,
      audits,
      statsRuns,
      autosaves,
      warmup,
      cycleTimings,
      memory: {
        baselineMB,
        finalMB,
        peakMB,
        growthMB: finalMB - baselineMB,
        series,
        measurementMethod: memoryMethodText(measurementMethod),
        thresholds: THRESHOLDS
      },
      windows: {
        baseline: windowBaselineRef.value,
        maxDuringBatch,
        maxAfterBatch,
        final: BrowserWindow.getAllWindows().length,
        leaked: !windowsStable
      },
      finalPdf: {
        checked: 0,
        onePage: 0,
        over20kb: 0,
        failed: []
      },
      works: {
        checked: 0,
        readable: 0,
        onePage: 0,
        scoreUnchanged: 0,
        failed: []
      },
      checks: {
        auditClean,
        statsDone,
        batchesComplete,
        windowsStable,
        worksIntact: false,
        finalPdfValid: false,
        memoryWithinThreshold: false,
        noErrors: false
      },
      errors,
      pass: false
    }
    try {
      await writeJson(reportPath, report)
      console.log(`[soak] 失敗報告：${reportPath}`)
    } catch (writeError) {
      console.error(`[soak] 報告寫入失敗：${messageOf(writeError)}`)
    }

    try {
      await closeDatabase()
    } catch {
      // 已關閉或從未開啟
    }
    return 1
  } finally {
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onRejection)
    app.off('child-process-gone', onChildGone)
    app.off('render-process-gone', onRenderGone)
  }
}
