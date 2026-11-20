import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BUILTIN_LIBRARY,
  LIBRARY_VERSION,
  RUBRIC_PRESETS,
  computeScore,
  normalizeComment,
  resolveGrade,
  validateWork,
  type Annotation,
  type AssignmentFile,
  type GradeBand,
  type WorkFile
} from '@essay-grader/core'
import { preprocessImage } from '../import/image'
import {
  closeDatabase,
  createAssignment,
  createClass,
  loadAssignment,
  loadWork,
  openDatabase,
  readWorkPage,
  saveClass,
  saveWork,
  updateAssignmentRubric
} from './repository'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const now = (): string => new Date().toISOString()

/** 產生測試用批注，只填驗證會用到的欄位。 */
function typoAnnotation(index: number): Annotation {
  return {
    id: `typo-${index}`,
    page_id: 'p1',
    anchor: { x: 0.1 * index, y: 0.1 },
    category: 'typo',
    text: '錯字',
    created_at: now()
  }
}

/** 開隱藏視窗載入 renderer，確認主畫面、新的 preload API 與批閱畫面都能載入。 */
async function runUiSmoke(): Promise<{ ok: boolean; detail: string }> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (expression: string, timeoutMs: number): Promise<boolean> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const ok = (await win.webContents.executeJavaScript(`Boolean(${expression})`)) as boolean
      if (ok) return true
      await delay(120)
    }
    return false
  }

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))

    let text = ''
    for (let i = 0; i < 30; i++) {
      await delay(100)
      text = (await win.webContents.executeJavaScript('document.body.innerText')) as string
      if (text.includes('作文批閱') && !text.includes('載入中')) break
    }

    const hasApi = (await win.webContents.executeJavaScript(
      `Boolean(
        window.electronAPI &&
        window.electronAPI.work &&
        typeof window.electronAPI.work.get === 'function' &&
        typeof window.electronAPI.work.save === 'function' &&
        typeof window.electronAPI.work.page === 'function' &&
        typeof window.electronAPI.work.reuse === 'function' &&
        window.electronAPI.library &&
        typeof window.electronAPI.library.get === 'function'
      )`
    )) as boolean

    // 進入批閱介面：選作業 → 等作品列出現 → 按「批閱」。
    const mainOk = text.includes('作文批閱') && hasApi
    if (!mainOk) {
      return { ok: false, detail: '主畫面未渲染或 preload API 不完整' }
    }

    const assignmentReady = await waitFor(
      "document.querySelector('.assignment-row')",
      6000
    )
    if (!assignmentReady) {
      return { ok: false, detail: '找不到作業列' }
    }
    await win.webContents.executeJavaScript(
      "document.querySelector('.assignment-row')?.click()"
    )

    const reviewButtonReady = await waitFor(
      `[...document.querySelectorAll('.import-panel button')].some(
        (item) => item.textContent?.trim() === '批閱'
      )`,
      8000
    )
    if (!reviewButtonReady) {
      return { ok: false, detail: '作品列沒有出現「批閱」按鈕' }
    }
    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll('.import-panel button')]
          .find((item) => item.textContent?.trim() === '批閱')
        button?.click()
        return Boolean(button)
      })()`
    )) as boolean
    if (!clicked) {
      return { ok: false, detail: '無法點擊「批閱」按鈕' }
    }

    const reviewMounted = await waitFor("document.querySelector('.rv')", 6000)
    const canvasReady = reviewMounted
      ? await waitFor("document.querySelector('.konvajs-content canvas')", 8000)
      : false
    const reviewText = (await win.webContents.executeJavaScript(
      'document.body.innerText'
    )) as string
    const status = (await win.webContents.executeJavaScript(
      "document.querySelector('.rv-student-seat')?.textContent ?? ''"
    )) as string

    const reviewOk =
      canvasReady &&
      reviewText.includes('完成批閱') &&
      reviewText.includes('同作業作品') &&
      reviewText.includes('總評') &&
      reviewText.includes('調整量規') &&
      status === '07'

    let rubricEditorOk = false
    let rubricEditorDetail = '未開啟'
    if (reviewOk) {
      const opened = (await win.webContents.executeJavaScript(
        `(() => {
          const button = [...document.querySelectorAll('button')]
            .find((item) => item.textContent?.trim() === '調整量規')
          button?.click()
          return Boolean(button)
        })()`
      )) as boolean
      const editorReady = opened
        ? await waitFor("document.querySelector('.rv-grade-editor')", 5000)
        : false
      const rows = editorReady
        ? ((await win.webContents.executeJavaScript(
            "document.querySelectorAll('.rv-grade-row').length"
          )) as number)
        : 0
      const previewText = editorReady
        ? ((await win.webContents.executeJavaScript(
            "document.querySelector('.rv-grade-editor .rv-note')?.textContent ?? ''"
          )) as string)
        : ''
      rubricEditorOk =
        editorReady && rows >= 1 && previewText.includes('會落在')
      rubricEditorDetail = editorReady
        ? `等第 ${rows} 列；預覽「${previewText.trim()}」`
        : opened
          ? '已點擊但等第編輯器未出現'
          : '找不到「調整量規」按鈕'
    }

    const ok = reviewOk && rubricEditorOk
    const detail = ok
      ? `主畫面、preload API、批閱介面（S07）與量規編輯器正常`
      : !reviewMounted
        ? '按鈕已點擊，但批閱介面未掛載'
        : !canvasReady
          ? '批閱介面已掛載，但畫布未載入頁面'
          : !reviewOk
            ? `批閱介面內容不完整（座號「${status}」）`
            : `量規編輯器未就緒（${rubricEditorDetail}）`

    return { ok, detail }
  } finally {
    win.destroy()
  }
}

/** `--m3-check`：圖片前處理、評語庫、計分、完成檢查、作品存取與 UI 煙霧測試。 */
export async function runM3Check(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const assets = join(repoRoot, 'spike-out', 'm3-assets')
  const root = join(repoRoot, 'spike-out', 'm3-db')

  await rm(assets, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
  await mkdir(assets, { recursive: true })
  await mkdir(root, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    // ---- 圖片前處理 --------------------------------------------------------
    const source = join(assets, 'source.jpg')
    const target = join(assets, 'page.jpg')
    const thumb = join(assets, 'page_thumb.webp')

    await sharp({
      create: {
        width: 3200,
        height: 2400,
        channels: 3,
        background: { r: 244, g: 238, b: 225 }
      }
    })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .toFile(source)

    const sourceMeta = await sharp(source).metadata()
    const processed = await preprocessImage(source, target, thumb)
    const outputMeta = await sharp(target).metadata()
    const thumbMeta = await sharp(thumb).metadata()
    const thumbStat = await stat(thumb)

    add(
      'EXIF 轉正與縮圖',
      processed.width === 1950 &&
        processed.height === 2600 &&
        outputMeta.width === 1950 &&
        outputMeta.height === 2600 &&
        processed.height > processed.width,
      `來源 ${sourceMeta.width}×${sourceMeta.height}、orientation ${sourceMeta.orientation ?? 0} → 輸出 ${processed.width}×${processed.height}`
    )
    add(
      '長邊上限 2600 且移除 EXIF',
      Math.max(outputMeta.width ?? 0, outputMeta.height ?? 0) === 2600 &&
        outputMeta.exif === undefined,
      `長邊 ${Math.max(outputMeta.width ?? 0, outputMeta.height ?? 0)}、EXIF ${
        outputMeta.exif ? '仍存在' : '已移除'
      }`
    )
    add(
      '產生 600px WebP 縮圖',
      thumbStat.size > 0 &&
        thumbMeta.format === 'webp' &&
        Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0) <= 600,
      `${thumbMeta.width}×${thumbMeta.height}、${thumbStat.size} bytes`
    )

    // ---- 評語庫 ------------------------------------------------------------
    const counts: Record<string, number> = {}
    for (const entry of BUILTIN_LIBRARY.entries) {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1
    }
    const expected: Record<string, number> = {
      typo: 10,
      sentence: 23,
      structure: 23,
      praise: 10,
      comment: 72
    }
    const countsOk = Object.entries(expected).every(([key, value]) => counts[key] === value)
    add(
      '評語庫 138 條與分類數量',
      BUILTIN_LIBRARY.entries.length === 138 && countsOk,
      `${BUILTIN_LIBRARY.entries.length} 條（${Object.entries(counts)
        .map(([key, value]) => `${key} ${value}`)
        .join('、')}），版本 ${LIBRARY_VERSION}`
    )

    const shortComments = BUILTIN_LIBRARY.entries
      .filter((entry) => entry.category === 'comment')
      .filter((entry) => normalizeComment(entry.text).length < 30)
    add(
      'comment 條目正規化後 ≥30 字',
      shortComments.length === 0,
      shortComments.length === 0
        ? '全部符合'
        : `${shortComments.length} 條不足：${shortComments.map((entry) => entry.id).join('、')}`
    )

    // ---- normalizeComment --------------------------------------------------
    const normalized = normalizeComment('  {姓名}你好，世界！\nABC  ')
    add(
      'normalizeComment 去變數與標點',
      normalized === '你好世界ABC',
      `結果「${normalized}」`
    )

    // ---- 量規 preset -------------------------------------------------------
    const presetMax = (preset: typeof RUBRIC_PRESETS.balanced): number[] =>
      preset.items.map((item) => item.max)
    const balancedMax = presetMax(RUBRIC_PRESETS.balanced)
    const contentMax = presetMax(RUBRIC_PRESETS.content)
    const languageMax = presetMax(RUBRIC_PRESETS.language)
    add(
      '量規三組配分正確',
      balancedMax.join('/') === '40/30/30' &&
        contentMax.join('/') === '45/25/30' &&
        languageMax.join('/') === '35/30/35',
      `均衡 ${balancedMax.join('/')}、內容 ${contentMax.join('/')}、語言 ${languageMax.join('/')}`
    )
    add(
      '舊量規 id 對應均衡版',
      RUBRIC_PRESETS.junior === RUBRIC_PRESETS.balanced &&
        RUBRIC_PRESETS.senior === RUBRIC_PRESETS.balanced &&
        RUBRIC_PRESETS.vocational === RUBRIC_PRESETS.balanced,
      'junior／senior／vocational 皆指向 balanced'
    )

    // ---- computeScore ------------------------------------------------------
    const computed = computeScore(
      [typoAnnotation(1), typoAnnotation(2)],
      { content: 32, structure: 24, language: 25 },
      RUBRIC_PRESETS.senior
    )
    add(
      'computeScore 自動扣分',
      computed.itemsTotal === 81 &&
        computed.deduction === 1 &&
        computed.total === 80 &&
        computed.grade === 'A',
      `分項 ${computed.itemsTotal}、扣 ${computed.deduction}、總分 ${computed.total}、等第 ${
        computed.grade ?? '—'
      }`
    )

    // ---- 資料庫與 validateWork --------------------------------------------
    await openDatabase(root, { remember: false })
    add('開啟暫存資料庫', true, root)

    const created = await createClass({
      classNo: '302',
      name: '高中302',
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: '王老師'
    })

    const classFile = {
      schema_version: 1 as const,
      id: created.id,
      name: '高中302',
      grade: 'senior' as const,
      academic_year: '114',
      semester: 1 as const,
      teacher: '王老師',
      students: [
        { seat: '07', name: '王小明', active: true },
        { seat: '08', name: '陳怡君', active: true }
      ]
    }
    await saveClass(classFile)

    const assignmentSummary = await createAssignment({
      classId: created.id,
      title: '我的母親',
      prompt: '',
      genre: 'narrative',
      wordLimit: 600,
      rubricPreset: 'balanced'
    })
    const assignment = (await loadAssignment(created.id, assignmentSummary.id))
      .data as AssignmentFile

    const validFinal =
      '這篇作品以具體的生活細節描寫母親的辛勞，情感真摯，結構完整；建議再補強轉折處的鋪陳，讓主題更集中。'
    const baseWork: WorkFile = {
      schema_version: 1,
      class_id: created.id,
      assignment_id: assignment.id,
      seat: '07',
      name: '王小明',
      status: 'grading',
      pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
      annotations: [],
      final_comment: { text: validFinal },
      scores: {
        items: { content: 32, structure: 24, language: 25 },
        deduction: { typo: 0, punct: 0, override: null },
        total: 81,
        grade: 'A'
      },
      updated_at: now()
    }

    const shortResult = validateWork(
      { ...baseWork, final_comment: { text: '寫得很好。' } },
      assignment,
      0
    )
    add(
      'validateWork 擋總評過短',
      !shortResult.ok && shortResult.issues.some((issue) => issue.includes('總評不足')),
      shortResult.issues.join('；') || '未擋下'
    )

    const validResult = validateWork(baseWork, assignment, 0)
    add(
      'validateWork 合法作品通過',
      validResult.ok && validResult.score.total === 81,
      validResult.ok ? `總分 ${validResult.score.total}` : validResult.issues.join('；')
    )

    const reuseResult = validateWork(baseWork, assignment, assignment.rules.final_max_reuse)
    add(
      'validateWork 擋總評重複達上限',
      !reuseResult.ok && reuseResult.issues.some((issue) => issue.includes('同批已用')),
      reuseResult.issues.join('；') || '未擋下'
    )

    // ---- 作品存取（含 D25 批注） ------------------------------------------
    const seatDir = join(root, created.id, assignment.id, 'S07')
    await mkdir(seatDir, { recursive: true })
    await sharp({
      create: {
        width: 800,
        height: 1100,
        channels: 3,
        background: { r: 250, g: 248, b: 242 }
      }
    })
      .jpeg()
      .toFile(join(seatDir, 'p1.jpg'))

    const d25: Annotation = {
      id: 'd25-1',
      page_id: 'p1',
      anchor: { x: 0.42, y: 0.36 },
      category: 'sentence',
      subtype: 'awkward',
      text: '此句可再精簡',
      meta: {
        original: '我深深的覺得',
        revised: '我深深覺得',
        reason: '副詞修飾動詞不需「的」'
      },
      created_at: now()
    }

    const savedWork: WorkFile = {
      ...baseWork,
      annotations: [d25],
      updated_at: now()
    }
    await saveWork(created.id, assignment.id, '07', savedWork)
    const loaded = await loadWork(created.id, assignment.id, '07')
    const pageData = await readWorkPage(created.id, assignment.id, '07', 'p1')

    add(
      'work:save／work:get 一致（含 D25）',
      loaded.seat === '07' &&
        loaded.name === '王小明' &&
        loaded.annotations.length === 1 &&
        loaded.annotations[0]?.meta?.original === '我深深的覺得' &&
        loaded.annotations[0]?.meta?.revised === '我深深覺得' &&
        loaded.final_comment?.text === validFinal,
      `${loaded.annotations.length} 個批注，D25「${loaded.annotations[0]?.meta?.original ?? '—'}」`
    )
    add(
      'work:page 回傳可用 data URL',
      pageData.dataUrl.startsWith('data:image/jpeg;base64,') &&
        pageData.width === 800 &&
        pageData.height === 1100,
      `${pageData.width}×${pageData.height}、${Math.round(pageData.dataUrl.length / 1024)} KB`
    )

    // ---- 量規更新 ----------------------------------------------------------
    const initialRubricId = assignment.rubric.id
    const invalidRubric = {
      ...RUBRIC_PRESETS.content,
      items: RUBRIC_PRESETS.content.items.map((item) =>
        item.id === 'language' ? { ...item, max: 31 } : item
      )
    }
    let rejectedInvalid = false
    try {
      await updateAssignmentRubric(created.id, assignment.id, invalidRubric)
    } catch {
      rejectedInvalid = true
    }
    const afterRejected = (await loadAssignment(created.id, assignment.id)).data
    add(
      '量規合計非 100 被拒',
      rejectedInvalid && afterRejected.rubric.id === 'balanced-default',
      rejectedInvalid ? `已擋下，量規維持 ${afterRejected.rubric.id}` : '未擋下'
    )

    await updateAssignmentRubric(created.id, assignment.id, RUBRIC_PRESETS.content)
    const updatedAssignment = (await loadAssignment(created.id, assignment.id)).data
    const updatedMax = updatedAssignment.rubric.items.map((item) => item.max)
    add(
      '建立後可更新量規為內容導向',
      initialRubricId === 'balanced-default' &&
        updatedAssignment.rubric.id === 'content-default' &&
        updatedMax.join('/') === '45/25/30',
      `原 ${initialRubricId} → ${updatedAssignment.rubric.id}（${updatedMax.join('/')}）`
    )

    const workAfterRubric = await loadWork(created.id, assignment.id, '07')
    add(
      '更新量規不改寫既有 work 分數',
      JSON.stringify(workAfterRubric.scores) === JSON.stringify(baseWork.scores),
      `分項 ${JSON.stringify(workAfterRubric.scores?.items ?? {})}、總分 ${
        workAfterRubric.scores?.total ?? '—'
      }`
    )

    // ---- 等第門檻 ----------------------------------------------------------
    const gradeAssignment = await createAssignment({
      classId: created.id,
      title: '等第門檻測試',
      prompt: '',
      genre: 'narrative',
      wordLimit: 600,
      rubricPreset: 'balanced'
    })
    const customGrades: GradeBand[] = [
      { label: '乙', min: 0 },
      { label: '優', min: 85 },
      { label: '甲', min: 70 }
    ]
    await updateAssignmentRubric(created.id, gradeAssignment.id, {
      ...RUBRIC_PRESETS.balanced,
      grades: customGrades
    })
    const loadedGradeAssignment = (await loadAssignment(created.id, gradeAssignment.id))
      .data
    const loadedGrades = loadedGradeAssignment.rubric.grades
    add(
      '等第門檻更新後由高到低排序',
      loadedGrades.map((grade) => `${grade.label}:${grade.min}`).join(',') ===
        '優:85,甲:70,乙:0',
      loadedGrades.map((grade) => `${grade.label} ${grade.min}`).join(' · ')
    )

    const at88 = computeScore(
      [],
      { content: 35, structure: 27, language: 26 },
      loadedGradeAssignment.rubric
    )
    const at72 = resolveGrade(72, loadedGradeAssignment.rubric)
    const at65 = resolveGrade(65, loadedGradeAssignment.rubric)
    add(
      '總分 88／72／65 對應優／甲／乙',
      at88.total === 88 && at88.grade === '優' && at72 === '甲' && at65 === '乙',
      `88 → ${at88.grade ?? '—'}、72 → ${at72 ?? '—'}、65 → ${at65 ?? '—'}`
    )

    let duplicateMinRejected = false
    try {
      await updateAssignmentRubric(created.id, gradeAssignment.id, {
        ...RUBRIC_PRESETS.balanced,
        grades: [
          { label: '優', min: 85 },
          { label: '甲', min: 85 },
          { label: '乙', min: 0 }
        ]
      })
    } catch {
      duplicateMinRejected = true
    }
    const afterDuplicateMin = (await loadAssignment(created.id, gradeAssignment.id)).data
    add(
      '重複最低分被後端拒絕',
      duplicateMinRejected &&
        JSON.stringify(afterDuplicateMin.rubric.grades) === JSON.stringify(loadedGrades),
      duplicateMinRejected
        ? '已擋下，等第門檻維持原設定'
        : '未擋下'
    )

    let blankLabelRejected = false
    try {
      await updateAssignmentRubric(created.id, gradeAssignment.id, {
        ...RUBRIC_PRESETS.balanced,
        grades: [
          { label: '   ', min: 85 },
          { label: '甲', min: 70 },
          { label: '乙', min: 0 }
        ]
      })
    } catch {
      blankLabelRejected = true
    }
    const afterBlankLabel = (await loadAssignment(created.id, gradeAssignment.id)).data
    add(
      '空白等第名稱被後端拒絕',
      blankLabelRejected &&
        JSON.stringify(afterBlankLabel.rubric.grades) === JSON.stringify(loadedGrades),
      blankLabelRejected ? '已擋下，等第門檻維持原設定' : '未擋下'
    )

    // 對已有作品的作業只改等第，既有分數（含舊等第）必須原封不動。
    await updateAssignmentRubric(created.id, assignment.id, {
      ...RUBRIC_PRESETS.content,
      grades: customGrades
    })
    const workAfterGrades = await loadWork(created.id, assignment.id, '07')
    add(
      '更新等第不改寫既有 work 分數',
      JSON.stringify(workAfterGrades.scores) === JSON.stringify(baseWork.scores),
      `總分 ${workAfterGrades.scores?.total ?? '—'}、等第 ${
        workAfterGrades.scores?.grade ?? '—'
      }`
    )

    // ---- UI 煙霧測試（資料庫保持開啟，讓主畫面能列出班級與作業） ----------
    const ui = await runUiSmoke()
    add('主畫面、API 與批閱介面', ui.ok, ui.detail)

    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已經關閉或從未開啟
    }
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[m3] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
