import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CreateAssignmentInputSchema,
  type AssignmentFile,
  type Student,
  type WorkFile,
  type WorkStatus
} from '@essay-grader/core'
import {
  auditAssignment,
  closeDatabase,
  createAssignment,
  createClass,
  loadAssignment,
  openDatabase,
  saveClass,
  saveWork
} from './repository'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const now = (): string => new Date().toISOString()
const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * 31 份合法作品的總評（S01–S29、S43、S44）。每份題材與句式都不同，彼此的相似度
 * 必須低於 FINAL_SIMILARITY_THRESHOLD，否則會被近似重複規則誤標。
 */
const VALID_FINALS: readonly string[] = [
  '文章以母親的飯菜為線索串起童年記憶，畫面具體，情感自然；若能再補上一個轉折場景，層次會更豐富。',
  '作者描寫夏日海邊的景色細膩，從潮聲寫到晚霞，氣氛營造成功；結尾可以再點出個人成長，使主旨更鮮明。',
  '圖書館的安靜午後被寫得很有畫面，段落間的銜接流暢；若能減少重複的形容詞，語言會更精練有力。',
  '運動會接力賽的緊張感掌握得不錯，動作與心理交替描寫，節奏明快；建議在結尾說明這次經驗帶來的改變。',
  '祖父菜園的描寫具有生活氣息，對植物生長過程的觀察扎實；若能把與祖父的互動再拉近一些，會更打動讀者。',
  '雨天搭公車的情節安排合理，人物對話生動，車窗水痕的運用值得肯定；主題可以再聚焦於一個核心感受。',
  '第一次打工的經歷寫得真實，從緊張到熟悉的心路歷程清楚呈現，段落比例也適當，唯獨開頭稍顯冗長。',
  '寵物貓的日常敘述活潑有趣，擬人化手法運用得當；若能加入一次具體的衝突事件，文章的張力會明顯提升。',
  '社區廟會的熱鬧場面以多感官描寫呈現，聲音、香氣與人群交織，讀來身歷其境；結構上可再依時間順序整理。',
  '颱風過後的街道與樹木被寫得很有層次，作者能從自然災害聯想到人與環境的關係，見解成熟，惟論述略顯簡短。',
  '音樂課上學習直笛的過程描寫誠懇，失敗與練習的循環安排得當；結尾的感想可以更具體，讓讀者感受到收穫。',
  '料理實作的步驟敘寫清楚，從切菜到出爐的每個環節都有紀錄，條理分明；若能加入味覺的主觀評價，會更有個人風格。',
  '迷路的經驗敘事緊湊，懸念設計得宜，讀者能跟著主角的腳步推進；建議檢視標點使用，部分長句可以拆短。',
  '考試失利後的心情轉折寫得坦率，作者沒有迴避挫折，反而從中找到調整方向；文字精準，題目與內容的對應還可加強。',
  '數位時代的閱讀習慣討論有見地，舉例貼近生活，論點推進有條理；若能補充正反兩面的比較，論證會更完整。',
  '環保回收的主題切入具體，從家中分類垃圾寫到社區行動，行文由小至大；個別段落的過渡詞較少，可再加以串接。',
  '爺爺留下的舊手錶是全文的核心意象，作者用它串起家族記憶，象徵手法運用成熟；若能控制敘述速度，效果會更好。',
  '鄰居阿姨每天傍晚的散步路線被寫得像一幅安靜的風景畫，人物與環境相互映襯；語句優美，建議檢查部分重複的修飾語。',
  '夜市攤販的叫賣聲、熱氣與燈光互相交織，作者以感官切入觀察，畫面鮮活；文章後段可以再回到自己的感受，形成收束。',
  '游泳比賽的備戰過程寫得扎實，從每日訓練到比賽當天的心跳，情緒推進有層次；若能再說明教練給予的啟發，會更有深度。',
  '登山途中的補給與休息安排被寫得很細，讀者能理解作者的準備與堅持；主旨可以更明確地點出登頂之後的省思。',
  '家庭聚餐的座位與話題描寫生動，從熱鬧到沉默的轉換很有意思；若能統整段落的重心，全文會更具整體感。',
  '電影院裡的一場意外停電，作者寫出了群眾的反應與自己的心情變化，角度特別；結構上可以把高潮提早，節奏會更緊湊。',
  '暑期補習班的生活被寫得有自嘲的幽默感，同時保留真實的疲憊，語氣拿捏恰當；若能補上一段反思，立意會更完整。',
  '書店角落的一本舊書成為全文的引子，作者從書頁的泛黃寫到閱讀的初衷，描寫細緻，思緒連貫，結構相當完整。',
  '捷運站裡的人群被寫成一組流動的剪影，觀察角度新穎；文中部分句子較長，可以適度斷句，讓節奏更加明快。',
  '生日禮物的選擇過程寫出了對朋友的體貼，從猶豫到決定的心理變化很自然；惟禮物本身的描寫較少，可再補充細節。',
  '醫院探病的場景冷靜而克制，作者以簡潔文字承載沉重情感，留白處理得宜；若能更清楚交代探病的原因，讀者會更容易進入情境。',
  '整理舊相簿時的回憶段落，時間跳躍的安排自然，照片成為記憶的錨點；建議在結尾點出現在的自己，讓時間感更完整。',
  '雪景的描寫以色彩變化為主軸，白、灰、藍層次分明，作者的觀察力值得肯定；若能加入人物的活動，畫面會更有生命力。',
  '社團招募當天的熱鬧氣氛與自己的猶豫被寫得真切，決定加入後的期待也有交代；文章完整，語句通順，可再精修部分用詞。'
]

/** 5 份未評分作品的總評；每份內容都不同，避免誤觸重複規則。 */
const UNSCORED_FINALS: readonly string[] = [
  '本篇取材自校園午休時光，段落安排清楚，語句大致通順，結尾若再回應題旨會更完整。',
  '文章以旅行途中的小插曲為主軸，敘事線條單純，描寫的順序合理，但情緒的起伏仍可再加強。',
  '作者從一張泛黃的明信片談起，思緒由遠而近，立意不錯，然而部分句子重複使用同樣的主語。',
  '題材貼近青少年的生活，觀點真誠，用詞平實，若能補上具體例子，論述的說服力將會提高。',
  '全文以季節更替串起個人的成長過程，段落之間的轉換流暢，唯有幾處標點使用不一致，宜再檢視。'
]

/** 5 份總評不足作品的總評；每份都不同，且字數不足 30 字。 */
const SHORT_FINALS: readonly string[] = [
  '文章開頭有吸引力，後段尚未完成，待補寫。',
  '主題方向清楚，論述部分還沒展開，請再補寫。',
  '目前只寫了一小段，等學生補交後再批閱。',
  '段落太少，內容還不足以完整表達想法。',
  '題目切入點有趣，可惜篇幅仍然偏短。'
]

/** 3 份刻意共用的總評，第 3 份（座號 42）應被抓到超限。 */
const DUPLICATE_FINAL =
  '本篇文章取材自家庭經驗，敘寫具體，轉折自然，結尾收束完整，整體表現穩定；建議多留意標點與段落之間的銜接。'

const SCORE_ITEMS = { content: 32, structure: 24, language: 25 }

function makeWork(
  classId: string,
  assignmentId: string,
  seat: string,
  status: WorkStatus,
  finalText: string,
  withScores: boolean
): WorkFile {
  return {
    schema_version: 1,
    class_id: classId,
    assignment_id: assignmentId,
    seat,
    name: `學生${seat}`,
    status,
    pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
    annotations: [],
    ...(withScores
      ? {
          scores: {
            items: { ...SCORE_ITEMS },
            deduction: { typo: 0, punct: 0, override: null },
            total: 81,
            grade: 'A'
          }
        }
      : {}),
    final_comment: { text: finalText },
    updated_at: now()
  }
}

/** 隱藏視窗：載入主畫面、按「批次檢查」、看結果、前往批閱再返回重查。 */
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
        window.electronAPI.assignment &&
        typeof window.electronAPI.assignment.audit === 'function'
      )`
    )) as boolean
    if (!text.includes('作文批閱') || !hasApi) {
      return { ok: false, detail: '主畫面未渲染或缺少 assignment.audit API' }
    }

    const assignmentReady = await waitFor("document.querySelector('.assignment-row')", 6000)
    if (!assignmentReady) return { ok: false, detail: '找不到作業列' }
    await win.webContents.executeJavaScript(
      "document.querySelector('.assignment-row')?.click()"
    )

    const formButtonReady = await waitFor(
      `[...document.querySelectorAll('.card-head button')].some(
        (item) => item.textContent?.trim() === '新增作業'
      )`,
      6000
    )
    if (!formButtonReady) return { ok: false, detail: '找不到「新增作業」按鈕' }

    // 建立表單的量規預設必須是均衡版。
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.card-head button')]
        .find((item) => item.textContent?.trim() === '新增作業')?.click()`
    )
    const formReady = await waitFor("document.querySelector('.form select')", 4000)
    const defaultPreset = formReady
      ? ((await win.webContents.executeJavaScript(
          `(() => {
            const select = [...document.querySelectorAll('.form select')]
              .find((item) => [...item.options].some((option) => option.textContent?.includes('均衡版')))
            return select ? select.value : ''
          })()`
        )) as string)
      : ''
    if (formReady) {
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.card-head button')]
          .find((item) => item.textContent?.trim() === '取消')?.click()`
      )
    }

    const auditButtonReady = await waitFor(
      `[...document.querySelectorAll('.import-panel .card-head button')].some(
        (item) => item.textContent?.trim() === '批次檢查'
      )`,
      6000
    )
    if (!auditButtonReady) return { ok: false, detail: '找不到「批次檢查」按鈕' }

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.import-panel .card-head button')]
        .find((item) => item.textContent?.trim() === '批次檢查')?.click()`
    )

    const panelReady = await waitFor("document.querySelector('.audit-panel')", 6000)
    const statsReady = panelReady
      ? await waitFor(
          `document.querySelector('.audit-panel')?.textContent?.includes('在學 45')`,
          6000
        )
      : false
    if (!panelReady || !statsReady) {
      return {
        ok: false,
        detail: panelReady ? '批次檢查面板出現，但統計未載入' : '批次檢查面板未出現'
      }
    }

    const problemRows = (await win.webContents.executeJavaScript(
      "document.querySelectorAll('.audit-row').length"
    )) as number
    const panelText = (await win.webContents.executeJavaScript(
      "document.querySelector('.audit-panel')?.innerText ?? ''"
    )) as string
    const runBefore = (await win.webContents.executeJavaScript(
      "Number(document.querySelector('.audit-panel')?.dataset.run ?? 0)"
    )) as number

    // 切到「全部」應列出 45 位在學學生。
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.audit-panel button')]
        .find((item) => item.textContent?.trim() === '全部')?.click()`
    )
    const allReady = await waitFor(
      "document.querySelectorAll('.audit-row').length === 45",
      4000
    )
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.audit-panel button')]
        .find((item) => item.textContent?.trim() === '只看有問題')?.click()`
    )
    const problemReady = await waitFor(
      "document.querySelectorAll('.audit-row').length > 0",
      4000
    )

    // 第一列（座號 30）前往批閱，再返回工作區確認自動重查。
    const opened = (await win.webContents.executeJavaScript(
      `(() => {
        const button = document.querySelector('.audit-review')
        button?.click()
        return Boolean(button)
      })()`
    )) as boolean
    if (!opened) return { ok: false, detail: '批次檢查面板沒有「前往批閱」按鈕' }

    const reviewReady = await waitFor("document.querySelector('.rv')", 8000)
    const reviewSeatReady = reviewReady
      ? await waitFor("document.querySelector('.rv-student-seat')?.textContent?.trim() === '30'", 8000)
      : false
    const reviewSeat = reviewSeatReady
      ? ((await win.webContents.executeJavaScript(
          "document.querySelector('.rv-student-seat')?.textContent?.trim() ?? ''"
        )) as string)
      : ''

    if (reviewReady) {
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')]
          .find((item) => item.textContent?.includes('返回佇列'))?.click()`
      )
    }

    const backReady = await waitFor(
      "!document.querySelector('.rv') && Boolean(document.querySelector('.audit-panel'))",
      8000
    )
    const rechecked = backReady
      ? await waitFor(
          `Number(document.querySelector('.audit-panel')?.dataset.run ?? 0) > ${runBefore}`,
          8000
        )
      : false

    const ok =
      defaultPreset === 'balanced' &&
      problemRows === 14 &&
      panelText.includes('未匯入 1') &&
      panelText.includes('問題 14') &&
      allReady &&
      problemReady &&
      reviewReady &&
      reviewSeatReady &&
      reviewSeat === '30' &&
      rechecked

    const detail = ok
      ? `表單預設 balanced；問題 ${problemRows} 列；全部 45 列；前往 S${reviewSeat} 後返回自動重查`
      : `表單預設「${defaultPreset || '—'}」、問題列 ${problemRows}、全部 45 列 ${
          allReady ? '是' : '否'
        }、批閱 ${reviewReady ? `S${reviewSeat}` : '未開啟'}、返回重查 ${
          rechecked ? '是' : '否'
        }`

    return { ok, detail }
  } finally {
    win.destroy()
  }
}

/** `--m4-check`：均衡版預設、45 份批次檢查規則與 UI 煙霧。 */
export async function runM4Check(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const assets = join(repoRoot, 'spike-out', 'm4-assets')
  const root = join(repoRoot, 'spike-out', 'm4-db')

  await rm(assets, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
  await mkdir(assets, { recursive: true })
  await mkdir(root, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    // ---- 不帶 preset 建立作業，應採均衡版 --------------------------------
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

    const students: Student[] = Array.from({ length: 45 }, (_, index) => {
      const seat = pad(index + 1)
      return { seat, name: `學生${seat}`, active: true }
    })
    await saveClass({
      schema_version: 1,
      id: created.id,
      name: '高中302',
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: '王老師',
      students
    })

    const parsedInput = CreateAssignmentInputSchema.parse({
      classId: created.id,
      title: '我的母親'
    })
    const assignmentSummary = await createAssignment(parsedInput)
    const assignment = (await loadAssignment(created.id, assignmentSummary.id))
      .data as AssignmentFile
    const assignmentMax = assignment.rubric.items.map((item) => item.max).join('/')

    add(
      '不帶 rubricPreset 預設均衡版',
      assignment.rubric.id === 'balanced-default' &&
        assignmentMax === '40/30/30' &&
        assignment.rules.final_min_chars === 30 &&
        assignment.rules.final_max_reuse === 2,
      `${assignment.rubric.id}（${assignmentMax}）、總評 ${assignment.rules.final_min_chars} 字、重複上限 ${assignment.rules.final_max_reuse}`
    )

    // ---- 產生 44 份作品（座號 45 留空測未匯入） --------------------------
    const template = join(assets, 'page.jpg')
    await sharp({
      create: {
        width: 800,
        height: 1100,
        channels: 3,
        background: { r: 250, g: 248, b: 242 }
      }
    })
      .jpeg()
      .toFile(template)

    const assignmentDir = join(root, created.id, assignment.id)
    const writePage = async (seat: string): Promise<void> => {
      const dir = join(assignmentDir, `S${seat}`)
      await mkdir(dir, { recursive: true })
      await copyFile(template, join(dir, 'p1.jpg'))
    }

    const validSeats = Array.from({ length: 29 }, (_, index) => pad(index + 1))
    const shortSeats = Array.from({ length: 5 }, (_, index) => pad(30 + index))
    const unscoredSeats = Array.from({ length: 5 }, (_, index) => pad(35 + index))
    const duplicateSeats = ['40', '41', '42']
    const missingPageSeats = ['43', '44']

    for (const [index, seat] of validSeats.entries()) {
      await writePage(seat)
      await saveWork(
        created.id,
        assignment.id,
        seat,
        makeWork(created.id, assignment.id, seat, 'done', VALID_FINALS[index] ?? '', true)
      )
    }
    for (const [index, seat] of shortSeats.entries()) {
      await writePage(seat)
      await saveWork(
        created.id,
        assignment.id,
        seat,
        makeWork(created.id, assignment.id, seat, 'grading', SHORT_FINALS[index] ?? '', true)
      )
    }
    for (const [index, seat] of unscoredSeats.entries()) {
      await writePage(seat)
      await saveWork(
        created.id,
        assignment.id,
        seat,
        makeWork(
          created.id,
          assignment.id,
          seat,
          'grading',
          UNSCORED_FINALS[index] ?? '',
          false
        )
      )
    }
    for (const [index, seat] of duplicateSeats.entries()) {
      await writePage(seat)
      await saveWork(
        created.id,
        assignment.id,
        seat,
        makeWork(
          created.id,
          assignment.id,
          seat,
          index < 2 ? 'done' : 'grading',
          DUPLICATE_FINAL,
          true
        )
      )
    }
    for (const [index, seat] of missingPageSeats.entries()) {
      // 刻意不寫 p1.jpg，只留 work.json 的頁面紀錄。
      await saveWork(
        created.id,
        assignment.id,
        seat,
        makeWork(
          created.id,
          assignment.id,
          seat,
          'done',
          VALID_FINALS[validSeats.length + index] ?? '',
          true
        )
      )
    }

    add(
      '產生 45 人名單與 44 份作品',
      students.length === 45 &&
        validSeats.length + shortSeats.length + unscoredSeats.length +
          duplicateSeats.length + missingPageSeats.length === 44,
      `在學 45、作品 44（S45 未匯入）`
    )

    // ---- 批次檢查 --------------------------------------------------------
    const startedAt = Date.now()
    const audit = await auditAssignment(created.id, assignment.id)
    const elapsed = Date.now() - startedAt
    const t = audit.totals

    add(
      '批次檢查統計正確',
      t.students === 45 &&
        t.imported === 44 &&
        t.pending === 0 &&
        t.grading === 11 &&
        t.done === 33 &&
        t.missing === 1,
      `在學 ${t.students}、已匯入 ${t.imported}、待批 ${t.pending}、批閱中 ${t.grading}、已批 ${t.done}、未匯入 ${t.missing}`
    )

    add(
      '問題與提醒條數',
      t.problems === 14 && t.warnings === 11 && t.issues === 25 && !audit.clean,
      `問題 ${t.problems}、提醒 ${t.warnings}、合計 ${t.issues}、乾淨 ${audit.clean ? '是' : '否'}`
    )

    add(
      '結果依座號排序且涵蓋全部在學學生',
      audit.rows.length === 45 &&
        audit.rows.every((row, index) => row.seat === pad(index + 1)),
      `${audit.rows.length} 列，${audit.rows[0]?.seat}–${audit.rows[audit.rows.length - 1]?.seat}`
    )

    const row = (seat: string) => audit.rows.find((item) => item.seat === seat)
    const hasIssue = (seat: string, type: string): boolean =>
      Boolean(row(seat)?.issues.some((issue) => issue.type === type))

    const cleanRowsOk = validSeats.every((seat) => {
      const target = row(seat)
      return target?.imported && target.status === 'done' && target.issues.length === 0
    })
    add(
      '29 份合法作品沒有被誤標',
      cleanRowsOk,
      cleanRowsOk ? 'S01–S29 皆為 done 且無問題' : '有合法作品被標記'
    )

    const shortOk = shortSeats.every((seat) => hasIssue(seat, 'final_short'))
    add(
      '總評不足 5 份全數抓到',
      shortOk,
      shortOk
        ? shortSeats.map((seat) => `S${seat}`).join('、')
        : '有作品漏抓'
    )

    const unscoredOk = unscoredSeats.every((seat) => hasIssue(seat, 'unscored'))
    add(
      '未評分 5 份全數抓到',
      unscoredOk,
      unscoredOk
        ? unscoredSeats.map((seat) => `S${seat}`).join('、')
        : '有作品漏抓'
    )

    const duplicateRows = duplicateSeats.map((seat) => ({
      seat,
      flagged: hasIssue(seat, 'final_reuse')
    }))
    const thirdReuseMessage =
      row('42')?.issues.find((issue) => issue.type === 'final_reuse')?.message ?? ''
    add(
      '總評重複只標第 3 份（S42）',
      duplicateRows[0]?.flagged === false &&
        duplicateRows[1]?.flagged === false &&
        duplicateRows[2]?.flagged === true &&
        thirdReuseMessage.includes('第 3 次') &&
        thirdReuseMessage.includes('上限 2 次'),
      thirdReuseMessage || '未標記'
    )

    const missingPageRows = missingPageSeats.map((seat) => ({
      seat,
      flagged: hasIssue(seat, 'missing_page')
    }))
    const missingPageMessage =
      row('43')?.issues.find((issue) => issue.type === 'missing_page')?.message ?? ''
    add(
      '缺頁檔案 2 份全數抓到',
      missingPageRows.every((item) => item.flagged) && missingPageMessage.includes('p1.jpg'),
      missingPageMessage || '未標記'
    )

    const missingRow = row('45')
    add(
      '未匯入 1 人被抓到',
      missingRow?.status === 'missing' &&
        missingRow.imported === false &&
        missingRow.issues.some((issue) => issue.type === 'missing'),
      missingRow
        ? `S45 ${missingRow.status}、${missingRow.issues[0]?.message ?? '—'}`
        : '找不到 S45'
    )

    const pendingWarnings = [...shortSeats, ...unscoredSeats, '42'].every((seat) =>
      hasIssue(seat, 'incomplete')
    )
    add(
      '批閱中列為提醒、不算錯誤',
      pendingWarnings &&
        shortSeats.every((seat) => row(seat)?.issues.some((issue) => !issue.blocking)),
      '5 份總評不足、5 份未評分與重複第 3 份皆有提醒'
    )

    add(
      '批次檢查執行時間 < 2 秒',
      elapsed < 2000,
      `${elapsed} ms`
    )

    const scoreRowsOk = validSeats.every((seat) => row(seat)?.score?.total === 81)
    add(
      '重用 computeScore 計算目前總分',
      scoreRowsOk,
      row('01')?.score ? `S01 總分 ${row('01')?.score?.total}` : '沒有分數'
    )

    // ---- UI 煙霧測試（資料庫保持開啟） -----------------------------------
    const ui = await runUiSmoke()
    add('批次檢查 UI（按鈕、面板、前往批閱、返回重查）', ui.ok, ui.detail)

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
    `[m4] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
