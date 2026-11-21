import { app, BrowserWindow } from 'electron'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildPraiseBank,
  normalizeComment,
  type Annotation,
  type PraiseBank,
  type PraiseAssignmentInfo,
  type WorkFile,
  type WorkStatus
} from '@essay-grader/core'
import {
  closeDatabase,
  createAssignment,
  createClass,
  getPraiseBank,
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

const CLASS_A_NAME = '高中302'
const CLASS_B_NAME = '國中303'
const TEACHER = '測試老師'

const NAME_A1 = '測試甲生'
const NAME_A2 = '測試乙生'
const NAME_A3 = '測試丙生'
const NAME_A4 = '測試丁生'
const NAME_B1 = '測試戊生'

const T1 = '2026-11-01T01:00:00.000Z'
const T2 = '2026-11-05T01:00:00.000Z'
const T3 = '2026-11-10T01:00:00.000Z'
const T4 = '2026-11-18T01:00:00.000Z'
const T5 = '2026-11-20T01:00:00.000Z'

const P1 = '「雨停了，她把整個下午收進口袋。」— 動作與情緒扣合。'
const P2 = '開頭以聲音進場，讓畫面立刻成立。'
const P3 = '結尾回到第一段的雨聲，前後呼應自然。'
const P4 = '「他沒有回頭，只把傘往我這邊挪。」— 對話與動作留白。'
const P5 = '批閱中的佳句不得收進佳句庫。'
const P6 = '待批作品的佳句不得收進佳句庫。'
const P7 = '「風從窗縫鑽進來，把紙角掀了一下。」— 細節讓場景有了動態。'
const SENTENCE_TEXT = '語句批注不得收進佳句庫。'
const COMMENT_TEXT = '總評批注不得收進佳句庫。'

let annotationSeq = 0

function annotation(
  category: Annotation['category'],
  text: string,
  createdAt?: string
): Annotation {
  annotationSeq += 1
  const base = {
    id: `praise-a-${String(annotationSeq).padStart(3, '0')}`,
    page_id: 'p1',
    anchor: { x: 0.2, y: 0.3 },
    category,
    text,
    ...(createdAt ? { created_at: createdAt } : {})
  }
  return base as unknown as Annotation
}

function makeWork(
  classId: string,
  assignmentId: string,
  seat: string,
  name: string,
  status: WorkStatus,
  annotations: Annotation[],
  updatedAt: string
): WorkFile {
  return {
    schema_version: 1,
    class_id: classId,
    assignment_id: assignmentId,
    seat,
    name,
    status,
    pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
    annotations,
    updated_at: updatedAt
  }
}

/** 核心測試資料：2 班、2 份作業、5 份作品（含 grading／pending 與非 praise 類別）。 */
function coreFixture(): {
  works: WorkFile[]
  assignments: Map<string, PraiseAssignmentInfo>
  classA: string
  classB: string
  asgA: string
  asgB: string
} {
  const classA = 'C302-114F'
  const classB = 'C303-114F'
  const asgA = 'E20261101'
  const asgB = 'E20261115'

  const works: WorkFile[] = [
    makeWork(
      classA,
      asgA,
      '71',
      NAME_A1,
      'done',
      [
        annotation('praise', P1, T1),
        annotation('praise', P2, T3),
        annotation('praise', P3, T1),
        annotation('sentence', SENTENCE_TEXT, T1),
        annotation('comment', COMMENT_TEXT, T1)
      ],
      T3
    ),
    makeWork(
      classA,
      asgA,
      '72',
      NAME_A2,
      'done',
      [
        // 只差標點與空白，normalizeComment 後與 P1 相同。
        annotation('praise', `${P1.replace('。', '')}  `, T2),
        annotation('praise', P2, T2)
      ],
      T3
    ),
    makeWork(
      classA,
      asgA,
      '73',
      NAME_A3,
      'grading',
      [annotation('praise', P5, T3)],
      T3
    ),
    makeWork(
      classA,
      asgA,
      '74',
      NAME_A4,
      'pending',
      [annotation('praise', P6, T3)],
      T3
    ),
    makeWork(
      classB,
      asgB,
      '75',
      NAME_B1,
      'done',
      [
        // 缺 created_at：時間要退回 work.updated_at（T4）。
        annotation('praise', P1),
        annotation('praise', P4, T4)
      ],
      T4
    )
  ]

  const assignments = new Map<string, PraiseAssignmentInfo>([
    [asgB, { title: '一封感謝的信', due_at: '2026-11-15T04:00:00.000Z' }],
    [asgA, { title: '我的母親', due_at: '2026-11-01T04:00:00.000Z' }]
  ])

  return { works, assignments, classA, classB, asgA, asgB }
}

function waitFor(win: BrowserWindow, expression: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  return (async () => {
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = (await win.webContents.executeJavaScript(`Boolean(${expression})`)) as boolean
        if (ok) return true
      } catch {
        // 頁面還在下載
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    return false
  })()
}

interface UiResult {
  ok: boolean
  detail: string
  api: {
    scopedTexts: number
    scopedUses: number
    allTexts: number
    allUses: number
    clipboard: string
  } | null
}

/** 隱藏視窗 UI 煙霧：按鈕、面板總數、範圍切換、搜尋、去識別、複製／關閉按鈕。 */
async function runUiSmoke(classId: string): Promise<UiResult> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
    const ready = await waitFor(
      win,
      "document.body.innerText.includes('作文批閱') && document.querySelectorAll('.class-item').length > 0",
      12000
    )
    if (!ready) return { ok: false, detail: '主畫面或班級清單未渲染', api: null }

    const hasButton = (await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === '佳句庫'
      )`
    )) as boolean
    if (!hasButton) return { ok: false, detail: '主畫面找不到佳句庫按鈕', api: null }

    const opened = (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (item) => item.textContent?.trim() === '佳句庫'
        )
        if (!button) return false
        button.click()
        return true
      })()`
    )) as boolean
    if (!opened) return { ok: false, detail: '佳句庫按鈕無法點擊', api: null }

    const panelReady = await waitFor(
      win,
      "document.querySelector('.praise-panel') !== null && document.querySelectorAll('.praise-item').length === 4",
      12000
    )
    if (!panelReady) return { ok: false, detail: '佳句庫面板或本班清單未載入', api: null }

    const api = (await win.webContents.executeJavaScript(
      `(async () => {
        const scoped = await window.electronAPI.praise.bank(${JSON.stringify(classId)})
        const all = await window.electronAPI.praise.bank()
        return {
          scopedTexts: scoped.totalTexts,
          scopedUses: scoped.totalUses,
          allTexts: all.totalTexts,
          allUses: all.totalUses,
          clipboard: typeof window.electronAPI.clipboard?.writeText
        }
      })()`
    )) as UiResult['api']

    const scopedSub = (await win.webContents.executeJavaScript(
      "document.querySelector('.praise-sub')?.innerText ?? ''"
    )) as string

    const clickedAll = (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll('.praise-scope button')].find(
          (item) => item.textContent?.trim() === '全部班級'
        )
        if (!button) return false
        button.click()
        return true
      })()`
    )) as boolean

    const allReady = clickedAll
      ? await waitFor(
          win,
          `document.querySelector('.praise-sub')?.innerText?.includes('5 句、8 次使用') === true &&
           document.querySelectorAll('.praise-item').length === 5`,
          12000
        )
      : false

    const searchOk = (await win.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector('.praise-search')
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set
        setter?.call(input, '口袋')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const clear = () => {
          setter?.call(input, '')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        window.__praiseClear = clear
        return true
      })()`
    )) as boolean

    const searchFiltered = searchOk
      ? await waitFor(
          win,
          `document.querySelectorAll('.praise-item').length === 1 &&
           (document.querySelector('.praise-list')?.innerText ?? '').includes('口袋')`,
          8000
        )
      : false

    const searchDetail = (await win.webContents.executeJavaScript(
      `(() => {
        const list = document.querySelector('.praise-list')?.innerText ?? ''
        const cleared = typeof window.__praiseClear === 'function'
        if (cleared) window.__praiseClear()
        return {
          matchesOne: list.includes('口袋') && !list.includes('聲音進場'),
          cleared
        }
      })()`
    )) as { matchesOne: boolean; cleared: boolean }

    const searchCleared = searchDetail.cleared
      ? await waitFor(win, "document.querySelectorAll('.praise-item').length === 5", 8000)
      : false

    const ui = (await win.webContents.executeJavaScript(
      `(() => {
        const panel = document.querySelector('.praise-panel')
        const list = document.querySelector('.praise-list')?.innerText ?? ''
        const header = document.querySelector('.praise-head')
        return {
          hasCopy: !![...document.querySelectorAll('.praise-copy')].length,
          hasCopyAll: [...document.querySelectorAll('.praise-toolbar button')].some(
            (item) => (item.textContent ?? '').includes('複製全部')
          ),
          hasClose: [...(header?.querySelectorAll('button') ?? [])].some(
            (item) => item.textContent?.trim() === '關閉'
          ),
          list,
          panel: Boolean(panel)
        }
      })()`
    )) as {
      hasCopy: boolean
      hasCopyAll: boolean
      hasClose: boolean
      list: string
      panel: boolean
    }

    const noIdentity =
      !ui.list.includes(NAME_A1) &&
      !ui.list.includes(NAME_A2) &&
      !ui.list.includes('S91') &&
      !ui.list.includes('S92') &&
      !ui.list.includes('座號') &&
      !ui.list.includes('姓名')

    const closed = (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll('.praise-head button')].find(
          (item) => item.textContent?.trim() === '關閉'
        )
        if (!button) return false
        button.click()
        return true
      })()`
    )) as boolean
    const panelClosed = closed
      ? await waitFor(win, "document.querySelector('.praise-panel') === null", 6000)
      : false

    const ok =
      scopedSub.includes('4 句、7 次使用') &&
      api?.scopedTexts === 4 &&
      api?.scopedUses === 7 &&
      api?.allTexts === 5 &&
      api?.allUses === 8 &&
      api?.clipboard === 'function' &&
      allReady &&
      searchFiltered &&
      searchDetail.matchesOne &&
      searchCleared &&
      noIdentity &&
      ui.hasCopy &&
      ui.hasCopyAll &&
      ui.hasClose &&
      panelClosed

    return {
      ok,
      detail: `按鈕 是、預設 ${scopedSub.replace(/\\s+/g, ' ').trim() || '無'}、切全部 ${allReady ? '5 句／8 次' : '失敗'}、搜尋 ${searchFiltered && searchCleared ? '1→5' : '失敗'}、清單去識別 ${noIdentity ? '是' : '否'}、複製／關閉 ${ui.hasCopy && ui.hasClose ? '有' : '缺'}、關閉面板 ${panelClosed ? '是' : '否'}、preload API ${api?.clipboard === 'function' ? '有' : '缺'}`,
      api
    }
  } finally {
    win.destroy()
  }
}

/** `--praise-check`：G6 佳句庫的核心、repository、IPC／preload 與 UI 驗收。 */
export async function runPraiseCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'praise-check')
  const dbRoot = join(work, 'db')

  await rm(work, { recursive: true, force: true })
  await mkdir(dbRoot, { recursive: true })

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  try {
    // ---- Core -------------------------------------------------------------
    const fixture = coreFixture()
    const bank = buildPraiseBank(fixture.works, fixture.assignments, T5)
    const bankJson = JSON.stringify(bank)
    const byText = new Map(bank.entries.map((entry) => [entry.text, entry]))
    const texts = bank.entries.map((entry) => entry.text)

    add(
      '核心：只收 status=done',
      !texts.includes(P5) && !texts.includes(P6) && bank.totalUses === 7,
      `grading／pending 的佳句${texts.includes(P5) || texts.includes(P6) ? '仍被收錄' : '已排除'}；使用 ${bank.totalUses} 次`
    )

    add(
      '核心：只收 category=praise',
      !texts.includes(SENTENCE_TEXT) && !texts.includes(COMMENT_TEXT),
      `語句／總評${texts.includes(SENTENCE_TEXT) || texts.includes(COMMENT_TEXT) ? '仍被收錄' : '已排除'}`
    )

    const p1 = byText.get(P1)
    add(
      '核心：normalizeComment 去重與 count／workCount',
      bank.totalTexts === 4 &&
        p1?.count === 3 &&
        p1?.workCount === 3 &&
        p1?.normalized === normalizeComment(P1) &&
        byText.get(P2)?.count === 2,
      `${bank.totalTexts} 句；P1 ${p1?.count ?? 0} 次／${p1?.workCount ?? 0} 份、P2 ${byText.get(P2)?.count ?? 0} 次`
    )

    add(
      '核心：assignments 去重、依 id 排序',
      p1?.assignments.length === 2 &&
        p1.assignments[0]?.id === fixture.asgA &&
        p1.assignments[1]?.id === fixture.asgB &&
        p1.assignments[0]?.title === '我的母親' &&
        p1.assignments[1]?.title === '一封感謝的信',
      p1?.assignments.map((item) => item.id).join('、') ?? '無'
    )

    add(
      '核心：firstAt／lastAt（含 updated_at 備援）',
      p1?.firstAt === T1 &&
        p1?.lastAt === T4 &&
        byText.get(P2)?.firstAt === T2 &&
        byText.get(P2)?.lastAt === T3 &&
        byText.get(P4)?.lastAt === T4,
      `P1 ${p1?.firstAt ?? '無'}→${p1?.lastAt ?? '無'}、P2 ${byText.get(P2)?.firstAt ?? '無'}→${byText.get(P2)?.lastAt ?? '無'}`
    )

    add(
      '核心：排序 count 高→低、lastAt 新→舊',
      texts.length === 4 &&
        texts[0] === P1 &&
        texts[1] === P2 &&
        texts[2] === P4 &&
        texts[3] === P3,
      `順序 ${texts.map((text) => text.slice(0, 6)).join(' → ')}`
    )

    add(
      '核心：序列化不含學生座號、姓名',
      !bankJson.includes(NAME_A1) &&
        !bankJson.includes(NAME_A2) &&
        !bankJson.includes(NAME_A3) &&
        !bankJson.includes(NAME_A4) &&
        !bankJson.includes(NAME_B1) &&
        !bankJson.includes('S71') &&
        !bankJson.includes('S72') &&
        !bankJson.includes('"seat"') &&
        !bankJson.includes('"name"'),
      `${bankJson.length} bytes 不含測試姓名、S71／S72、seat／name 欄位`
    )

    // ---- Repository -------------------------------------------------------
    await openDatabase(dbRoot, { remember: false })
    add('開啟暫存資料庫', true, dbRoot)

    const classA = await createClass({
      classNo: '302',
      name: CLASS_A_NAME,
      grade: 'senior',
      academicYear: '114',
      semester: 1,
      teacher: TEACHER
    })
    const classB = await createClass({
      classNo: '303',
      name: CLASS_B_NAME,
      grade: 'junior',
      academicYear: '114',
      semester: 1,
      teacher: TEACHER
    })

    await saveClass({
      schema_version: 1,
      id: classA.id,
      name: CLASS_A_NAME,
      grade: 'senior',
      academic_year: '114',
      semester: 1,
      teacher: TEACHER,
      students: [
        { seat: '91', name: NAME_A1, active: true },
        { seat: '92', name: NAME_A2, active: true },
        { seat: '93', name: NAME_A3, active: true },
        { seat: '94', name: NAME_A4, active: true }
      ]
    })
    await saveClass({
      schema_version: 1,
      id: classB.id,
      name: CLASS_B_NAME,
      grade: 'junior',
      academic_year: '114',
      semester: 1,
      teacher: TEACHER,
      students: [{ seat: '95', name: NAME_B1, active: true }]
    })

    const asgA = (await createAssignment({
      classId: classA.id,
      title: '我的母親',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-01T04:00:00.000Z'
    })) as { id: string }
    const asgB = (await createAssignment({
      classId: classA.id,
      title: '一封感謝的信',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-15T04:00:00.000Z'
    })) as { id: string }
    const asgC = (await createAssignment({
      classId: classB.id,
      title: '校園一角',
      prompt: '',
      rubricPreset: 'balanced',
      dueAt: '2026-11-18T04:00:00.000Z'
    })) as { id: string }

    add(
      '建立 2 班、3 份作業與 6 位學生',
      classA.id < classB.id && asgA.id < asgB.id && asgC.id > asgB.id,
      `${classA.id}／${classB.id}；${asgA.id}、${asgB.id}、${asgC.id}`
    )

    await saveWork(
      classA.id,
      asgA.id,
      '91',
      makeWork(
        classA.id,
        asgA.id,
        '91',
        NAME_A1,
        'done',
        [
          annotation('praise', P1, T1),
          annotation('praise', P2, T3),
          annotation('praise', P3, T1),
          annotation('sentence', SENTENCE_TEXT, T1),
          annotation('comment', COMMENT_TEXT, T1)
        ],
        T3
      )
    )
    await saveWork(
      classA.id,
      asgA.id,
      '92',
      makeWork(
        classA.id,
        asgA.id,
        '92',
        NAME_A2,
        'done',
        [
          annotation('praise', `${P1.replace('。', '')}  `, T2),
          annotation('praise', P2, T2)
        ],
        T3
      )
    )
    await saveWork(
      classA.id,
      asgA.id,
      '93',
      makeWork(
        classA.id,
        asgA.id,
        '93',
        NAME_A3,
        'grading',
        [annotation('praise', P5, T3)],
        T3
      )
    )
    await saveWork(
      classA.id,
      asgA.id,
      '94',
      makeWork(
        classA.id,
        asgA.id,
        '94',
        NAME_A4,
        'pending',
        [annotation('praise', P6, T3)],
        T3
      )
    )
    await saveWork(
      classA.id,
      asgB.id,
      '91',
      makeWork(
        classA.id,
        asgB.id,
        '91',
        NAME_A1,
        'done',
        [annotation('praise', P1, T4), annotation('praise', P4, T4)],
        T4
      )
    )
    await saveWork(
      classB.id,
      asgC.id,
      '95',
      makeWork(
        classB.id,
        asgC.id,
        '95',
        NAME_B1,
        'done',
        [annotation('praise', P7, T5)],
        T5
      )
    )

    const scoped = await getPraiseBank(classA.id)
    add(
      'Repository：getPraiseBank(classId) 只回該班',
      scoped.totalTexts === 4 &&
        scoped.totalUses === 7 &&
        !scoped.entries.some((entry) => entry.text === P7),
      `${classA.id}：${scoped.totalTexts} 句、${scoped.totalUses} 次`
    )

    const overall = await getPraiseBank()
    add(
      'Repository：getPraiseBank() 回全部班級',
      overall.totalTexts === 5 &&
        overall.totalUses === 8 &&
        overall.entries.some((entry) => entry.text === P7),
      `${overall.totalTexts} 句、${overall.totalUses} 次；含 ${classB.id} 的佳句`
    )

    // 壞掉的 assignment.json：整個作業跳過，不能讓全部失敗。
    const brokenDir = join(dbRoot, classA.id, 'E20990101')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(join(brokenDir, 'assignment.json'), '{ broken json', 'utf8')

    let skipError = ''
    let afterSkip: PraiseBank | null = null
    try {
      afterSkip = await getPraiseBank()
    } catch (error) {
      skipError = message(error)
    }
    add(
      'Repository：讀不到的作業跳過，不讓全部失敗',
      afterSkip !== null &&
        afterSkip.totalTexts === 5 &&
        afterSkip.totalUses === 8 &&
        skipError === '',
      afterSkip ? `仍為 ${afterSkip.totalTexts} 句、${afterSkip.totalUses} 次` : skipError
    )

    // ---- UI / IPC / preload ----------------------------------------------
    const ui = await runUiSmoke(classA.id)
    add('UI：主畫面佳句庫按鈕、面板、總數、範圍切換、搜尋、去識別與關閉', ui.ok, ui.detail)

    add(
      'IPC／preload：praise.bank(classId?) 與 clipboard.writeText',
      ui.api !== null &&
        ui.api.scopedTexts === 4 &&
        ui.api.scopedUses === 7 &&
        ui.api.allTexts === 5 &&
        ui.api.allUses === 8 &&
        ui.api.clipboard === 'function',
      ui.api
        ? `本班 ${ui.api.scopedTexts}／${ui.api.scopedUses}、全部 ${ui.api.allTexts}／${ui.api.allUses}、clipboard ${ui.api.clipboard}`
        : '未取得 preload API'
    )

    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已關閉或從未開啟
    }
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[praise] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
