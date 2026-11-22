import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BUILTIN_LIBRARY,
  DEFAULT_COOLDOWN_DAYS,
  JUNIOR_LIBRARY,
  LIBRARY_VERSION,
  LibrarySchema,
  RUBRIC_PRESETS,
  SENIOR_LIBRARY,
  applyLibraryDisabled,
  computeScore,
  distributeScore,
  isCooldownDays,
  libraryForGrade,
  mergeLibraryEntries,
  normalizeCooldownDays,
  normalizeComment,
  normalizeCustomTags,
  resolveGrade,
  sortLibraryEntries,
  validateCustomLibraryEntry,
  validateWork,
  type Annotation,
  type AssignmentFile,
  type GradeBand,
  type LibraryEntry,
  type LibraryMode,
  type LibrarySort,
  type WorkFile
} from '@essay-grader/core'
import { preprocessImage } from '../import/image'
import { readCustomEntries, writeCustomEntries } from './library-custom'
import {
  closeDatabase,
  createAssignment,
  createClass,
  getLibraryUsage,
  loadAssignment,
  loadWork,
  openDatabase,
  readWorkPage,
  saveClass,
  saveWork,
  updateAssignmentRubric
} from './repository'
import {
  normalizeLibraryDisabled,
  readLibraryDisabled,
  readLibraryPrefs,
  readSettings,
  writeLibraryDisabled,
  writeLibraryPrefs,
  writeSettings,
  type Settings
} from './settings'

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

interface LibraryToolsUiResult {
  ipcOk: boolean
  ipcDetail: string
  sortUiOk: boolean
  sortDetail: string
  persistOk: boolean
  persistDetail: string
  rotationUiOk: boolean
  rotationDetail: string
}

/** D23 停用／啟用：IPC 與 UI 分項結果。 */
interface LibraryDisabledUiResult {
  validateOk: boolean
  validateDetail: string
  applyOk: boolean
  applyDetail: string
  restoreOk: boolean
  restoreDetail: string
  scopeOk: boolean
  scopeDetail: string
  manageOk: boolean
  manageDetail: string
  hideOk: boolean
  hideDetail: string
  persistOk: boolean
  persistDetail: string
  enableOk: boolean
  enableDetail: string
  splitOk: boolean
  splitDetail: string
}

interface LibraryUiExpectation {
  classId: string
  assignmentId: string
  usedSentenceId: string
  usedCommentId: string
  otherCommentId: string
  defaultCommentId: string
  juniorCommentId: string
}

/** D11 自訂評語：UI 與 IPC 分項結果。 */
interface LibraryCustomUiResult {
  createOk: boolean
  createDetail: string
  editOk: boolean
  editDetail: string
  errorOk: boolean
  errorDetail: string
  persistOk: boolean
  persistDetail: string
  validateOk: boolean
  validateDetail: string
  toggleOk: boolean
  toggleDetail: string
  insertOk: boolean
  insertDetail: string
  deleteOk: boolean
  deleteDetail: string
}

const emptyLibraryTools = (): LibraryToolsUiResult => ({
  ipcOk: false,
  ipcDetail: '未執行',
  sortUiOk: false,
  sortDetail: '未執行',
  persistOk: false,
  persistDetail: '未執行',
  rotationUiOk: false,
  rotationDetail: '未執行'
})

const emptyLibraryDisabled = (): LibraryDisabledUiResult => ({
  validateOk: false,
  validateDetail: '未執行',
  applyOk: false,
  applyDetail: '未執行',
  restoreOk: false,
  restoreDetail: '未執行',
  scopeOk: false,
  scopeDetail: '未執行',
  manageOk: false,
  manageDetail: '未執行',
  hideOk: false,
  hideDetail: '未執行',
  persistOk: false,
  persistDetail: '未執行',
  enableOk: false,
  enableDetail: '未執行',
  splitOk: false,
  splitDetail: '未執行'
})

const emptyLibraryCustom = (): LibraryCustomUiResult => ({
  createOk: false,
  createDetail: '未執行',
  editOk: false,
  editDetail: '未執行',
  errorOk: false,
  errorDetail: '未執行',
  persistOk: false,
  persistDetail: '未執行',
  validateOk: false,
  validateDetail: '未執行',
  toggleOk: false,
  toggleDetail: '未執行',
  insertOk: false,
  insertDetail: '未執行',
  deleteOk: false,
  deleteDetail: '未執行'
})


/** 開隱藏視窗載入 renderer，確認主畫面、新的 preload API 與批閱畫面都能載入。 */
async function runUiSmoke(
  expectation: LibraryUiExpectation
): Promise<{
  ok: boolean
  detail: string
  libraryIpcOk: boolean
  libraryUiOk: boolean
  libraryDetail: string
  workStableOk: boolean
  libraryTools: LibraryToolsUiResult
  disabledLibrary: LibraryDisabledUiResult
  customLibrary: LibraryCustomUiResult
  quickScoreOk: boolean
  quickScoreDetail: string
  quickCopyOk: boolean
  quickCopyDetail: string
}> {
  const { classId, assignmentId, usedCommentId, usedSentenceId } = expectation
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
  const waitForText = async (needle: string, timeoutMs: number): Promise<boolean> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const ok = (await win.webContents.executeJavaScript(
        `document.body.innerText.includes(${JSON.stringify(needle)})`
      )) as boolean
      if (ok) return true
      await delay(120)
    }
    return false
  }
  const setSelect = async (selector: string, value: string): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const select = document.querySelector(${JSON.stringify(selector)})
        if (!select) return false
        select.value = ${JSON.stringify(value)}
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`
    )) as boolean
  const setInput = async (selector: string, value: string): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector(${JSON.stringify(selector)})
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set
        setter.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`
    )) as boolean
  const setTextarea = async (selector: string, value: string): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const area = document.querySelector(${JSON.stringify(selector)})
        if (!area) return false
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        ).set
        setter.call(area, ${JSON.stringify(value)})
        area.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`
    )) as boolean
  const setSelectIndex = async (
    selector: string,
    index: number,
    value: string
  ): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const select = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
        if (!select) return false
        select.value = ${JSON.stringify(value)}
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`
    )) as boolean
  const clickTextButton = async (scope: string, label: string): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const button = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')]
          .find((item) => (item.textContent ?? '').trim() === ${JSON.stringify(label)})
        button?.click()
        return Boolean(button)
      })()`
    )) as boolean

  /** 評語庫清單中依 id 找條目的 JS 運算式（供 executeJavaScript 內嵌）。 */
  const libraryItemExpr = (id: string): string =>
    `[...document.querySelectorAll('.rv-lib-item')].find(
      (item) => ((item.querySelector('.rv-lib-meta')?.textContent ?? '').trim().split(' · ')[0]) === ${JSON.stringify(id)}
    )`

  interface LibraryItemState {
    present: boolean
    disabled: boolean
    tag: string
    insertDisabled: boolean
    toggleLabels: string[]
  }

  const readLibraryItem = async (id: string): Promise<LibraryItemState> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const item = ${libraryItemExpr(id)}
        if (!item) return { present: false, disabled: false, tag: '', insertDisabled: false, toggleLabels: [] }
        return {
          present: true,
          disabled: item.classList.contains('rv-lib-disabled'),
          tag: (item.querySelector('.rv-lib-tag')?.textContent ?? '').trim(),
          insertDisabled: Boolean(item.querySelector('.rv-lib-insert')?.disabled),
          toggleLabels: [...item.querySelectorAll('.rv-lib-toggle')].map(
            (button) => (button.textContent ?? '').trim()
          )
        }
      })()`
    )) as LibraryItemState

  const clickLibraryItemButton = async (id: string, label: string): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const item = ${libraryItemExpr(id)}
        if (!item) return false
        const button = [...item.querySelectorAll('.rv-lib-toggle')].find(
          (candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(label)}
        )
        button?.click()
        return Boolean(button)
      })()`
    )) as boolean

  const clickLibraryManage = async (): Promise<boolean> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const button = document.querySelector(
          '.rv-card-head-actions button[title="管理停用／啟用評語"]'
        )
        button?.click()
        return Boolean(button)
      })()`
    )) as boolean

  const readLibraryManage = async (): Promise<{
    text: string
    pressed: string
    note: boolean
  }> =>
    (await win.webContents.executeJavaScript(
      `(() => {
        const button = document.querySelector(
          '.rv-card-head-actions button[title="管理停用／啟用評語"]'
        )
        return {
          text: (button?.textContent ?? '').trim(),
          pressed: button?.getAttribute('aria-pressed') ?? '',
          note: document.body.innerText.includes('停用不會刪除評語，舊批注仍保留文字。')
        }
      })()`
    )) as { text: string; pressed: string; note: boolean }

  /** 重新載入後回到批閱畫面，回傳評語庫面板是否就緒。 */
  const enterReviewView = async (): Promise<boolean> => {
    await waitForText('作文批閱', 12000)
    const assignment = await waitFor("document.querySelector('.assignment-row')", 8000)
    if (assignment) {
      await win.webContents.executeJavaScript("document.querySelector('.assignment-row')?.click()")
    }
    const reviewButton = assignment
      ? await waitFor(
          `[...document.querySelectorAll('.import-panel button')].some(
            (item) => item.textContent?.trim() === '批閱'
          )`,
          10000
        )
      : false
    if (reviewButton) {
      await win.webContents.executeJavaScript(
        `(() => {
          const button = [...document.querySelectorAll('.import-panel button')]
            .find((item) => item.textContent?.trim() === '批閱')
          button?.click()
          return Boolean(button)
        })()`
      )
    }
    const mounted = reviewButton ? await waitFor("document.querySelector('.rv')", 8000) : false
    return mounted ? await waitFor("document.querySelector('.rv-lib-sort')", 10000) : false
  }
  const fail = (
    detail: string
  ): {
    ok: boolean
    detail: string
    libraryIpcOk: boolean
    libraryUiOk: boolean
    libraryDetail: string
    workStableOk: boolean
    libraryTools: LibraryToolsUiResult
    disabledLibrary: LibraryDisabledUiResult
    customLibrary: LibraryCustomUiResult
    quickScoreOk: boolean
    quickScoreDetail: string
    quickCopyOk: boolean
    quickCopyDetail: string
  } => ({
    ok: false,
    detail,
    libraryIpcOk: false,
    libraryUiOk: false,
    libraryDetail: '未執行',
    workStableOk: false,
    libraryTools: emptyLibraryTools(),
    disabledLibrary: emptyLibraryDisabled(),
    customLibrary: emptyLibraryCustom(),
    quickScoreOk: false,
    quickScoreDetail: '未執行',
    quickCopyOk: false,
    quickCopyDetail: '未執行'
  })

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
        typeof window.electronAPI.library.get === 'function' &&
        typeof window.electronAPI.library.setMode === 'function' &&
        typeof window.electronAPI.library.usage === 'function' &&
        typeof window.electronAPI.library.getPrefs === 'function' &&
        typeof window.electronAPI.library.setPrefs === 'function'
      )`
    )) as boolean

    // 進入批閱介面：選作業 → 等作品列出現 → 按「批閱」。
    const mainOk = text.includes('作文批閱') && hasApi
    if (!mainOk) {
      return fail('主畫面未渲染或 preload API 不完整')
    }

    // ---- 評語庫 IPC：senior 班級 → 手動 junior → 回 auto ----------------
    const libraryIpc = (await win.webContents.executeJavaScript(
      `(async () => {
        const classId = ${JSON.stringify(classId)}
        const assignmentId = ${JSON.stringify(assignmentId)}
        await window.electronAPI.library.setMode('auto')
        const initial = await window.electronAPI.library.get(classId)
        await window.electronAPI.library.setMode('junior')
        const junior = await window.electronAPI.library.get(classId)
        await window.electronAPI.library.setMode('auto')
        const restored = await window.electronAPI.library.get(classId)
        const usage = await window.electronAPI.library.usage(classId, assignmentId)
        const prefsBefore = await window.electronAPI.library.getPrefs()
        const prefsSet = await window.electronAPI.library.setPrefs({
          sort: 'unused',
          pins: ['E-01', 'E-01', 'E-02', 7]
        })
        const prefsAfter = await window.electronAPI.library.getPrefs()
        const prefsCooldownSet = await window.electronAPI.library.setPrefs({ cooldownDays: 45 })
        const prefsCooldownAfter = await window.electronAPI.library.getPrefs()
        await window.electronAPI.library.setPrefs({ sort: 'default', pins: [], cooldownDays: 30 })
        return {
          ids: [initial.id, junior.id, restored.id],
          modes: [initial.mode, junior.mode, restored.mode],
          versions: [
            initial.library.library_version,
            junior.library.library_version,
            restored.library.library_version
          ],
          counts: [initial.library.entries.length, junior.library.entries.length],
          usage,
          prefsBefore,
          prefsSet,
          prefsAfter,
          prefsCooldownSet,
          prefsCooldownAfter
        }
      })()`
    )) as {
      ids: string[]
      modes: string[]
      versions: string[]
      counts: number[]
      usage: {
        current: Record<string, number>
        overall: Record<string, number>
        currentLastUsed: Record<string, string>
        overallLastUsed: Record<string, string>
      }
      prefsBefore: { sort: string; pins: string[]; cooldownDays: number }
      prefsSet: { sort: string; pins: string[]; cooldownDays: number }
      prefsAfter: { sort: string; pins: string[]; cooldownDays: number }
      prefsCooldownSet: { sort: string; pins: string[]; cooldownDays: number }
      prefsCooldownAfter: { sort: string; pins: string[]; cooldownDays: number }
    }
    const libraryIpcOk =
      libraryIpc.ids.join(',') === 'senior,junior,senior' &&
      libraryIpc.modes.join(',') === 'auto,junior,auto' &&
      libraryIpc.versions[0] === LIBRARY_VERSION &&
      libraryIpc.versions[1] === JUNIOR_LIBRARY.library_version &&
      libraryIpc.counts[0] === 138 &&
      libraryIpc.counts[1] === 138

    // ---- 使用次數與偏好 IPC ------------------------------------------------
    const usageIpcOk =
      libraryIpc.usage.current[usedSentenceId] === 3 &&
      libraryIpc.usage.current[usedCommentId] === 2 &&
      libraryIpc.usage.overall[usedSentenceId] === 4 &&
      libraryIpc.usage.overall[usedCommentId] === 2 &&
      libraryIpc.usage.overall[expectation.otherCommentId] === 1 &&
      Number.isFinite(Date.parse(libraryIpc.usage.overallLastUsed[usedSentenceId])) &&
      Number.isFinite(Date.parse(libraryIpc.usage.overallLastUsed[usedCommentId])) &&
      Number.isFinite(Date.parse(libraryIpc.usage.overallLastUsed[expectation.otherCommentId]))
    const prefsIpcOk =
      libraryIpc.prefsAfter.sort === 'unused' &&
      libraryIpc.prefsAfter.pins.join(',') === 'E-01,E-02' &&
      libraryIpc.prefsSet.sort === 'unused' &&
      libraryIpc.prefsSet.pins.join(',') === 'E-01,E-02'
    const cooldownIpcOk =
      libraryIpc.prefsCooldownSet.cooldownDays === 45 &&
      libraryIpc.prefsCooldownAfter.cooldownDays === 45
    const libraryTools = emptyLibraryTools()
    libraryTools.ipcOk = usageIpcOk && prefsIpcOk && cooldownIpcOk
    libraryTools.ipcDetail = `usage 本批 ${libraryIpc.usage.current[usedSentenceId] ?? 0}／累計 ${
      libraryIpc.usage.overall[usedSentenceId] ?? 0
    }；prefs ${libraryIpc.prefsAfter.sort}／${libraryIpc.prefsAfter.pins.join(',') ||
      '無'}；cooldownDays ${libraryIpc.prefsCooldownAfter.cooldownDays}`

    // ---- D23 停用／啟用 IPC ------------------------------------------------
    const disabledLibrary = emptyLibraryDisabled()
    const customLibrary = emptyLibraryCustom()
    const disabledIpc = (await win.webContents.executeJavaScript(
      `(async () => {
        const classId = ${JSON.stringify(classId)}
        const seniorId = ${JSON.stringify(usedCommentId)}
        const juniorId = ${JSON.stringify(expectation.juniorCommentId)}
        const invalid = []
        const attempts = [
          ['bogus', seniorId, true],
          ['senior', '', true],
          ['senior', 'NO-SUCH-ID', true],
          ['senior', seniorId, 'yes']
        ]
        for (const [libraryId, entryId, flag] of attempts) {
          try {
            await window.electronAPI.library.setDisabled(libraryId, entryId, flag)
            invalid.push('accepted')
          } catch {
            invalid.push('rejected')
          }
        }
        await window.electronAPI.library.setMode('auto')
        await window.electronAPI.library.setDisabled('senior', seniorId, false)
        await window.electronAPI.library.setDisabled('junior', juniorId, false)
        const base = await window.electronAPI.library.get(classId)
        const baseDisabled = base.library.entries
          .filter((entry) => entry.disabled)
          .map((entry) => entry.id)
          .sort()
        const baseCount = base.library.entries.length
        const setResult = await window.electronAPI.library.setDisabled('senior', seniorId, true)
        const afterDisable = await window.electronAPI.library.get(classId)
        const afterDisabled = afterDisable.library.entries
          .filter((entry) => entry.disabled)
          .map((entry) => entry.id)
          .sort()
        const disabledEntry = afterDisable.library.entries.find((entry) => entry.id === seniorId)
        await window.electronAPI.library.setDisabled('junior', juniorId, true)
        const seniorAfterJunior = await window.electronAPI.library.get(classId)
        const seniorDisabledAfterJunior = seniorAfterJunior.library.entries
          .filter((entry) => entry.disabled)
          .map((entry) => entry.id)
          .sort()
        await window.electronAPI.library.setMode('junior')
        const juniorPayload = await window.electronAPI.library.get(classId)
        const juniorEntry = juniorPayload.library.entries.find((entry) => entry.id === juniorId)
        await window.electronAPI.library.setMode('auto')
        await window.electronAPI.library.setDisabled('senior', seniorId, false)
        await window.electronAPI.library.setDisabled('junior', juniorId, false)
        const restored = await window.electronAPI.library.get(classId)
        const restoredDisabled = restored.library.entries
          .filter((entry) => entry.disabled)
          .map((entry) => entry.id)
          .sort()
        const restoredEntry = restored.library.entries.find((entry) => entry.id === seniorId)
        return {
          invalid,
          baseId: base.id,
          baseCount,
          baseDisabled,
          setIds: setResult.disabledIds,
          afterCount: afterDisable.library.entries.length,
          afterDisabled,
          disabledEntry: Boolean(disabledEntry?.disabled),
          seniorPayloadId: seniorAfterJunior.id,
          seniorDisabledAfterJunior,
          seniorJuniorEntryDisabled: Boolean(
            seniorAfterJunior.library.entries.find((entry) => entry.id === juniorId)?.disabled
          ),
          juniorPayloadId: juniorPayload.id,
          juniorEntryDisabled: Boolean(juniorEntry?.disabled),
          restoredCount: restored.library.entries.length,
          restoredDisabled,
          restoredEntry: Boolean(restoredEntry?.disabled)
        }
      })()`
    )) as {
      invalid: string[]
      baseId: string
      baseCount: number
      baseDisabled: string[]
      setIds: string[]
      afterCount: number
      afterDisabled: string[]
      disabledEntry: boolean
      seniorPayloadId: string
      seniorDisabledAfterJunior: string[]
      seniorJuniorEntryDisabled: boolean
      juniorPayloadId: string
      juniorEntryDisabled: boolean
      restoredCount: number
      restoredDisabled: string[]
      restoredEntry: boolean
    }

    const expectedAfter = [...disabledIpc.baseDisabled, usedCommentId].sort()
    disabledLibrary.validateOk =
      disabledIpc.invalid.length === 4 &&
      disabledIpc.invalid.every((item) => item === 'rejected') &&
      disabledIpc.setIds.includes(usedCommentId)
    disabledLibrary.validateDetail = disabledLibrary.validateOk
      ? `4 種非法值皆拒絕（版本／空 id／不存在的 id／非 boolean）；合法停用寫入 ${usedCommentId}`
      : `非法值未全數拒絕（${disabledIpc.invalid.join(',')}）`

    disabledLibrary.applyOk =
      disabledIpc.baseId === 'senior' &&
      disabledIpc.afterCount === disabledIpc.baseCount &&
      disabledIpc.afterCount === 138 &&
      disabledIpc.disabledEntry &&
      disabledIpc.afterDisabled.join(',') === expectedAfter.join(',') &&
      disabledIpc.afterDisabled.length === disabledIpc.baseDisabled.length + 1
    disabledLibrary.applyDetail = disabledLibrary.applyOk
      ? `library:get(senior 班) 條目仍 ${disabledIpc.afterCount} 條，${usedCommentId} disabled=true`
      : `停用後 payload 不符（${disabledIpc.afterCount} 條、${usedCommentId} disabled=${
          disabledIpc.disabledEntry
        }、停用清單 ${disabledIpc.afterDisabled.join(',') || '無'}）`

    disabledLibrary.restoreOk =
      disabledIpc.restoredEntry === false &&
      disabledIpc.restoredCount === disabledIpc.baseCount &&
      disabledIpc.restoredDisabled.join(',') === disabledIpc.baseDisabled.join(',')
    disabledLibrary.restoreDetail = disabledLibrary.restoreOk
      ? `${usedCommentId} 重新啟用後 disabled 回到原值（停用清單 ${
          disabledIpc.restoredDisabled.join(',') || '空'
        }）`
      : `重新啟用後未回原值（disabled=${disabledIpc.restoredEntry}、清單 ${
          disabledIpc.restoredDisabled.join(',') || '空'
        }）`

    disabledLibrary.scopeOk =
      disabledIpc.seniorPayloadId === 'senior' &&
      disabledIpc.seniorPayloadId !== disabledIpc.juniorPayloadId &&
      disabledIpc.seniorDisabledAfterJunior.join(',') === expectedAfter.join(',') &&
      disabledIpc.seniorJuniorEntryDisabled === false &&
      disabledIpc.juniorPayloadId === 'junior' &&
      disabledIpc.juniorEntryDisabled
    disabledLibrary.scopeDetail = disabledLibrary.scopeOk
      ? `高中職停用 ${usedCommentId}；國中停用 ${expectation.juniorCommentId}，兩邊 payload 各自套用、互不影響`
      : `版本停用未分開（senior ${disabledIpc.seniorPayloadId}／${
          disabledIpc.seniorDisabledAfterJunior.join(',') || '無'
        }；junior ${disabledIpc.juniorPayloadId}／${expectation.juniorCommentId} disabled=${
          disabledIpc.juniorEntryDisabled
        }）`

    const assignmentReady = await waitFor(
      "document.querySelector('.assignment-row')",
      6000
    )
    if (!assignmentReady) {
      return fail('找不到作業列')
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
      return fail('作品列沒有出現「批閱」按鈕')
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
      return fail('無法點擊「批閱」按鈕')
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

    // ---- 評語庫 UI：版本下拉、草稿提示、切換後清單更新 -------------------
    let libraryUiOk = false
    let libraryUiDetail = '未執行'
    let workStableOk = false
    if (reviewMounted) {
      const panelReady = await waitFor("document.querySelector('.rv-lib-version select')", 6000)
      const libraryReady = panelReady
        ? await waitFor(
            `(document.querySelector('.rv-lib-current')?.textContent ?? '').includes('2026.1')`,
            6000
          )
        : false

      const readUi = `(() => ({
        options: [...(document.querySelector('.rv-lib-version select')?.options ?? [])].map(
          (option) => option.value
        ),
        current: (document.querySelector('.rv-lib-current')?.textContent ?? '').trim(),
        firstId: (document.querySelector('.rv-lib-item .rv-lib-meta')?.textContent ?? '').trim(),
        final: document.querySelector('.rv-final')?.value ?? '',
        total: (document.querySelector('.rv-total strong')?.textContent ?? '').trim(),
        body: document.body.innerText
      }))()`
      const before = (await win.webContents.executeJavaScript(readUi)) as {
        options: string[]
        current: string
        firstId: string
        final: string
        total: string
        body: string
      }

      const switchMode = async (mode: string): Promise<void> => {
        await win.webContents.executeJavaScript(`(() => {
          const select = document.querySelector('.rv-lib-version select')
          if (!select) return false
          select.value = ${JSON.stringify(mode)}
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        })()`)
      }

      await switchMode('junior')
      const juniorReady = libraryReady
        ? await waitFor(
            `Boolean(document.querySelector('.rv-lib-draft')) &&
             (document.querySelector('.rv-lib-current')?.textContent ?? '').includes('國中版') &&
             (document.querySelector('.rv-lib-item .rv-lib-meta')?.textContent ?? '').trim().startsWith('JE-')`,
            8000
          )
        : false
      const juniorText = (await win.webContents.executeJavaScript(
        "document.body.innerText.includes('國中版為草稿，建議校閱後使用')"
      )) as boolean

      await switchMode('auto')
      const autoReady = juniorReady
        ? await waitFor(
            `(document.querySelector('.rv-lib-current')?.textContent ?? '').includes('高中職版') &&
             (document.querySelector('.rv-lib-item .rv-lib-meta')?.textContent ?? '').trim().startsWith('E-')`,
            8000
          )
        : false
      const after = (await win.webContents.executeJavaScript(readUi)) as {
        options: string[]
        current: string
        firstId: string
        final: string
        total: string
        body: string
      }

      libraryUiOk =
        panelReady &&
        libraryReady &&
        before.options.join(',') === 'auto,junior,senior' &&
        before.current.includes('高中職版') &&
        before.firstId.startsWith('E-') &&
        juniorReady &&
        juniorText &&
        autoReady
      libraryUiDetail = libraryUiOk
        ? `下拉 ${before.options.length} 選項；高中職 ${before.firstId} → 國中 ${JUNIOR_LIBRARY.library_version}（草稿）→ 回 auto ${after.firstId}`
        : !panelReady
          ? '找不到版本下拉'
          : !libraryReady
            ? '版本文字未載入 2026.1'
            : !juniorReady
              ? `切換國中版後清單未更新（${after.current}）`
              : !juniorText
                ? '未顯示國中版草稿提示'
                : '切回 auto 後未回到高中職版'

      workStableOk =
        before.final.length > 0 &&
        before.final === after.final &&
        before.total === after.total &&
        after.total !== ''

      // ---- D13：排序、釘選、使用次數與重開保留 ---------------------------
      const categoryReady = await setSelect('.rv-lib-category', 'comment')
      const commentListReady = categoryReady
        ? await waitFor(
            `(document.querySelector('.rv-lib-item .rv-lib-meta')?.textContent ?? '')
              .trim().startsWith(${JSON.stringify(expectation.defaultCommentId)})`,
            8000
          )
        : false

      if (commentListReady) {
        await setSelect('.rv-lib-sort', 'usage')
        const sortedFirstOk = await waitFor(
          `(document.querySelector('.rv-lib-item .rv-lib-meta')?.textContent ?? '')
            .trim().startsWith(${JSON.stringify(usedCommentId)})`,
          10000
        )
        const usageLabel = (await win.webContents.executeJavaScript(
          "document.querySelector('.rv-lib-item .rv-lib-usage')?.textContent?.trim() ?? ''"
        )) as string
        const usageLabelOk =
          usageLabel.includes('本批 2 次') && usageLabel.includes('累計 2 次')

        const pinTarget = (await win.webContents.executeJavaScript(
          `(() => {
            const items = [...document.querySelectorAll('.rv-lib-item')]
            const target = items[1]
            if (!target) return ''
            const id = (target.querySelector('.rv-lib-meta')?.textContent ?? '').trim().split(' · ')[0]
            target.querySelector('.rv-lib-pin')?.click()
            return id
          })()`
        )) as string

        const pinnedFirstOk = pinTarget
          ? await waitFor(
              `(() => {
                const first = document.querySelector('.rv-lib-item')
                if (!first) return false
                const id = (first.querySelector('.rv-lib-meta')?.textContent ?? '').trim().split(' · ')[0]
                return id === ${JSON.stringify(pinTarget)} &&
                  (first.querySelector('.rv-lib-pin')?.textContent ?? '').trim() === '已釘選'
              })()`,
              6000
            )
          : false

        let savedPrefs = (await win.webContents.executeJavaScript(
          'window.electronAPI.library.getPrefs()'
        )) as { sort: string; pins: string[] }
        for (let i = 0; i < 20; i++) {
          if (savedPrefs.sort === 'usage' && savedPrefs.pins.includes(pinTarget)) break
          await delay(150)
          savedPrefs = (await win.webContents.executeJavaScript(
            'window.electronAPI.library.getPrefs()'
          )) as { sort: string; pins: string[] }
        }
        const prefsSavedOk =
          savedPrefs.sort === 'usage' && savedPrefs.pins.includes(pinTarget)

        libraryTools.sortUiOk =
          sortedFirstOk && usageLabelOk && pinnedFirstOk && prefsSavedOk
        libraryTools.sortDetail = sortedFirstOk
          ? `常用排序第一筆 ${usedCommentId}；${usageLabel || '無次數標示'}；釘選 ${
              pinTarget || '—'
            }${pinnedFirstOk ? ' 已置頂' : ' 未置頂'}`
          : `切換常用排序後第一筆未變成 ${usedCommentId}`

        // 收合再展開面板，確認畫面狀態保留。
        const collapsed = (await win.webContents.executeJavaScript(
          `(() => {
            const card = [...document.querySelectorAll('.rv-card')]
              .find((item) => item.querySelector('h3')?.textContent?.includes('評語庫'))
            const button = card
              ? [...card.querySelectorAll('button')]
                  .find((item) => item.textContent?.trim() === '收合')
              : null
            button?.click()
            return Boolean(button)
          })()`
        )) as boolean
        const collapsedOk = collapsed
          ? await waitFor("!document.querySelector('.rv-lib-list')", 3000)
          : false
        const reopened = collapsedOk
          ? ((await win.webContents.executeJavaScript(
              `(() => {
                const card = [...document.querySelectorAll('.rv-card')]
                  .find((item) => item.querySelector('h3')?.textContent?.includes('評語庫'))
                const button = card
                  ? [...card.querySelectorAll('button')]
                      .find((item) => item.textContent?.trim() === '展開')
                  : null
                button?.click()
                return Boolean(button)
              })()`
            )) as boolean)
          : false
        const reopenedOk = reopened ? await waitFor("document.querySelector('.rv-lib-sort')", 6000) : false

        // 重新載入同一個視窗，確認偏好由 settings.json 重新載入。
        await win.webContents.reload()
        await waitForText('作文批閱', 12000)
        const assignmentAgain = await waitFor("document.querySelector('.assignment-row')", 8000)
        if (assignmentAgain) {
          await win.webContents.executeJavaScript(
            "document.querySelector('.assignment-row')?.click()"
          )
        }
        const reviewButtonAgain = assignmentAgain
          ? await waitFor(
              `[...document.querySelectorAll('.import-panel button')].some(
                (item) => item.textContent?.trim() === '批閱'
              )`,
              10000
            )
          : false
        if (reviewButtonAgain) {
          await win.webContents.executeJavaScript(
            `(() => {
              const button = [...document.querySelectorAll('.import-panel button')]
                .find((item) => item.textContent?.trim() === '批閱')
              button?.click()
              return Boolean(button)
            })()`
          )
        }
        const reviewAgain = reviewButtonAgain
          ? await waitFor("document.querySelector('.rv')", 8000)
          : false
        const panelAgain = reviewAgain
          ? await waitFor("document.querySelector('.rv-lib-sort')", 10000)
          : false
        if (panelAgain) await setSelect('.rv-lib-category', 'comment')
        const persistedFirstOk = panelAgain
          ? await waitFor(
              `(() => {
                const first = document.querySelector('.rv-lib-item')
                if (!first) return false
                const id = (first.querySelector('.rv-lib-meta')?.textContent ?? '').trim().split(' · ')[0]
                return id === ${JSON.stringify(pinTarget)} &&
                  (first.querySelector('.rv-lib-pin')?.textContent ?? '').trim() === '已釘選'
              })()`,
              10000
            )
          : false
        const persistedSort = panelAgain
          ? ((await win.webContents.executeJavaScript(
              "document.querySelector('.rv-lib-sort')?.value ?? ''"
            )) as string)
          : ''
        libraryTools.persistOk =
          collapsedOk &&
          reopenedOk &&
          persistedFirstOk &&
          persistedSort === 'usage' &&
          prefsSavedOk
        libraryTools.persistDetail = libraryTools.persistOk
          ? `收合再展開正常；重新載入後排序 ${persistedSort}、釘選 ${pinTarget} 仍在第一筆`
          : !collapsedOk
            ? '收合面板失敗'
            : !reopenedOk
              ? '展開面板後清單未回來'
              : !prefsSavedOk
                ? '偏好未寫入 settings'
                : `重新載入後未保留（排序 ${persistedSort || '—'}、第一筆 ${
                    persistedFirstOk ? pinTarget : '不符'
                  }）`
      } else {
        libraryTools.sortDetail = '評語庫分類切到「評語」後清單未載入'
        libraryTools.persistDetail = '排序測試未完成'
      }

      // ---- D22：冷卻輪替 UI（下拉、天數輸入、上次使用、重載保留） ---------
      const rotationOpt = (await win.webContents.executeJavaScript(
        `[...(document.querySelector('.rv-lib-sort')?.options ?? [])].map((option) => option.value)`
      )) as string[]
      const rotationOptionOk = Array.isArray(rotationOpt) && rotationOpt.includes('rotation')
      await setSelect('.rv-lib-sort', 'rotation')
      const cooldownInputReady = await waitFor(
        "document.querySelector('.rv-lib-cooldown input')",
        6000
      )
      const cooldownValue = cooldownInputReady
        ? ((await win.webContents.executeJavaScript(
            "document.querySelector('.rv-lib-cooldown input')?.value ?? ''"
          )) as string)
        : ''
      const lastUsedReady = cooldownInputReady
        ? await waitFor("document.querySelector('.rv-lib-item .rv-lib-lastused')", 6000)
        : false
      const rotationOrderIds = (await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.rv-lib-item .rv-lib-meta')]
          .map((el) => (el.textContent ?? '').trim().split(' · ')[0])`
      )) as string[]
      const rotationOrderOk =
        rotationOrderIds.includes(expectation.defaultCommentId) &&
        rotationOrderIds.includes(usedCommentId) &&
        rotationOrderIds.indexOf(expectation.defaultCommentId) <
          rotationOrderIds.indexOf(usedCommentId)
      const neverUsedTextOk = (await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.rv-lib-item')]
          .some((item) => (item.querySelector('.rv-lib-lastused')?.textContent ?? '').includes('尚未使用'))`
      )) as boolean

      await setInput('.rv-lib-cooldown input', '45')
      let rotationPrefs = (await win.webContents.executeJavaScript(
        'window.electronAPI.library.getPrefs()'
      )) as { sort: string; pins: string[]; cooldownDays: number }
      for (let i = 0; i < 20; i++) {
        if (rotationPrefs.sort === 'rotation' && rotationPrefs.cooldownDays === 45) break
        await delay(150)
        rotationPrefs = (await win.webContents.executeJavaScript(
          'window.electronAPI.library.getPrefs()'
        )) as { sort: string; pins: string[]; cooldownDays: number }
      }
      const rotationPrefsSavedOk =
        rotationPrefs.sort === 'rotation' && rotationPrefs.cooldownDays === 45

      await win.webContents.reload()
      await waitForText('作文批閱', 12000)
      const assignmentAgain2 = await waitFor("document.querySelector('.assignment-row')", 8000)
      if (assignmentAgain2) {
        await win.webContents.executeJavaScript(
          "document.querySelector('.assignment-row')?.click()"
        )
      }
      const reviewButtonAgain2 = assignmentAgain2
        ? await waitFor(
            `[...document.querySelectorAll('.import-panel button')].some(
              (item) => item.textContent?.trim() === '批閱'
            )`,
            10000
          )
        : false
      if (reviewButtonAgain2) {
        await win.webContents.executeJavaScript(
          `(() => {
            const button = [...document.querySelectorAll('.import-panel button')]
              .find((item) => item.textContent?.trim() === '批閱')
            button?.click()
            return Boolean(button)
          })()`
        )
      }
      const reviewAgain2 = reviewButtonAgain2
        ? await waitFor("document.querySelector('.rv')", 8000)
        : false
      const panelAgain2 = reviewAgain2
        ? await waitFor("document.querySelector('.rv-lib-sort')", 10000)
        : false
      const persistedRotationSort = panelAgain2
        ? ((await win.webContents.executeJavaScript(
            "document.querySelector('.rv-lib-sort')?.value ?? ''"
          )) as string)
        : ''
      const persistedCooldownValue = panelAgain2
        ? (await waitFor("document.querySelector('.rv-lib-cooldown input')", 6000))
          ? ((await win.webContents.executeJavaScript(
              "document.querySelector('.rv-lib-cooldown input')?.value ?? ''"
            )) as string)
          : ''
        : ''
      const persistedLastUsedOk = panelAgain2
        ? await waitFor("document.querySelector('.rv-lib-item .rv-lib-lastused')", 6000)
        : false

      libraryTools.rotationUiOk =
        rotationOptionOk &&
        cooldownInputReady &&
        cooldownValue === '30' &&
        lastUsedReady &&
        rotationOrderOk &&
        neverUsedTextOk &&
        rotationPrefsSavedOk &&
        persistedRotationSort === 'rotation' &&
        persistedCooldownValue === '45' &&
        persistedLastUsedOk
      libraryTools.rotationDetail = libraryTools.rotationUiOk
        ? `下拉含 rotation；天數預設 ${cooldownValue} → 改 45；尚未使用排前；重載後 ${persistedRotationSort}／${persistedCooldownValue}`
        : !rotationOptionOk
          ? '排序下拉沒有冷卻輪替選項'
          : !cooldownInputReady
            ? '冷卻天數輸入未出現'
            : !lastUsedReady
              ? '未顯示上次使用文字'
              : !rotationOrderOk
                ? `rotation 順序未變（${rotationOrderIds.slice(0, 4).join(',')}…）`
                : !rotationPrefsSavedOk
                  ? '冷卻天數未寫入 settings'
                  : `重載後未保留（sort ${persistedRotationSort}／天數 ${persistedCooldownValue}）`

      // ---- D23 停用／啟用 UI（管理切換、隱藏、重載保留、版本分開） -------
      await setSelect('.rv-lib-category', 'comment')
      await setSelect('.rv-lib-sort', 'default')
      const d23Target = expectation.defaultCommentId
      const d23Junior = expectation.juniorCommentId
      const d23ListReady = await waitFor(
        `Boolean(${libraryItemExpr(d23Target)})`,
        8000
      )
      const manageOff = await readLibraryManage()
      const targetBefore = await readLibraryItem(d23Target)
      const manageClicked = await clickLibraryManage()
      const manageOn = manageClicked
        ? await waitFor(
            `(() => {
              const button = document.querySelector(
                '.rv-card-head-actions button[title="管理停用／啟用評語"]'
              )
              return button?.getAttribute('aria-pressed') === 'true' &&
                document.body.innerText.includes('停用不會刪除評語，舊批注仍保留文字。')
            })()`,
            6000
          )
        : false
      const manageState = await readLibraryManage()
      const targetManaged = await readLibraryItem(d23Target)
      const manageOk =
        d23ListReady &&
        targetBefore.present &&
        !targetBefore.disabled &&
        manageOff.text === '管理' &&
        !manageOff.note &&
        manageOn &&
        manageState.text === '完成管理' &&
        manageState.pressed === 'true' &&
        targetManaged.present &&
        !targetManaged.disabled &&
        targetManaged.toggleLabels.includes('停用')
      disabledLibrary.manageOk = manageOk
      disabledLibrary.manageDetail = manageOk
        ? `面板有「管理」切換；開啟後顯示「完成管理」與停用說明，${d23Target} 出現停用按鈕`
        : `管理切換未生效（按鈕 ${manageState.text || '—'}、aria ${
            manageState.pressed || '—'
          }、說明 ${manageState.note ? '有' : '無'}）`

      const disableClicked = await clickLibraryItemButton(d23Target, '停用')
      const disableApplied = disableClicked
        ? await waitFor(
            `(() => {
              const item = ${libraryItemExpr(d23Target)}
              if (!item) return false
              return item.classList.contains('rv-lib-disabled') &&
                (item.querySelector('.rv-lib-tag')?.textContent ?? '').trim() === '已停用' &&
                item.querySelector('.rv-lib-insert')?.disabled === true &&
                [...item.querySelectorAll('.rv-lib-toggle')].some(
                  (button) => (button.textContent ?? '').trim() === '啟用'
                )
            })()`,
            8000
          )
        : false
      const disabledPersistedApi = (await win.webContents.executeJavaScript(
        `(async () => {
          const payload = await window.electronAPI.library.get(${JSON.stringify(classId)})
          return payload.library.entries
            .filter((entry) => entry.disabled)
            .map((entry) => entry.id)
        })()`
      )) as string[]

      const closeClicked = await clickLibraryManage()
      const hiddenAfterClose = closeClicked
        ? await waitFor(`!(${libraryItemExpr(d23Target)})`, 6000)
        : false
      await win.webContents.reload()
      const reloaded = await enterReviewView()
      if (reloaded) {
        await setSelect('.rv-lib-category', 'comment')
        await setSelect('.rv-lib-sort', 'default')
      }
      const reloadListReady = reloaded
        ? await waitFor("document.querySelectorAll('.rv-lib-item').length > 5", 8000)
        : false
      const hiddenAfterReload = reloadListReady
        ? await waitFor(`!(${libraryItemExpr(d23Target)})`, 4000)
        : false
      disabledLibrary.hideOk = hiddenAfterClose && hiddenAfterReload
      disabledLibrary.hideDetail = disabledLibrary.hideOk
        ? `停用 ${d23Target} 後關閉管理即消失；重新載入仍不在清單`
        : `關閉管理${hiddenAfterClose ? '已隱藏' : '未隱藏'}；重新載入${
            hiddenAfterReload ? '已隱藏' : '仍出現'
          }`

      const manageAgainClicked = reloadListReady ? await clickLibraryManage() : false
      const manageAgain = manageAgainClicked
        ? await waitFor(
            `(() => {
              const button = document.querySelector(
                '.rv-card-head-actions button[title="管理停用／啟用評語"]'
              )
              return button?.getAttribute('aria-pressed') === 'true'
            })()`,
            6000
          )
        : false
      const persistedTarget: LibraryItemState = manageAgain
        ? await readLibraryItem(d23Target)
        : { present: false, disabled: false, tag: '', insertDisabled: false, toggleLabels: [] }
      disabledLibrary.persistOk =
        disableApplied &&
        disabledPersistedApi.includes(d23Target) &&
        hiddenAfterReload &&
        manageAgain &&
        persistedTarget.disabled &&
        persistedTarget.tag === '已停用' &&
        persistedTarget.toggleLabels.includes('啟用')
      disabledLibrary.persistDetail = disabledLibrary.persistOk
        ? `停用後 settings 與 payload 皆有 ${d23Target}；重新載入並開啟管理，條目顯示「已停用」與「啟用」`
        : !disableApplied
          ? '按停用後條目未標記為已停用'
          : `重新載入後狀態不符（清單 ${disabledPersistedApi.join(',') || '空'}、標籤 ${
              persistedTarget.tag || '無'
            }）`

      await setSelect('.rv-lib-version select', 'junior')
      const d23JuniorReady = await waitFor(
        `(() => {
          const current = document.querySelector('.rv-lib-current')?.textContent ?? ''
          return current.includes('國中版') && Boolean(${libraryItemExpr(d23Junior)})
        })()`,
        10000
      )
      const juniorBefore = await readLibraryItem(d23Junior)
      const juniorDisableClicked = d23JuniorReady
        ? await clickLibraryItemButton(d23Junior, '停用')
        : false
      const juniorDisabled = juniorDisableClicked
        ? await waitFor(
            `Boolean(${libraryItemExpr(d23Junior)}?.classList.contains('rv-lib-disabled'))`,
            8000
          )
        : false
      await setSelect('.rv-lib-version select', 'senior')
      const seniorBackReady = await waitFor(
        `(() => {
          const current = document.querySelector('.rv-lib-current')?.textContent ?? ''
          return current.includes('高中職版') && Boolean(${libraryItemExpr(d23Target)})
        })()`,
        10000
      )
      const seniorStillDisabled: LibraryItemState = seniorBackReady
        ? await readLibraryItem(d23Target)
        : { present: false, disabled: false, tag: '', insertDisabled: false, toggleLabels: [] }
      const juniorAbsentInSenior = seniorBackReady
        ? !(await readLibraryItem(d23Junior)).present
        : false
      const enableClicked = seniorBackReady
        ? await clickLibraryItemButton(d23Target, '啟用')
        : false
      const seniorEnabled = enableClicked
        ? await waitFor(
            `(() => {
              const item = ${libraryItemExpr(d23Target)}
              if (!item) return false
              return !item.classList.contains('rv-lib-disabled') &&
                (item.querySelector('.rv-lib-tag')?.textContent ?? '').trim() === '' &&
                item.querySelector('.rv-lib-insert')?.disabled === false &&
                [...item.querySelectorAll('.rv-lib-toggle')].some(
                  (button) => (button.textContent ?? '').trim() === '停用'
                )
            })()`,
            8000
          )
        : false
      await setSelect('.rv-lib-version select', 'junior')
      const juniorAgainReady = await waitFor(
        `(() => {
          const current = document.querySelector('.rv-lib-current')?.textContent ?? ''
          return current.includes('國中版') &&
            Boolean(${libraryItemExpr(d23Junior)}?.classList.contains('rv-lib-disabled'))
        })()`,
        10000
      )
      const juniorEnableClicked = juniorAgainReady
        ? await clickLibraryItemButton(d23Junior, '啟用')
        : false
      const juniorEnabled = juniorEnableClicked
        ? await waitFor(
            `(() => {
              const item = ${libraryItemExpr(d23Junior)}
              return Boolean(item) && !item.classList.contains('rv-lib-disabled')
            })()`,
            8000
          )
        : false
      await setSelect('.rv-lib-version select', 'auto')
      const autoBack = await waitFor(
        `(document.querySelector('.rv-lib-current')?.textContent ?? '').includes('高中職版')`,
        10000
      )
      const closeFinal = autoBack ? await clickLibraryManage() : false
      const finalVisible = closeFinal
        ? await waitFor(`Boolean(${libraryItemExpr(d23Target)})`, 6000)
        : false

      disabledLibrary.enableOk =
        seniorEnabled && juniorEnabled && finalVisible && autoBack
      disabledLibrary.enableDetail = disabledLibrary.enableOk
        ? `啟用 ${d23Target}／${d23Junior} 後恢復可插入；關閉管理仍在清單`
        : `啟用後未恢復（${d23Target} ${
            seniorEnabled ? '已恢復' : '未恢復'
          }、${d23Junior} ${juniorEnabled ? '已恢復' : '未恢復'}、關閉管理後${
            finalVisible ? '可見' : '消失'
          }）`
      disabledLibrary.splitOk =
        d23JuniorReady &&
        juniorBefore.present &&
        !juniorBefore.disabled &&
        juniorDisabled &&
        seniorStillDisabled.disabled &&
        juniorAbsentInSenior &&
        seniorEnabled &&
        juniorAgainReady &&
        juniorEnabled
      disabledLibrary.splitDetail = disabledLibrary.splitOk
        ? `停用 ${d23Target} 後切國中版，${d23Junior} 仍為啟用；停用 ${d23Junior} 再切高中職，${
            d23Target
          } 仍停用且互不出現在對方清單`
        : `版本清單未分開（junior ${d23JuniorReady ? '已載入' : '未載入'}、${d23Junior} disabled=${
            juniorDisabled
          }；${d23Target} 切回 senior disabled=${seniorStillDisabled.disabled}）`

      // ---- D11 自訂評語：新增／編輯／錯誤／重載／停用／插入／刪除 ----------
      const customText =
        '這是一條測試用的自訂評語，內容刻意寫得比較長，用來確認新增、編輯、刪除與重新載入之後仍可正確保存。'
      const customTextEdited =
        '這是一條編輯後的自訂評語，內容同樣刻意寫得比較長，用來確認修改文字與標籤之後可以正確讀回並保存。'
      const customTags = ['測試', '自訂']
      const customTagsEdited = ['測試', '已編輯']

      const manageStateD11 = await readLibraryManage()
      if (manageStateD11.pressed !== 'true') await clickLibraryManage()
      const addButtonReady = await waitFor(
        `[...document.querySelectorAll('.rv-card-head-actions button')].some(
          (item) => (item.textContent ?? '').trim() === '新增評語'
        )`,
        6000
      )
      const addClicked = addButtonReady
        ? ((await win.webContents.executeJavaScript(
            `(() => {
              const button = [...document.querySelectorAll('.rv-card-head-actions button')]
                .find((item) => (item.textContent ?? '').trim() === '新增評語')
              button?.click()
              return Boolean(button)
            })()`
          )) as boolean)
        : false
      const formReady = addClicked
        ? await waitFor("document.querySelector('.rv-custom-form')", 5000)
        : false
      const formFieldsOk = formReady
        ? ((await win.webContents.executeJavaScript(
            `(() => {
              const form = document.querySelector('.rv-custom-form')
              return Boolean(
                form?.querySelector('select') &&
                form?.querySelector('textarea') &&
                form?.querySelector('input')
              )
            })()`
          )) as boolean)
        : false
      const categorySet = formReady
        ? await setSelectIndex('.rv-custom-form select', 0, 'comment')
        : false
      const subtypeReady = categorySet
        ? await waitFor("document.querySelectorAll('.rv-custom-form select').length >= 2", 4000)
        : false
      const subtypeSet = subtypeReady
        ? await setSelectIndex('.rv-custom-form select', 1, 'strength')
        : false
      const textSet = subtypeSet
        ? await setTextarea('.rv-custom-form textarea', customText)
        : false
      const tagsSet = textSet
        ? await setInput('.rv-custom-form input', customTags.join('、'))
        : false
      const saveClicked = tagsSet
        ? await clickTextButton('.rv-custom-form-actions', '儲存')
        : false
      const formClosed = saveClicked
        ? await waitFor("!document.querySelector('.rv-custom-form')", 6000)
        : false

      let createdCustom: {
        id: string
        text: string
        tags: string[]
        source: string
        category: string
        subtype: string
      } | null = null
      for (let i = 0; i < 25; i++) {
        createdCustom = (await win.webContents.executeJavaScript(
          `(async () => {
            const payload = await window.electronAPI.library.get(${JSON.stringify(classId)})
            const entry = payload.library.entries.find(
              (item) => item.text === ${JSON.stringify(customText)}
            )
            return entry
              ? {
                  id: entry.id,
                  text: entry.text,
                  tags: entry.tags,
                  source: entry.source,
                  category: entry.category,
                  subtype: entry.subtype
                }
              : null
          })()`
        )) as {
          id: string
          text: string
          tags: string[]
          source: string
          category: string
          subtype: string
        } | null
        if (createdCustom) break
        await delay(150)
      }
      const customItemReady = createdCustom
        ? await waitFor(`Boolean(${libraryItemExpr(createdCustom.id)})`, 6000)
        : false
      const customTagText = customItemReady
        ? ((await win.webContents.executeJavaScript(
            `(() => {
              const item = ${libraryItemExpr(createdCustom?.id ?? '')}
              return (item?.querySelector('.rv-lib-tag-custom')?.textContent ?? '').trim()
            })()`
          )) as string)
        : ''
      const createOk =
        addButtonReady &&
        formFieldsOk &&
        subtypeSet &&
        formClosed &&
        createdCustom !== null &&
        createdCustom.source === 'custom' &&
        createdCustom.id.startsWith('CUSTOM-') &&
        createdCustom.category === 'comment' &&
        createdCustom.subtype === 'strength' &&
        createdCustom.tags.join(',') === customTags.join(',') &&
        customItemReady &&
        customTagText === '自訂'
      customLibrary.createOk = createOk
      customLibrary.createDetail = createOk
        ? `管理模式有「新增評語」；表單可填類別／子類／文字／標籤，儲存後 library:get 出現 ${
            createdCustom?.id ?? '—'
          }（source custom、tags ${createdCustom?.tags.join('、') ?? '—'}）與「自訂」標籤`
        : `新增流程未完成（按鈕 ${addButtonReady ? '有' : '無'}、表單 ${formReady ? '有' : '無'}、欄位 ${
            formFieldsOk ? '完整' : '不足'
          }、建立 ${createdCustom ? createdCustom.id : '無'}、標籤「${customTagText || '無'}」）`

      // 編輯文字與標籤
      const editClicked = createdCustom
        ? ((await win.webContents.executeJavaScript(
            `(() => {
              const item = ${libraryItemExpr(createdCustom?.id ?? '')}
              const button = [...(item?.querySelectorAll('.rv-lib-edit') ?? [])]
                .find((candidate) => (candidate.textContent ?? '').trim() === '編輯')
              button?.click()
              return Boolean(button)
            })()`
          )) as boolean)
        : false
      const editFormReady = editClicked
        ? await waitFor("document.querySelector('.rv-custom-form')", 5000)
        : false
      const editTextSet = editFormReady
        ? await setTextarea('.rv-custom-form textarea', customTextEdited)
        : false
      const editTagsSet = editTextSet
        ? await setInput('.rv-custom-form input', customTagsEdited.join('、'))
        : false
      const editSaveClicked = editTagsSet
        ? await clickTextButton('.rv-custom-form-actions', '儲存')
        : false
      const editFormClosed = editSaveClicked
        ? await waitFor("!document.querySelector('.rv-custom-form')", 6000)
        : false
      let editedCustom: { text: string; tags: string[] } | null = null
      for (let i = 0; i < 25; i++) {
        editedCustom = (await win.webContents.executeJavaScript(
          `(async () => {
            const payload = await window.electronAPI.library.get(${JSON.stringify(classId)})
            const entry = payload.library.entries.find(
              (item) => item.id === ${JSON.stringify(createdCustom?.id ?? '')}
            )
            return entry ? { text: entry.text, tags: entry.tags } : null
          })()`
        )) as { text: string; tags: string[] } | null
        if (editedCustom?.text === customTextEdited) break
        await delay(150)
      }
      const editedItemReady = createdCustom
        ? await waitFor(
            `(${libraryItemExpr(createdCustom.id)}?.querySelector('.rv-lib-text')?.textContent ?? '')
              .includes(${JSON.stringify(customTextEdited)})`,
            6000
          )
        : false
      const editOk =
        editFormReady &&
        editFormClosed &&
        editedCustom?.text === customTextEdited &&
        editedCustom.tags.join(',') === customTagsEdited.join(',') &&
        editedItemReady
      customLibrary.editOk = editOk
      customLibrary.editDetail = editOk
        ? `編輯 ${createdCustom?.id ?? '—'} 後文字更新，tags ${editedCustom?.tags.join('、') ?? '—'}；重新讀取一致`
        : `編輯未生效（表單 ${editFormReady ? '有' : '無'}、文字 ${
            editedCustom?.text === customTextEdited ? '已更新' : '未更新'
          }、tags ${editedCustom?.tags.join('、') ?? '無'}）`

      // 錯誤訊息：comment 少於 30 字
      const errorAddClicked = await (async (): Promise<boolean> =>
        (await win.webContents.executeJavaScript(
          `(() => {
            const button = [...document.querySelectorAll('.rv-card-head-actions button')]
              .find((item) => (item.textContent ?? '').trim() === '新增評語')
            button?.click()
            return Boolean(button)
          })()`
        )) as boolean)()
      const errorFormReady = errorAddClicked
        ? await waitFor("document.querySelector('.rv-custom-form')", 5000)
        : false
      if (errorFormReady) {
        await setSelectIndex('.rv-custom-form select', 0, 'comment')
        await waitFor("document.querySelectorAll('.rv-custom-form select').length >= 2", 4000)
        await setTextarea('.rv-custom-form textarea', '太短了。')
        await clickTextButton('.rv-custom-form-actions', '儲存')
      }
      const errorShown = errorFormReady
        ? await waitFor(
            `(document.querySelector('.rv-custom-form .rv-warn')?.textContent ?? '').includes('30')`,
            6000
          )
        : false
      if (errorFormReady) await clickTextButton('.rv-custom-form-actions', '取消')
      const errorClosed = errorShown
        ? await waitFor("!document.querySelector('.rv-custom-form')", 4000)
        : false
      customLibrary.errorOk = errorShown && errorClosed
      customLibrary.errorDetail = customLibrary.errorOk
        ? 'comment 少於 30 字時表單顯示「至少需要 30 字」錯誤且不關閉，取消後可返回清單'
        : `錯誤訊息未正確顯示（表單 ${errorFormReady ? '有' : '無'}、訊息 ${
            errorShown ? '有' : '無'
          }、取消後 ${errorClosed ? '已關閉' : '未關閉'}）`

      // 重新載入後仍在
      await win.webContents.reload()
      const reloadedD11 = await enterReviewView()
      if (reloadedD11) {
        await setSelect('.rv-lib-category', 'comment')
        await setSelect('.rv-lib-sort', 'default')
      }
      const reloadedManage = await readLibraryManage()
      if (reloadedD11 && reloadedManage.pressed !== 'true') await clickLibraryManage()
      const persistedCustomItem = createdCustom && reloadedD11
        ? await waitFor(`Boolean(${libraryItemExpr(createdCustom.id)})`, 8000)
        : false
      const persistedCustomText = persistedCustomItem
        ? ((await win.webContents.executeJavaScript(
            `(${libraryItemExpr(createdCustom?.id ?? '')}?.querySelector('.rv-lib-text')?.textContent ?? '')`
          )) as string)
        : ''
      const persistOk =
        reloadedD11 &&
        persistedCustomItem &&
        persistedCustomText.includes(customTextEdited)
      customLibrary.persistOk = persistOk
      customLibrary.persistDetail = persistOk
        ? `重新載入並重進批閱後，${createdCustom?.id ?? '—'} 仍在清單且顯示編輯後文字`
        : `重新載入後自訂評語${persistedCustomItem ? '仍在' : '消失'}（文字 ${
            persistedCustomText ? '有' : '無'
          }）`

      // 停用／啟用自訂評語
      const customDisableClicked = createdCustom
        ? await clickLibraryItemButton(createdCustom.id, '停用')
        : false
      const customDisabled = customDisableClicked
        ? await waitFor(
            `(() => {
              const item = ${libraryItemExpr(createdCustom?.id ?? '')}
              return Boolean(item) &&
                item.classList.contains('rv-lib-disabled') &&
                (item.querySelector('.rv-lib-tag')?.textContent ?? '').trim() === '已停用' &&
                item.querySelector('.rv-lib-insert')?.disabled === true
            })()`,
            6000
          )
        : false
      const customDisabledApi = (await win.webContents.executeJavaScript(
        `(async () => {
          const payload = await window.electronAPI.library.get(${JSON.stringify(classId)})
          const entry = payload.library.entries.find(
            (item) => item.id === ${JSON.stringify(createdCustom?.id ?? '')}
          )
          return Boolean(entry?.disabled)
        })()`
      )) as boolean
      const customEnableClicked = customDisabled
        ? await clickLibraryItemButton(createdCustom?.id ?? '', '啟用')
        : false
      const customEnabled = customEnableClicked
        ? await waitFor(
            `(() => {
              const item = ${libraryItemExpr(createdCustom?.id ?? '')}
              return Boolean(item) &&
                !item.classList.contains('rv-lib-disabled') &&
                item.querySelector('.rv-lib-insert')?.disabled === false
            })()`,
            6000
          )
        : false
      customLibrary.toggleOk = customDisabled && customDisabledApi && customEnabled
      customLibrary.toggleDetail = customLibrary.toggleOk
        ? `自訂評語 ${createdCustom?.id ?? '—'} 可停用（payload disabled=true、插入停用）並重新啟用`
        : `自訂停用／啟用未生效（停用 ${customDisabled ? '成功' : '失敗'}、API ${
            customDisabledApi ? 'true' : 'false'
          }、啟用 ${customEnabled ? '成功' : '失敗'}）`

      // 插入：文字快照與 library_id、使用次數
      const originalWork = await win.webContents.executeJavaScript(
        `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
          assignmentId
        )}, '07')`
      )
      await win.webContents.executeJavaScript(
        "document.querySelector('.rv-final')?.focus()"
      )
      const insertClicked = createdCustom
        ? ((await win.webContents.executeJavaScript(
            `(() => {
              const item = ${libraryItemExpr(createdCustom?.id ?? '')}
              const button = item?.querySelector('.rv-lib-insert')
              button?.click()
              return Boolean(button)
            })()`
          )) as boolean)
        : false
      let insertedWork: {
        final_comment?: { text: string; library_id?: string }
      } | null = null
      if (insertClicked) {
        for (let i = 0; i < 30; i++) {
          insertedWork = (await win.webContents.executeJavaScript(
            `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
              assignmentId
            )}, '07')`
          )) as {
            final_comment?: { text: string; library_id?: string }
          } | null
          if (insertedWork?.final_comment?.library_id === createdCustom?.id) break
          await delay(200)
        }
      }
      const customUsage = (await win.webContents.executeJavaScript(
        `window.electronAPI.library.usage(${JSON.stringify(classId)}, ${JSON.stringify(
          assignmentId
        )})`
      )) as { current: Record<string, number>; overall: Record<string, number> }
      const insertOk =
        insertClicked &&
        insertedWork?.final_comment?.library_id === createdCustom?.id &&
        (insertedWork?.final_comment?.text ?? '').includes(customTextEdited) &&
        (customUsage.current[createdCustom?.id ?? ''] ?? 0) >= 1
      customLibrary.insertOk = insertOk
      customLibrary.insertDetail = insertOk
        ? `插入後 work 總評文字含自訂內容、library_id=${
            insertedWork?.final_comment?.library_id ?? '—'
          }；本批使用次數 ${customUsage.current[createdCustom?.id ?? ''] ?? 0}`
        : `插入或統計未生效（插入 ${insertClicked ? '已點' : '未點'}、library_id ${
            insertedWork?.final_comment?.library_id ?? '—'
          }、次數 ${customUsage.current[createdCustom?.id ?? ''] ?? 0}）`

      // IPC 驗證：空文字、短評語、非法類別／子類、重複文字、重複 id、非自訂 id
      const validation = (await win.webContents.executeJavaScript(
        `(async () => {
          const payload = await window.electronAPI.library.get(${JSON.stringify(classId)})
          const builtinId = ${JSON.stringify(usedCommentId)}
          const builtin = payload.library.entries.find((item) => item.id === builtinId)
          const idProbeText =
            '這是另一段全新的文字，用於確認 id 驗證不會因為重複文字而誤判，長度也超過三十字。'
          const attempts = [
            ['空文字', { category: 'comment', subtype: 'strength', text: '   ' }],
            ['comment <30', { category: 'comment', subtype: 'strength', text: '太短' }],
            ['非法類別', { category: 'bogus', text: '測試文字' }],
            ['非法子類', { category: 'sentence', subtype: 'bogus', text: '測試文字' }],
            ['與內建重複', { category: 'comment', subtype: 'strength', text: builtin?.text ?? '' }],
            [
              '與自訂重複',
              { category: 'comment', subtype: 'strength', text: ${JSON.stringify(customTextEdited)} }
            ],
            [
              '重複內建 id',
              {
                id: builtinId,
                category: 'comment',
                subtype: 'strength',
                text: idProbeText
              }
            ],
            [
              '非自訂 id 編輯',
              {
                id: 'CUSTOM-not-exist',
                category: 'comment',
                subtype: 'strength',
                text: idProbeText
              }
            ]
          ]
          const results = []
          for (const [label, input] of attempts) {
            try {
              await window.electronAPI.library.saveCustom({
                libraryId: 'senior',
                ...input
              })
              results.push(label + ':accepted')
            } catch (error) {
              results.push(label + ':rejected:' + (error?.message ?? String(error)))
            }
          }
          return results
        })()`
      )) as string[]
      const allRejected = validation.length === 8 && validation.every((item) => item.includes(':rejected'))
      customLibrary.validateOk = allRejected
      customLibrary.validateDetail = allRejected
        ? `8 種非法輸入皆被拒：${validation
            .map((item) => item.split(':')[0])
            .join('、')}`
        : `驗證未全數擋下：${validation.join('；')}`

      // 刪除前後的舊 work 快照
      const workBeforeDelete = await win.webContents.executeJavaScript(
        `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
          assignmentId
        )}, '07')`
      )
      await win.webContents.executeJavaScript(
        '(() => { window.confirm = () => true; return true })()'
      )
      const deleteClicked = createdCustom
        ? ((await win.webContents.executeJavaScript(
            `(() => {
              const item = ${libraryItemExpr(createdCustom?.id ?? '')}
              const button = [...(item?.querySelectorAll('.rv-lib-delete') ?? [])][0]
              button?.click()
              return Boolean(button)
            })()`
          )) as boolean)
        : false
      const deletedFromUi = createdCustom
        ? await waitFor(`!(${libraryItemExpr(createdCustom.id)})`, 6000)
        : false
      const deletedFromApi = (await win.webContents.executeJavaScript(
        `(async () => {
          const payload = await window.electronAPI.library.get(${JSON.stringify(classId)})
          return !payload.library.entries.some(
            (item) => item.id === ${JSON.stringify(createdCustom?.id ?? '')}
          )
        })()`
      )) as boolean
      const workAfterDelete = await win.webContents.executeJavaScript(
        `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
          assignmentId
        )}, '07')`
      )
      const snapshotAfterDeleteOk =
        workBeforeDelete?.final_comment?.text === workAfterDelete?.final_comment?.text &&
        workBeforeDelete?.final_comment?.library_id ===
          workAfterDelete?.final_comment?.library_id &&
        workAfterDelete?.final_comment?.library_id === createdCustom?.id
      const builtinDeleteMessage = (await win.webContents.executeJavaScript(
        `(async () => {
          try {
            await window.electronAPI.library.deleteCustom({
              libraryId: 'senior',
              id: ${JSON.stringify(usedCommentId)}
            })
            return 'accepted'
          } catch (error) {
            return error?.message ?? String(error)
          }
        })()`
      )) as string
      const builtinDeleteRejected =
        builtinDeleteMessage !== 'accepted' && builtinDeleteMessage.includes('停用')
      const deleteOk =
        deleteClicked &&
        deletedFromUi &&
        deletedFromApi &&
        snapshotAfterDeleteOk &&
        builtinDeleteRejected
      customLibrary.deleteOk = deleteOk
      customLibrary.deleteDetail = deleteOk
        ? `刪除後清單與 library:get 皆消失；內建 ${usedCommentId} 刪除被拒並提示改用停用；刪除前後舊 work 總評文字與 library_id 不變`
        : `刪除流程未完成（UI ${deletedFromUi ? '已消失' : '未消失'}、API ${
            deletedFromApi ? '已消失' : '仍存在'
          }、快照 ${snapshotAfterDeleteOk ? '不變' : '改變'}、內建刪除 ${
            builtinDeleteRejected ? '已拒' : builtinDeleteMessage
          }）`
      if (originalWork) {
        await win.webContents.executeJavaScript(
          `window.electronAPI.work.save(
            ${JSON.stringify(classId)},
            ${JSON.stringify(assignmentId)},
            '07',
            ${JSON.stringify(originalWork)}
          )`
        )
      }

      const manageCloseD11 = await readLibraryManage()
      if (manageCloseD11.pressed === 'true') await clickLibraryManage()
    }

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

    // ---- 快速給分：分項合計分配與複製上一份 ------------------------------
    let quickScoreOk = false
    let quickScoreDetail = '未執行'
    let quickCopyOk = false
    let quickCopyDetail = '未執行'
    if (reviewOk) {
      const quickReady = await waitFor("document.querySelector('.rv-quick-score')", 6000)
      const quickUi = quickReady
        ? ((await win.webContents.executeJavaScript(
            `(() => {
              const box = document.querySelector('.rv-quick-score')
              return {
                buttons: [...(box?.querySelectorAll('button') ?? [])].map(
                  (item) => (item.textContent ?? '').trim()
                ),
                hasTotal: Boolean(box?.querySelector('input[type="number"]')),
                rows: [...document.querySelectorAll('.rv-score-row')].slice(0, 4).map((row) => ({
                  name: (row.querySelector('.rv-score-name')?.textContent ?? '').trim(),
                  value: row.querySelector('input')?.value ?? ''
                })),
                hint: (box?.querySelector('.rv-quick-score-hint')?.textContent ?? '').trim()
              }
            })()`
          )) as {
            buttons: string[]
            hasTotal: boolean
            rows: { name: string; value: string }[]
            hint: string
          })
        : { buttons: [], hasTotal: false, rows: [] as { name: string; value: string }[], hint: '' }

      const readQuickRows = async (): Promise<{ items: number[]; override: string }> =>
        (await win.webContents.executeJavaScript(
          `(() => {
            const inputs = [...document.querySelectorAll('.rv-score-row input')]
            return {
              items: inputs.slice(0, 3).map((item) => Number(item.value || 0)),
              override: inputs[3]?.value ?? ''
            }
          })()`
        )) as { items: number[]; override: string }

      const quickOriginal = (await win.webContents.executeJavaScript(
        `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
          assignmentId
        )}, '07')`
      )) as WorkFile | null

      const quickFormOk =
        quickReady &&
        quickUi.hasTotal &&
        quickUi.buttons.includes('分配到三項') &&
        quickUi.buttons.includes('複製上一份') &&
        quickUi.rows.length === 4 &&
        quickUi.rows.slice(0, 3).every((row) => row.name.length > 0) &&
        quickUi.rows[3]?.name === '手動覆寫' &&
        quickUi.hint.includes('目前分項合計')

      const quickInputSet = quickFormOk
        ? await setInput('.rv-quick-score input', '81')
        : false
      const distributeClicked = quickInputSet
        ? await clickTextButton('.rv-quick-score-row', '分配到三項')
        : false
      const distributedUi = distributeClicked
        ? await waitFor(
            `(() => {
              const inputs = [...document.querySelectorAll('.rv-score-row input')].slice(0, 3)
              if (inputs.length < 3) return false
              const values = inputs.map((item) => Number(item.value || 0))
              return Math.abs(values.reduce((sum, value) => sum + value, 0) - 81) < 1e-9 &&
                values.every((value) => value >= 0 && Number.isInteger(value * 2))
            })()`,
            6000
          )
        : false
      const distributedRows = distributedUi
        ? await readQuickRows()
        : { items: [] as number[], override: '' }

      let persistedDistribute: WorkFile | null = null
      for (let i = 0; i < 30; i++) {
        persistedDistribute = (await win.webContents.executeJavaScript(
          `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
            assignmentId
          )}, '07')`
        )) as WorkFile | null
        const items = persistedDistribute?.scores?.items ?? {}
        const values = [items.content, items.structure, items.language]
        const saved =
          Object.keys(items).length === 3 &&
          values.every(
            (value, index) =>
              typeof value === 'number' &&
              Math.abs(value - (distributedRows.items[index] ?? Number.NaN)) < 1e-9
          )
        if (saved) break
        await delay(200)
      }
      const persistedItems = persistedDistribute?.scores?.items ?? {}
      const persistedValues = [
        persistedItems.content ?? Number.NaN,
        persistedItems.structure ?? Number.NaN,
        persistedItems.language ?? Number.NaN
      ]
      const distributedPersisted =
        persistedValues.every((value) => Number.isFinite(value)) &&
        Math.abs(persistedValues.reduce((sum, value) => sum + value, 0) - 81) < 1e-9 &&
        distributedRows.items.every(
          (value, index) => Math.abs(value - (persistedValues[index] ?? Number.NaN)) < 1e-9
        )
      quickScoreOk = quickFormOk && distributedUi && distributedPersisted
      quickScoreDetail = quickScoreOk
        ? `有「分項合計」輸入、分配到三項與複製上一份；輸入 81 → ${distributedRows.items.join(
            '/'
          )}（合計 81、0.5 步進），autosave 後 work.json 分項 ${persistedValues.join('/')}`
        : !quickReady
          ? '找不到快速給分區塊'
          : !quickFormOk
            ? `快速給分欄位不完整（按鈕 ${quickUi.buttons.join('／') || '無'}、列 ${
                quickUi.rows.length
              }）`
            : !quickInputSet
              ? '無法輸入分項合計'
              : !distributeClicked
                ? '找不到「分配到三項」按鈕'
                : !distributedUi
                  ? `分配後三項合計不是 81（${distributedRows.items.join('/') || '—'}）`
                  : `分配結果未寫入 work.json（${persistedValues.join('/')}）`

      // 複製上一份：S07 之前沒有作品，會往後找到已評分的 S08。
      const copyClicked = quickScoreOk
        ? await clickTextButton('.rv-quick-score-row', '複製上一份')
        : false
      const copyNotice = copyClicked
        ? await waitForText('已複製 S08 的分數', 6000)
        : false
      const copiedRows = copyClicked ? await readQuickRows() : { items: [] as number[], override: '' }

      let persistedCopy: WorkFile | null = null
      for (let i = 0; i < 30; i++) {
        persistedCopy = (await win.webContents.executeJavaScript(
          `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
            assignmentId
          )}, '07')`
        )) as WorkFile | null
        const items = persistedCopy?.scores?.items ?? {}
        if (
          items.content === 30 &&
          items.structure === 20 &&
          items.language === 25 &&
          persistedCopy?.scores?.deduction.override === 2
        ) {
          break
        }
        await delay(200)
      }
      const copiedItems = persistedCopy?.scores?.items ?? {}
      const copyPersistedOk =
        copiedItems.content === 30 &&
        copiedItems.structure === 20 &&
        copiedItems.language === 25 &&
        persistedCopy?.scores?.deduction.override === 2 &&
        persistedCopy?.scores?.total === 73
      const finalUnchanged =
        (persistedCopy?.final_comment?.text ?? '') ===
          (persistedDistribute?.final_comment?.text ?? '') &&
        (persistedCopy?.final_comment?.text ?? '').length > 0
      const annotationsUnchanged =
        (persistedCopy?.annotations ?? []).length ===
          (persistedDistribute?.annotations ?? []).length &&
        JSON.stringify(persistedCopy?.annotations ?? []) ===
          JSON.stringify(persistedDistribute?.annotations ?? [])
      quickCopyOk =
        copyClicked &&
        copyNotice &&
        copiedRows.items.join('/') === '30/20/25' &&
        copiedRows.override === '2' &&
        copyPersistedOk &&
        finalUnchanged &&
        annotationsUnchanged
      quickCopyDetail = quickCopyOk
        ? `複製 S08 → 分項 ${copiedRows.items.join('/')}、覆寫 ${
            copiedRows.override
          }（總分 ${persistedCopy?.scores?.total ?? '—'}）；總評與批注維持不變，autosave 已寫入`
        : !copyClicked
          ? '找不到「複製上一份」按鈕'
          : !copyNotice
            ? '未顯示已複製提示'
            : copiedRows.items.join('/') !== '30/20/25' || copiedRows.override !== '2'
              ? `畫面分數或覆寫不符（${copiedRows.items.join('/') || '—'}／${
                  copiedRows.override || '空'
                }）`
              : !copyPersistedOk
                ? `複製結果未寫入 work.json（${JSON.stringify(copiedItems)}、override ${
                    persistedCopy?.scores?.deduction.override ?? '—'
                  }）`
                : '複製後總評或批注被改寫'

      // 還原 S07，避免影響後續「既有分數不變」檢查。
      if (quickOriginal) {
        await delay(900)
        await win.webContents.executeJavaScript(
          `window.electronAPI.work.save(
            ${JSON.stringify(classId)},
            ${JSON.stringify(assignmentId)},
            '07',
            ${JSON.stringify(quickOriginal)}
          )`
        )
        await delay(700)
        const restored = (await win.webContents.executeJavaScript(
          `window.electronAPI.work.get(${JSON.stringify(classId)}, ${JSON.stringify(
            assignmentId
          )}, '07')`
        )) as WorkFile | null
        if (
          JSON.stringify(restored?.scores) !== JSON.stringify(quickOriginal.scores) ||
          JSON.stringify(restored?.annotations) !== JSON.stringify(quickOriginal.annotations)
        ) {
          await win.webContents.executeJavaScript(
            `window.electronAPI.work.save(
              ${JSON.stringify(classId)},
              ${JSON.stringify(assignmentId)},
              '07',
              ${JSON.stringify(quickOriginal)}
            )`
          )
        }
      }
    }

    const ok =
      reviewOk &&
      libraryIpcOk &&
      libraryUiOk &&
      workStableOk &&
      rubricEditorOk &&
      libraryTools.ipcOk &&
      libraryTools.sortUiOk &&
      libraryTools.persistOk &&
      libraryTools.rotationUiOk &&
      disabledLibrary.validateOk &&
      disabledLibrary.applyOk &&
      disabledLibrary.restoreOk &&
      disabledLibrary.scopeOk &&
      disabledLibrary.manageOk &&
      disabledLibrary.hideOk &&
      disabledLibrary.persistOk &&
      disabledLibrary.enableOk &&
      disabledLibrary.splitOk &&
      customLibrary.createOk &&
      customLibrary.editOk &&
      customLibrary.errorOk &&
      customLibrary.persistOk &&
      customLibrary.validateOk &&
      customLibrary.toggleOk &&
      customLibrary.insertOk &&
      customLibrary.deleteOk &&
      quickScoreOk &&
      quickCopyOk
    const detail = ok
      ? `主畫面、preload API、批閱介面（S07）、評語庫切換／排序／釘選／冷卻輪替／停用／自訂增刪改、快速給分與量規編輯器正常`
      : !reviewMounted
        ? '按鈕已點擊，但批閱介面未掛載'
        : !canvasReady
          ? '批閱介面已掛載，但畫布未載入頁面'
          : !reviewOk
            ? `批閱介面內容不完整（座號「${status}」）`
            : !libraryIpcOk
              ? `評語庫 IPC 結果不符（${libraryIpc.ids.join('→')}）`
              : !libraryUiOk
                ? `評語庫面板未就緒（${libraryUiDetail}）`
                : !workStableOk
                  ? '切換評語庫版本後 work 內容改變'
                  : !rubricEditorOk
                    ? `量規編輯器未就緒（${rubricEditorDetail}）`
                    : !libraryTools.ipcOk
                      ? `評語庫使用次數或偏好 IPC 不符（${libraryTools.ipcDetail}）`
                      : !libraryTools.sortUiOk
                        ? `評語庫排序或釘選未生效（${libraryTools.sortDetail}）`
                        : !libraryTools.persistOk
                          ? `重新載入後偏好未保留（${libraryTools.persistDetail}）`
                          : !libraryTools.rotationUiOk
                            ? `冷卻輪替 UI 未生效（${libraryTools.rotationDetail}）`
                            : !disabledLibrary.validateOk
                              ? `停用 IPC 驗證未生效（${disabledLibrary.validateDetail}）`
                              : !disabledLibrary.applyOk
                                ? `停用未套用到 payload（${disabledLibrary.applyDetail}）`
                                : !disabledLibrary.restoreOk
                                  ? `重新啟用未回原值（${disabledLibrary.restoreDetail}）`
                                  : !disabledLibrary.scopeOk
                                    ? `版本停用未分開（${disabledLibrary.scopeDetail}）`
                                    : !disabledLibrary.manageOk
                                      ? `停用管理切換未生效（${disabledLibrary.manageDetail}）`
                                      : !disabledLibrary.hideOk
                                        ? `停用條目未隱藏（${disabledLibrary.hideDetail}）`
                                        : !disabledLibrary.persistOk
                                          ? `停用狀態未保留（${disabledLibrary.persistDetail}）`
                                          : !disabledLibrary.enableOk
                                            ? `啟用後未恢復（${disabledLibrary.enableDetail}）`
                                            : !disabledLibrary.splitOk
                                              ? `版本停用清單未分開（${disabledLibrary.splitDetail}）`
                                              : !customLibrary.createOk
                                                ? `自訂評語新增未完成（${customLibrary.createDetail}）`
                                                : !customLibrary.editOk
                                                  ? `自訂評語編輯未完成（${customLibrary.editDetail}）`
                                                  : !customLibrary.errorOk
                                                    ? `自訂評語錯誤訊息未顯示（${customLibrary.errorDetail}）`
                                                    : !customLibrary.persistOk
                                                      ? `自訂評語重載後未保留（${customLibrary.persistDetail}）`
                                                      : !customLibrary.validateOk
                                                        ? `自訂評語驗證未生效（${customLibrary.validateDetail}）`
                                                        : !customLibrary.toggleOk
                                                          ? `自訂評語停用／啟用未生效（${customLibrary.toggleDetail}）`
                                                          : !customLibrary.insertOk
                                                            ? `自訂評語插入未生效（${customLibrary.insertDetail}）`
                                                            : !customLibrary.deleteOk
                                                              ? `自訂評語刪除未完成（${customLibrary.deleteDetail}）`
                                                              : !quickScoreOk
                                                                ? `快速給分未生效（${quickScoreDetail}）`
                                                                : `複製上一份未生效（${quickCopyDetail}）`

    return {
      ok,
      detail,
      libraryIpcOk,
      libraryUiOk,
      libraryDetail: `${libraryIpc.ids.join('→')}；${libraryUiDetail}`,
      workStableOk,
      libraryTools,
      disabledLibrary,
      customLibrary,
      quickScoreOk,
      quickScoreDetail,
      quickCopyOk,
      quickCopyDetail
    }
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

    // ---- 國中／高中職雙評語庫 ----------------------------------------------
    const libraryStats = (library: typeof SENIOR_LIBRARY): {
      total: number
      comment: number
      ok: boolean
    } => {
      const parsed = LibrarySchema.safeParse(library)
      return {
        total: library.entries.length,
        comment: library.entries.filter((entry) => entry.category === 'comment').length,
        ok: parsed.success
      }
    }
    const seniorStats = libraryStats(SENIOR_LIBRARY)
    const juniorStats = libraryStats(JUNIOR_LIBRARY)
    add(
      '兩套評語庫皆 138 條、comment 72 且 schema 通過',
      seniorStats.total === 138 &&
        seniorStats.comment === 72 &&
        juniorStats.total === 138 &&
        juniorStats.comment === 72 &&
        seniorStats.ok &&
        juniorStats.ok,
      `高中職 ${seniorStats.total}／${seniorStats.comment}（${SENIOR_LIBRARY.library_version}）、國中 ${juniorStats.total}／${juniorStats.comment}（${JUNIOR_LIBRARY.library_version}）`
    )

    const autoCases: [string, 'junior' | 'senior'][] = [
      ['junior', 'junior'],
      ['senior', 'senior'],
      ['vocational', 'senior']
    ]
    const autoOk = autoCases.every(([grade, expected]) => {
      const payload = libraryForGrade(grade)
      return payload.id === expected && payload.mode === 'auto' && payload.grade === grade
    })
    const overrideJunior = libraryForGrade('senior', 'junior')
    const overrideSenior = libraryForGrade('junior', 'senior')
    const overrideOk =
      overrideJunior.id === 'junior' &&
      overrideJunior.library.library_version === JUNIOR_LIBRARY.library_version &&
      overrideSenior.id === 'senior' &&
      overrideSenior.library.library_version === SENIOR_LIBRARY.library_version

    let invalidModeRejected = false
    try {
      libraryForGrade('senior', 'unknown' as LibraryMode)
    } catch {
      invalidModeRejected = true
    }

    add(
      'libraryForGrade 依學制與模式選庫',
      autoOk && overrideOk && invalidModeRejected,
      `auto：junior→${libraryForGrade('junior').id}、senior→${libraryForGrade(
        'senior'
      ).id}、vocational→${libraryForGrade('vocational').id}；手動覆寫 ${
        overrideJunior.id
      }／${overrideSenior.id}；非法模式${invalidModeRejected ? '已拒絕' : '未拒絕'}`
    )

    const autoVersions = [libraryForGrade('junior'), libraryForGrade('senior')].map(
      (payload) => `${payload.id}:${payload.library.library_version}`
    )
    add(
      'LibraryPayload 含 id／mode／grade／library_version',
      autoVersions.join(',') === `junior:${JUNIOR_LIBRARY.library_version},senior:${SENIOR_LIBRARY.library_version}`,
      autoVersions.join('、')
    )

    // ---- D13 排序純函式 ----------------------------------------------------
    const sortEntries: LibraryEntry[] = ['A', 'B', 'C', 'D', 'E'].map((id) => ({
      id,
      category: 'typo',
      subtype: 'general',
      text: id,
      tags: [],
      disabled: false,
      source: 'builtin'
    }))
    const sortUsage = {
      current: { A: 0, B: 1, C: 0, D: 2, E: 0 },
      overall: { A: 5, B: 2, C: 5, D: 3, E: 0 }
    }
    const idsOf = (items: LibraryEntry[]): string => items.map((item) => item.id).join(',')
    const defaultSorted = sortLibraryEntries(sortEntries, { sort: 'default', usage: sortUsage })
    const usageSorted = sortLibraryEntries(sortEntries, { sort: 'usage', usage: sortUsage })
    const unusedSorted = sortLibraryEntries(sortEntries, { sort: 'unused', usage: sortUsage })
    add(
      'sortLibraryEntries default／usage／unused 與同次數穩定',
      idsOf(defaultSorted) === 'A,B,C,D,E' &&
        idsOf(usageSorted) === 'A,C,D,B,E' &&
        idsOf(unusedSorted) === 'A,C,E,D,B' &&
        idsOf(sortEntries) === 'A,B,C,D,E',
      `預設 ${idsOf(defaultSorted)}；常用 ${idsOf(usageSorted)}；本批未用 ${idsOf(unusedSorted)}；來源未變`
    )

    const pinnedDefault = sortLibraryEntries(sortEntries, {
      sort: 'default',
      pins: ['D', 'C', 'Z'],
      usage: sortUsage
    })
    const pinnedUnused = sortLibraryEntries(sortEntries, {
      sort: 'unused',
      pins: ['B', 'Z'],
      usage: sortUsage
    })
    add(
      'sortLibraryEntries 釘選優先、釘選內依累計、未知 pin 忽略',
      idsOf(pinnedDefault) === 'C,D,A,B,E' && idsOf(pinnedUnused) === 'B,A,C,E,D',
      `釘選 D／C 預設 ${idsOf(pinnedDefault)}；釘選 B 本批未用 ${idsOf(pinnedUnused)}；未知 Z 已忽略`
    )

    // ---- D22 冷卻輪替純函式 ------------------------------------------------
    const fixedNowMs = Date.parse('2026-06-01T00:00:00.000Z')
    const fixedNow = '2026-06-01T00:00:00.000Z'
    const isoDaysAgo = (days: number): string =>
      new Date(fixedNowMs - days * 86_400_000).toISOString()
    const rotationEntries: LibraryEntry[] = ['A', 'B', 'C', 'D', 'E'].map((id) => ({
      id,
      category: 'typo',
      subtype: 'general',
      text: id,
      tags: [],
      disabled: false,
      source: 'builtin'
    }))
    const rotationLastUsed = {
      B: isoDaysAgo(40),
      C: isoDaysAgo(5),
      D: isoDaysAgo(20),
      E: isoDaysAgo(31)
    }
    const rotationOverall = { A: 5, B: 2, C: 5, D: 3, E: 0 }
    const rotationSorted = sortLibraryEntries(rotationEntries, {
      sort: 'rotation',
      usage: { overall: rotationOverall },
      lastUsed: rotationLastUsed,
      cooldownDays: 30,
      now: fixedNow
    })
    add(
      'sortLibraryEntries rotation：冷卻群（從未最前→舊到新）在近期群前',
      idsOf(rotationSorted) === 'A,B,E,D,C',
      `冷卻群 A→B→E、近期群 D→C，總序 ${idsOf(rotationSorted)}`
    )

    const rotationPinned = sortLibraryEntries(rotationEntries, {
      sort: 'rotation',
      pins: ['D', 'C', 'Z'],
      usage: { overall: rotationOverall },
      lastUsed: rotationLastUsed,
      cooldownDays: 30,
      now: fixedNow
    })
    add(
      'sortLibraryEntries rotation 釘選仍最前、未知 pin 忽略',
      idsOf(rotationPinned) === 'C,D,A,B,E',
      `釘選 C／D 依累計在前，其餘 ${idsOf(rotationPinned)}`
    )

    // 同時間：依 overall 由少到多，再依原順序。
    const sameTimeEntries: LibraryEntry[] = ['X', 'Y', 'Z'].map((id) => ({
      id,
      category: 'typo',
      subtype: 'general',
      text: id,
      tags: [],
      disabled: false,
      source: 'builtin'
    }))
    const sameTimeLastUsed = {
      X: isoDaysAgo(40),
      Y: isoDaysAgo(40),
      Z: isoDaysAgo(40)
    }
    const sameTimeOverall = { X: 3, Y: 1, Z: 3 }
    const sameTimeSorted = sortLibraryEntries(sameTimeEntries, {
      sort: 'rotation',
      usage: { overall: sameTimeOverall },
      lastUsed: sameTimeLastUsed,
      cooldownDays: 30,
      now: fixedNow
    })
    add(
      'sortLibraryEntries rotation 同時間依 overall 少到多、再依原順序',
      idsOf(sameTimeSorted) === 'Y,X,Z',
      `同時 40 天前，累計 Y=1→X=3→Z=3，總序 ${idsOf(sameTimeSorted)}`
    )

    const rotationDaysOk =
      normalizeCooldownDays(1) === 1 &&
      normalizeCooldownDays(365) === 365 &&
      normalizeCooldownDays(0) === DEFAULT_COOLDOWN_DAYS &&
      normalizeCooldownDays(-1) === DEFAULT_COOLDOWN_DAYS &&
      normalizeCooldownDays(366) === DEFAULT_COOLDOWN_DAYS &&
      normalizeCooldownDays(3.5) === DEFAULT_COOLDOWN_DAYS &&
      normalizeCooldownDays('30') === DEFAULT_COOLDOWN_DAYS &&
      normalizeCooldownDays(null) === DEFAULT_COOLDOWN_DAYS &&
      normalizeCooldownDays(undefined) === DEFAULT_COOLDOWN_DAYS &&
      isCooldownDays(30) &&
      !isCooldownDays(0) &&
      !isCooldownDays(366)
    add(
      'cooldownDays 邊界：1／365 合法，非法值回 30',
      rotationDaysOk,
      `1→${normalizeCooldownDays(1)}、365→${normalizeCooldownDays(365)}、0→${normalizeCooldownDays(
        0
      )}、366→${normalizeCooldownDays(366)}、3.5→${normalizeCooldownDays(3.5)}`
    )

    // 無效時間視為從未使用：N 無效時間、M 2 天前。
    const invalidTimeEntries: LibraryEntry[] = ['N', 'M'].map((id) => ({
      id,
      category: 'typo',
      subtype: 'general',
      text: id,
      tags: [],
      disabled: false,
      source: 'builtin'
    }))
    const invalidTimeLastUsed = { N: 'not-a-date', M: isoDaysAgo(2) }
    const invalidTimeSorted = sortLibraryEntries(invalidTimeEntries, {
      sort: 'rotation',
      usage: { overall: { N: 0, M: 0 } },
      lastUsed: invalidTimeLastUsed,
      cooldownDays: 30,
      now: fixedNow
    })
    add(
      'sortLibraryEntries rotation 無效時間視為從未使用',
      idsOf(invalidTimeSorted) === 'N,M',
      `N 無效時間視為未用排前，總序 ${idsOf(invalidTimeSorted)}`
    )

    // ---- D23 停用純函式 ----------------------------------------------------
    const disableBase = libraryForGrade('senior')
    const disableTargets = disableBase.library.entries.slice(0, 2).map((entry) => entry.id)
    const disabledPayload = applyLibraryDisabled(disableBase, [
      ...disableTargets,
      disableTargets[0],
      '',
      42 as unknown as string
    ])
    const disabledEntries = disabledPayload.library.entries.filter((entry) => entry.disabled)
    const reEnabledPayload = applyLibraryDisabled(disableBase, [])
    const disablePureOk =
      disabledPayload.library.entries.length === disableBase.library.entries.length &&
      disabledEntries.length === 2 &&
      disabledEntries.every((entry) => disableTargets.includes(entry.id)) &&
      disabledPayload.library.entries.every((entry) =>
        disableTargets.includes(entry.id) ? entry.disabled : !entry.disabled
      ) &&
      SENIOR_LIBRARY.entries.every((entry) => !entry.disabled) &&
      reEnabledPayload.library.entries.every(
        (entry) => entry.disabled === disableBase.library.entries.find((base) => base.id === entry.id)?.disabled
      ) &&
      applyLibraryDisabled(libraryForGrade('junior'), disableTargets).library.entries.every(
        (entry) => !entry.disabled
      )
    add(
      'applyLibraryDisabled 保留條目、去重並可還原',
      disablePureOk,
      `停用 ${disableTargets.join('、')}（重複與非字串忽略）→ payload 仍 ${
        disabledPayload.library.entries.length
      } 條、停用 ${disabledEntries.length} 條；來源未變；清空清單後回到內建 disabled 值`
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

    // ---- distributeScore（快速給分） -------------------------------------
    const balanced = RUBRIC_PRESETS.balanced
    const balancedMaxes = balanced.items.map((item) => item.max)
    const balancedIds = balanced.items.map((item) => item.id)
    const valuesOf = (total: number, rubric = balanced): number[] => {
      const distributed = distributeScore(total, rubric)
      return balancedIds.map((id) => distributed[id] ?? Number.NaN)
    }
    const sumOf = (values: number[]): number => values.reduce((sum, value) => sum + value, 0)
    const withinMaxes = (values: number[], maxes = balancedMaxes): boolean =>
      values.every(
        (value, index) =>
          Number.isFinite(value) &&
          value >= 0 &&
          value <= (maxes[index] ?? 0) &&
          Number.isInteger(value * 2)
      )

    const at81 = valuesOf(81)
    const at100 = valuesOf(100)
    const at0 = valuesOf(0)
    add(
      'distributeScore 40/30/30、81 與 100／0 邊界',
      sumOf(at81) === 81 &&
        withinMaxes(at81) &&
        at81.join('/') === '32/24/25' &&
        at100.join('/') === '40/30/30' &&
        at0.join('/') === '0/0/0',
      `81 → ${at81.join('/')}（合計 ${sumOf(at81)}）；100 → ${at100.join('/')}；0 → ${at0.join(
        '/'
      )}`
    )

    const at50 = valuesOf(50)
    const at785 = valuesOf(78.5)
    const atOver = valuesOf(150)
    const emptyRubric = { ...balanced, items: [] }
    const zeroMaxRubric = {
      ...balanced,
      items: balanced.items.map((item) => ({ ...item, max: 0 }))
    }
    const empty = distributeScore(80, emptyRubric)
    const zeroMax = distributeScore(80, zeroMaxRubric)
    const negative = valuesOf(-10)
    const invalid = valuesOf(Number.NaN)
    const zeroMaxAllZero = balancedIds.every((id) => zeroMax[id] === 0)
    add(
      'distributeScore 50／78.5／超過 100／空量規／max<=0／負數',
      sumOf(at50) === 50 &&
        withinMaxes(at50) &&
        sumOf(at785) === 78.5 &&
        withinMaxes(at785) &&
        atOver.join('/') === '40/30/30' &&
        Object.keys(empty).length === 0 &&
        zeroMaxAllZero &&
        negative.join('/') === '0/0/0' &&
        invalid.join('/') === '0/0/0',
      `50 → ${at50.join('/')}；78.5 → ${at785.join('/')}；150 → ${atOver.join(
        '/'
      )}；空量規 ${Object.keys(empty).length} 項；max 0 全 0；−10／NaN 全 0`
    )

    const overflowRubric = {
      ...balanced,
      items: [
        { id: 'a', name: 'A', max: 8 },
        { id: 'b', name: 'B', max: 8 },
        { id: 'c', name: 'C', max: 2 }
      ]
    }
    const overflow = distributeScore(17.5, overflowRubric)
    add(
      'distributeScore 最後一項滿分時多餘分回推',
      overflow.c === 2 &&
        overflow.a === 7.5 &&
        overflow.b === 8 &&
        overflow.a + overflow.b + overflow.c === 17.5,
      `8/8/2 配 17.5 → ${overflow.a}/${overflow.b}/${overflow.c}（最後一項補滿 2，0.5 分回推到 B）`
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
    const sentenceLibraryId =
      SENIOR_LIBRARY.entries.find(
        (entry) => !entry.disabled && entry.category === 'sentence'
      )?.id ?? 'S-01'
    const commentEntries = SENIOR_LIBRARY.entries.filter(
      (entry) => !entry.disabled && entry.category === 'comment'
    )
    const defaultCommentId = commentEntries[0]?.id ?? 'C-01'
    const usedCommentId = commentEntries[4]?.id ?? defaultCommentId
    const otherCommentId = commentEntries[5]?.id ?? usedCommentId
    const juniorCommentId =
      JUNIOR_LIBRARY.entries.find(
        (entry) => !entry.disabled && entry.category === 'comment'
      )?.id ?? 'JC-01'
    const baseWork: WorkFile = {
      schema_version: 1,
      class_id: created.id,
      assignment_id: assignment.id,
      seat: '07',
      name: '王小明',
      status: 'grading',
      pages: [{ id: 'p1', file: 'p1.jpg', width: 800, height: 1100 }],
      annotations: [],
      final_comment: {
        text: validFinal,
        library_id: usedCommentId,
        library_version: SENIOR_LIBRARY.library_version
      },
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
      library_id: sentenceLibraryId,
      library_version: SENIOR_LIBRARY.library_version,
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

    // ---- D13 使用次數：同作業兩份、另一份作業各放 library_id -------------
    const s08Final =
      '這篇作品以清楚的順序描寫事件，細節具體，讀者能理解經過；若補上結尾的感受，會更完整。'
    const usageWork08: WorkFile = {
      ...baseWork,
      seat: '08',
      name: '陳怡君',
      annotations: [
        { ...d25, id: 'usage-08-1', anchor: { x: 0.21, y: 0.33 } },
        { ...d25, id: 'usage-08-2', anchor: { x: 0.45, y: 0.52 } }
      ],
      final_comment: {
        text: s08Final,
        library_id: usedCommentId,
        library_version: SENIOR_LIBRARY.library_version
      },
      // 與 S07 不同的分數與手動覆寫，供「複製上一份」UI 測試辨識。
      scores: {
        items: { content: 30, structure: 20, language: 25 },
        deduction: { typo: 0, punct: 0, override: 2 },
        total: 73,
        grade: 'B'
      },
      updated_at: now()
    }
    await saveWork(created.id, assignment.id, '08', usageWork08)

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

    const otherAssignmentWork: WorkFile = {
      ...baseWork,
      assignment_id: gradeAssignment.id,
      annotations: [{ ...d25, id: 'usage-other-1', anchor: { x: 0.31, y: 0.42 } }],
      final_comment: {
        text: '這份作業的總評用於跨作業累計測試，文字與目前作業不同，仍保留完整句子與具體建議。',
        library_id: otherCommentId,
        library_version: SENIOR_LIBRARY.library_version
      },
      updated_at: now()
    }
    await saveWork(created.id, gradeAssignment.id, '07', otherAssignmentWork)

    const usage = await getLibraryUsage(created.id, assignment.id)
    const s07Path = join(root, created.id, assignment.id, 'S07', 'work.json')
    const s07Before = await readFile(s07Path, 'utf8')
    const usageAgain = await getLibraryUsage(created.id, assignment.id)
    const s07After = await readFile(s07Path, 'utf8')
    const usageOk =
      usage.current[sentenceLibraryId] === 3 &&
      usage.current[usedCommentId] === 2 &&
      !usage.current[otherCommentId] &&
      usage.overall[sentenceLibraryId] === 4 &&
      usage.overall[usedCommentId] === 2 &&
      usage.overall[otherCommentId] === 1

    const corruptDir = join(root, created.id, assignment.id, 'S09')
    await mkdir(corruptDir, { recursive: true })
    await writeFile(join(corruptDir, 'work.json'), '{ 壞掉的 JSON', 'utf8')
    const usageWithCorrupt = await getLibraryUsage(created.id, assignment.id)
    await rm(corruptDir, { recursive: true, force: true })
    const corruptOk =
      usageWithCorrupt.current[sentenceLibraryId] === usageAgain.current[sentenceLibraryId] &&
      usageWithCorrupt.overall[usedCommentId] === usageAgain.overall[usedCommentId]

    add(
      'getLibraryUsage 本批／累計計數與損壞檔略過（只讀）',
      usageOk && corruptOk && s07Before === s07After,
      `本批 sentence ${usage.current[sentenceLibraryId] ?? 0}、comment ${
        usage.current[usedCommentId] ?? 0
      }；累計 sentence ${usage.overall[sentenceLibraryId] ?? 0}、comment ${
        usage.overall[usedCommentId] ?? 0
      }、其他作業 ${usage.overall[otherCommentId] ?? 0}；${
        corruptOk ? '損壞 work.json 已略過' : '損壞檔影響統計'
      }；work.json ${s07Before === s07After ? '未變動' : '被改寫'}`
    )

    // ---- D22 getLibraryUsage 最後使用時間 ----------------------------------
    const s10Dir = join(root, created.id, assignment.id, 'S10')
    await mkdir(s10Dir, { recursive: true })
    const s10Work: WorkFile = {
      ...baseWork,
      seat: '10',
      name: '林曉華',
      annotations: [
        {
          ...d25,
          id: 'usage-10-1',
          anchor: { x: 0.11, y: 0.22 },
          created_at: '2020-01-01T00:00:00.000Z'
        },
        {
          ...d25,
          id: 'usage-10-invalid',
          anchor: { x: 0.33, y: 0.44 },
          library_id: defaultCommentId,
          created_at: 'not-a-date'
        }
      ],
      final_comment: {
        text: '這份作品的總評用於最後使用時間測試，句子完整、字數充足，與其他作品內容不同。',
        library_id: usedCommentId,
        library_version: SENIOR_LIBRARY.library_version
      },
      updated_at: '2020-01-01T00:00:00.000Z'
    }
    await saveWork(created.id, assignment.id, '10', s10Work)
    const usageWithTimes = await getLibraryUsage(created.id, assignment.id)
    await rm(s10Dir, { recursive: true, force: true })

    const lastUsedOk =
      usageWithTimes.current[sentenceLibraryId] === 4 &&
      usageWithTimes.current[usedCommentId] === 3 &&
      usageWithTimes.current[defaultCommentId] === 1 &&
      usageWithTimes.currentLastUsed[sentenceLibraryId] === d25.created_at &&
      Date.parse(usageWithTimes.currentLastUsed[usedCommentId]) ===
        Date.parse(usageWork08.updated_at) &&
      usageWithTimes.currentLastUsed[defaultCommentId] === undefined &&
      usageWithTimes.overallLastUsed[otherCommentId] === otherAssignmentWork.updated_at &&
      usageWithTimes.currentLastUsed[otherCommentId] === undefined
    add(
      'getLibraryUsage 最後使用時間（created_at／updated_at、max、current／overall 分開）',
      lastUsedOk,
      `sentence 本批 4 次、上次 ${usageWithTimes.currentLastUsed[sentenceLibraryId]?.slice(
        0,
        10
      ) ?? '—'}；comment 本批 3 次、上次 ${usageWithTimes.currentLastUsed[usedCommentId]?.slice(
        0,
        10
      ) ?? '—'}；otherCommentId 只進 overall（${
        usageWithTimes.overallLastUsed[otherCommentId]?.slice(0, 10) ?? '—'
      }）`
    )

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

    // ---- D13 偏好設定：寫入、重讀、非法值與去重 --------------------------
    const prefsBefore = await readLibraryPrefs()
    await writeSettings({
      librarySort: 'usage',
      libraryPins: ['E-01', 'E-01', 'E-02', '', 42, null] as unknown as string[]
    })
    const prefsSaved = await readLibraryPrefs()
    await writeSettings({ librarySort: 'bogus' as LibrarySort })
    const prefsFallback = await readLibraryPrefs()
    let invalidPrefsRejected = false
    try {
      await writeLibraryPrefs({ sort: 'bogus' })
    } catch {
      invalidPrefsRejected = true
    }
    const prefsOk =
      prefsSaved.sort === 'usage' &&
      prefsSaved.pins.join(',') === 'E-01,E-02' &&
      prefsFallback.sort === 'default' &&
      prefsFallback.pins.join(',') === 'E-01,E-02' &&
      invalidPrefsRejected
    add(
      'settings 評語庫 sort／pins 寫入、去重與非法值回預設',
      prefsOk,
      `寫入 usage／E-01,E-01,E-02 → ${prefsSaved.sort}／${prefsSaved.pins.join(
        ','
      )}；非法排序 → ${prefsFallback.sort}（pins 保留 ${prefsFallback.pins.join(
        ','
      )}）；寫入驗證${invalidPrefsRejected ? '已拒絕非法值' : '未拒絕非法值'}`
    )

    // ---- D22 偏好設定：cooldownDays 寫入、重讀、非法值 --------------------
    await writeSettings({ libraryCooldownDays: 45 })
    const cooldownSaved = await readLibraryPrefs()
    await writeSettings({ libraryCooldownDays: 0 })
    const cooldownFallback = await readLibraryPrefs()
    let invalidCooldownRejected = false
    try {
      await writeLibraryPrefs({ cooldownDays: 0 })
    } catch {
      invalidCooldownRejected = true
    }
    const cooldownPrefsOk =
      cooldownSaved.cooldownDays === 45 &&
      cooldownFallback.cooldownDays === DEFAULT_COOLDOWN_DAYS &&
      invalidCooldownRejected
    add(
      'settings libraryCooldownDays 寫入、重讀與非法值回 30',
      cooldownPrefsOk,
      `寫入 45 → ${cooldownSaved.cooldownDays}；非法 0 → ${cooldownFallback.cooldownDays}；寫入驗證${
        invalidCooldownRejected ? '已拒絕非法值' : '未拒絕非法值'
      }`
    )
    await writeSettings({ libraryCooldownDays: 30 })

    // ---- D23 停用清單：預設、寫入、重讀、去重與非法值 ---------------------
    const disabledBefore = {
      junior: await readLibraryDisabled('junior'),
      senior: await readLibraryDisabled('senior')
    }
    const disabledDefault = normalizeLibraryDisabled(undefined)
    const disabledDefaultPartial = normalizeLibraryDisabled({
      junior: ['JC-01', 'JC-01', '', 7, null],
      senior: 'not-an-array'
    })
    const disabledDefaultOk =
      disabledDefault.junior.length === 0 &&
      disabledDefault.senior.length === 0 &&
      normalizeLibraryDisabled({}).junior.length === 0 &&
      normalizeLibraryDisabled({}).senior.length === 0 &&
      normalizeLibraryDisabled(null).junior.length === 0 &&
      normalizeLibraryDisabled([] as unknown).senior.length === 0 &&
      disabledDefaultPartial.junior.join(',') === 'JC-01' &&
      disabledDefaultPartial.senior.length === 0
    add(
      'settings libraryDisabled 預設兩版本皆空陣列',
      disabledDefaultOk,
      `undefined／null／空物件／陣列 → junior 0、senior 0；部分非法只留 JC-01`
    )

    await writeSettings({
      libraryDisabled: {
        junior: ['JC-01', 'JC-01', '', 42, null],
        senior: ['C-01', 'C-01', '  ', 'C-05']
      } as unknown as Settings['libraryDisabled']
    })
    const disabledSaved = await readSettings()
    await writeLibraryDisabled('senior', ['C-05', 'C-05', '', 7 as unknown as string])
    const disabledViaApi = await readLibraryDisabled('senior')
    const disabledJuniorAfterApi = await readLibraryDisabled('junior')
    const disabledSettingsOk =
      disabledSaved.libraryDisabled?.junior.join(',') === 'JC-01' &&
      disabledSaved.libraryDisabled?.senior.join(',') === 'C-01,C-05' &&
      disabledViaApi.join(',') === 'C-05' &&
      disabledJuniorAfterApi.join(',') === 'JC-01'
    add(
      'settings libraryDisabled 寫入、重讀、去重與版本分開',
      disabledSettingsOk,
      `寫入重複與非字串 → junior ${disabledSaved.libraryDisabled?.junior.join(',')}、senior ${
        disabledSaved.libraryDisabled?.senior.join(',')
      }；只改 senior 後 junior 仍 ${disabledJuniorAfterApi.join(',') || '空'}`
    )
    await writeSettings({ libraryDisabled: disabledBefore })

    await writeLibraryPrefs({ sort: 'default', pins: [] })

    // ---- D11 自訂評語：檔案、驗證、持久化、使用次數與舊快照 --------------
    const customEntry: LibraryEntry = {
      id: 'CUSTOM-D11-1',
      category: 'typo',
      subtype: 'general',
      text: 'D11 自訂錯字測試，文字獨一無二。',
      tags: ['測試', '自訂'],
      disabled: false,
      source: 'custom'
    }
    const customFile = join(root, '_library', 'senior.json')

    let customFileOk = false
    let customFileDetail = ''
    try {
      await writeCustomEntries('senior', [customEntry])
      const fileStat = await stat(customFile)
      const rawFile = JSON.parse(await readFile(customFile, 'utf8')) as {
        schema_version?: number
        library_id?: string
        entries?: LibraryEntry[]
      }
      const readBack = await readCustomEntries('senior')
      const merged = mergeLibraryEntries(SENIOR_LIBRARY.entries, readBack)
      customFileOk =
        fileStat.isFile() &&
        rawFile.schema_version === 1 &&
        rawFile.library_id === 'senior' &&
        rawFile.entries?.length === 1 &&
        readBack.length === 1 &&
        readBack[0].id === customEntry.id &&
        readBack[0].source === 'custom' &&
        readBack[0].tags.join(',') === '測試,自訂' &&
        merged.length === SENIOR_LIBRARY.entries.length + 1 &&
        merged[merged.length - 1].id === customEntry.id
      customFileDetail = customFileOk
        ? `寫入 ${customFile}（schema 1、library_id senior、1 條）；讀回 source custom，合併後 ${
            merged.length
          } 條`
        : `自訂檔案內容不符（存在 ${fileStat.isFile() ? '是' : '否'}、讀回 ${
            readBack.length
          } 條、合併 ${merged.length} 條）`
    } catch (error) {
      customFileDetail = `自訂檔案測試失敗：${message(error)}`
    }
    add('自訂評語寫入 _library 並可合併內建庫', customFileOk, customFileDetail)

    const invalidCustomCases: [string, string[]][] = [
      [
        '空文字',
        validateCustomLibraryEntry(
          { category: 'typo', subtype: 'general', text: '   ' },
          [customEntry]
        )
      ],
      [
        'comment <30',
        validateCustomLibraryEntry(
          { category: 'comment', subtype: 'strength', text: '太短了。' },
          [customEntry]
        )
      ],
      [
        '非法類別',
        validateCustomLibraryEntry(
          { category: 'bogus', text: '測試文字' },
          [customEntry]
        )
      ],
      [
        '非法子類',
        validateCustomLibraryEntry(
          { category: 'sentence', subtype: 'bogus', text: '測試文字' },
          [customEntry]
        )
      ],
      [
        '與內建重複',
        validateCustomLibraryEntry(
          {
            category: 'typo',
            subtype: 'general',
            text: SENIOR_LIBRARY.entries[0]?.text ?? ''
          },
          [...SENIOR_LIBRARY.entries, customEntry]
        )
      ],
      [
        '與自訂重複',
        validateCustomLibraryEntry(
          { category: 'typo', subtype: 'general', text: customEntry.text },
          [...SENIOR_LIBRARY.entries, customEntry]
        )
      ]
    ]
    const invalidAllRejected = invalidCustomCases.every(([, errors]) => errors.length > 0)
    const validCustomPassed =
      validateCustomLibraryEntry(
        { category: 'typo', subtype: 'general', text: '全新且不重複的自訂文字。' },
        [customEntry]
      ).length === 0
    const tagsNormalized =
      normalizeCustomTags([' 測試 ', '測試', '', '自訂', 7 as unknown as string]).join(',') ===
      '測試,自訂'
    const customValidateOk = invalidAllRejected && validCustomPassed && tagsNormalized
    add(
      'validateCustomLibraryEntry 擋空文字、短評語、非法類別／子類與重複文字',
      customValidateOk,
      customValidateOk
        ? `6 種非法輸入皆被拒（${invalidCustomCases
            .map(([label]) => label)
            .join('、')}）；合法輸入通過；tags 去重去空白`
        : `驗證不符（非法 ${invalidCustomCases
            .filter(([, errors]) => errors.length === 0)
            .map(([label]) => label)
            .join('、') || '全拒'}、合法 ${validCustomPassed ? '通過' : '被拒'}、tags ${
            tagsNormalized ? '正常' : '異常'
          }）`
    )

    let duplicateIdRejected = false
    let duplicateIdDetail = ''
    try {
      const rawBeforeDuplicate = await readFile(customFile, 'utf8')
      try {
        await writeCustomEntries('senior', [customEntry, { ...customEntry }])
      } catch {
        duplicateIdRejected = true
      }
      const rawAfterDuplicate = await readFile(customFile, 'utf8')
      duplicateIdDetail = duplicateIdRejected
        ? rawBeforeDuplicate === rawAfterDuplicate
          ? '重複 id 寫入被拒，既有檔案未被改寫'
          : '重複 id 被拒但檔案被改寫'
        : '重複 id 未被拒絕'
    } catch (error) {
      duplicateIdDetail = `重複 id 測試失敗：${message(error)}`
    }
    add(
      '自訂評語重複 id 寫入被拒',
      duplicateIdRejected && duplicateIdDetail.includes('未被改寫'),
      duplicateIdDetail
    )

    let customPersistOk = false
    let customPersistDetail = ''
    try {
      await closeDatabase()
      await openDatabase(root, { remember: false })
      const persisted = await readCustomEntries('senior')
      const fileStat = await stat(customFile)
      customPersistOk =
        fileStat.isFile() &&
        persisted.length === 1 &&
        persisted[0]?.id === customEntry.id &&
        persisted[0]?.source === 'custom'
      customPersistDetail = customPersistOk
        ? `關閉再重開資料庫後，${customFile} 仍存在且讀回 ${customEntry.id}`
        : `重開後未保留（檔案 ${fileStat.isFile() ? '在' : '不在'}、讀回 ${
            persisted.length
          } 條）`
    } catch (error) {
      customPersistDetail = `重開資料庫測試失敗：${message(error)}`
    }
    add('自訂評語關閉重開資料庫後仍存在', customPersistOk, customPersistDetail)

    let customUsageSnapshotOk = false
    let customUsageSnapshotDetail = ''
    try {
      await writeCustomEntries('senior', [customEntry])
      const customWork: WorkFile = {
        ...baseWork,
        seat: '11',
        name: '自訂測試',
        annotations: [],
        final_comment: {
          text: customEntry.text,
          library_id: customEntry.id,
          library_version: SENIOR_LIBRARY.library_version
        },
        updated_at: now()
      }
      await saveWork(created.id, assignment.id, '11', customWork)
      const customUsage = await getLibraryUsage(created.id, assignment.id)
      const customSeatDir = join(root, created.id, assignment.id, 'S11')
      const customWorkPath = join(customSeatDir, 'work.json')
      const rawBeforeDelete = await readFile(customWorkPath, 'utf8')
      await writeCustomEntries('senior', [])
      const afterDelete = await readCustomEntries('senior')
      const rawAfterDelete = await readFile(customWorkPath, 'utf8')
      const loadedCustomWork = await loadWork(created.id, assignment.id, '11')
      customUsageSnapshotOk =
        (customUsage.current[customEntry.id] ?? 0) === 1 &&
        afterDelete.length === 0 &&
        rawBeforeDelete === rawAfterDelete &&
        loadedCustomWork.final_comment?.text === customEntry.text &&
        loadedCustomWork.final_comment?.library_id === customEntry.id
      customUsageSnapshotDetail = customUsageSnapshotOk
        ? `本批使用次數 1；刪除自訂後 work.json 位元組不變，總評文字與 library_id ${customEntry.id} 保留`
        : `使用次數或快照不符（次數 ${
            customUsage.current[customEntry.id] ?? 0
          }、剩餘 ${afterDelete.length} 條、位元組${
            rawBeforeDelete === rawAfterDelete ? '相同' : '不同'
          }、id ${loadedCustomWork.final_comment?.library_id ?? '—'}）`
      await rm(customSeatDir, { recursive: true, force: true })
    } catch (error) {
      customUsageSnapshotDetail = `使用次數與快照測試失敗：${message(error)}`
    }
    add(
      '自訂評語可計入使用次數且刪除後舊 work 快照不變',
      customUsageSnapshotOk,
      customUsageSnapshotDetail
    )

    // ---- UI 煙霧測試（資料庫保持開啟，讓主畫面能列出班級與作業） ----------
    const settingsBefore = await readSettings()
    let ui: Awaited<ReturnType<typeof runUiSmoke>>
    try {
      ui = await runUiSmoke({
        classId: created.id,
        assignmentId: assignment.id,
        usedSentenceId: sentenceLibraryId,
        usedCommentId,
        otherCommentId,
        defaultCommentId,
        juniorCommentId
      })
    } finally {
      await writeSettings({
        libraryMode: settingsBefore.libraryMode ?? 'auto',
        librarySort: prefsBefore.sort,
        libraryPins: prefsBefore.pins,
        libraryCooldownDays: prefsBefore.cooldownDays,
        libraryDisabled: settingsBefore.libraryDisabled ?? { junior: [], senior: [] }
      })
    }
    add('主畫面、API 與批閱介面', ui.ok, ui.detail)
    add('IPC library:get 依學制並可切換版本', ui.libraryIpcOk, ui.libraryDetail)
    add('批閱畫面評語庫版本下拉與草稿提示', ui.libraryUiOk, ui.libraryDetail)
    add('IPC library:usage／get-prefs／set-prefs', ui.libraryTools.ipcOk, ui.libraryTools.ipcDetail)
    add('評語庫常用排序、釘選與使用次數標示', ui.libraryTools.sortUiOk, ui.libraryTools.sortDetail)
    add('評語庫偏好重開面板與重新載入後保留', ui.libraryTools.persistOk, ui.libraryTools.persistDetail)
    add(
      '評語庫冷卻輪替 UI（下拉、天數輸入、上次使用、重載保留）',
      ui.libraryTools.rotationUiOk,
      ui.libraryTools.rotationDetail
    )
    add(
      'IPC library:set-disabled 驗證版本、id 與 boolean',
      ui.disabledLibrary.validateOk,
      ui.disabledLibrary.validateDetail
    )
    add(
      'IPC library:get 套用 senior 停用並保留條目',
      ui.disabledLibrary.applyOk,
      ui.disabledLibrary.applyDetail
    )
    add(
      'IPC 重新啟用後 disabled 回到原值',
      ui.disabledLibrary.restoreOk,
      ui.disabledLibrary.restoreDetail
    )
    add(
      'IPC junior 停用不影響 senior',
      ui.disabledLibrary.scopeOk,
      ui.disabledLibrary.scopeDetail
    )
    add(
      '評語庫「管理」切換與停用說明',
      ui.disabledLibrary.manageOk,
      ui.disabledLibrary.manageDetail
    )
    add(
      '管理關閉時停用條目不顯示',
      ui.disabledLibrary.hideOk,
      ui.disabledLibrary.hideDetail
    )
    add(
      '管理開啟時顯示已停用標籤、啟用按鈕且重載仍停用',
      ui.disabledLibrary.persistOk,
      ui.disabledLibrary.persistDetail
    )
    add(
      '按啟用後恢復並可插入',
      ui.disabledLibrary.enableOk,
      ui.disabledLibrary.enableDetail
    )
    add(
      '國中／高中職停用清單分開',
      ui.disabledLibrary.splitOk,
      ui.disabledLibrary.splitDetail
    )
    add('自訂評語新增表單與自訂標籤', ui.customLibrary.createOk, ui.customLibrary.createDetail)
    add('自訂評語編輯文字與標籤', ui.customLibrary.editOk, ui.customLibrary.editDetail)
    add('自訂評語錯誤訊息顯示', ui.customLibrary.errorOk, ui.customLibrary.errorDetail)
    add('自訂評語重新載入後保留', ui.customLibrary.persistOk, ui.customLibrary.persistDetail)
    add('自訂評語 IPC 驗證與內建刪除拒絕', ui.customLibrary.validateOk, ui.customLibrary.validateDetail)
    add('自訂評語停用／啟用', ui.customLibrary.toggleOk, ui.customLibrary.toggleDetail)
    add('自訂評語插入與使用次數', ui.customLibrary.insertOk, ui.customLibrary.insertDetail)
    add('自訂評語刪除與舊 work 快照', ui.customLibrary.deleteOk, ui.customLibrary.deleteDetail)
    add('快速給分：分項合計分配與 autosave', ui.quickScoreOk, ui.quickScoreDetail)
    add('快速給分：複製上一份分數與覆寫', ui.quickCopyOk, ui.quickCopyDetail)

    const workAfterLibrary = await loadWork(created.id, assignment.id, '07')
    add(
      '切換評語庫版本不改寫批注與分數',
      ui.workStableOk &&
        workAfterLibrary.annotations.length === 1 &&
        JSON.stringify(workAfterLibrary.scores) === JSON.stringify(baseWork.scores),
      `畫面總評與分數不變；批注 ${workAfterLibrary.annotations.length} 個、總分 ${
        workAfterLibrary.scores?.total ?? '—'
      }`
    )

    // ---- D23 停用後舊批注快照不變 -----------------------------------------
    let snapshotOk = false
    let snapshotDetail = ''
    try {
      const rawBefore = await readFile(s07Path, 'utf8')
      const workBeforeDisable = await loadWork(created.id, assignment.id, '07')
      const disabledNow = await writeLibraryDisabled('senior', [
        ...disabledBefore.senior,
        usedCommentId
      ])
      const payload = applyLibraryDisabled(libraryForGrade('senior'), disabledNow)
      const payloadEntry = payload.library.entries.find((entry) => entry.id === usedCommentId)
      const rawAfter = await readFile(s07Path, 'utf8')
      const workAfterDisable = await loadWork(created.id, assignment.id, '07')
      const annotationBefore = workBeforeDisable.annotations[0]
      const annotationAfter = workAfterDisable.annotations[0]
      snapshotOk =
        payloadEntry?.disabled === true &&
        rawBefore === rawAfter &&
        workBeforeDisable.final_comment?.text === workAfterDisable.final_comment?.text &&
        workAfterDisable.final_comment?.text === validFinal &&
        workBeforeDisable.final_comment?.library_id === workAfterDisable.final_comment?.library_id &&
        workAfterDisable.final_comment?.library_id === usedCommentId &&
        annotationBefore?.text === annotationAfter?.text &&
        annotationBefore?.library_id === annotationAfter?.library_id &&
        annotationAfter?.library_id === sentenceLibraryId
      snapshotDetail = snapshotOk
        ? `停用 ${usedCommentId} 後 work.json 位元組不變；總評文字與 library_id ${
            workAfterDisable.final_comment?.library_id
          }、批注「${annotationAfter?.text ?? '—'}」均保留`
        : `停用後 work 快照改變（位元組${rawBefore === rawAfter ? '相同' : '不同'}、總評 ${
            workAfterDisable.final_comment?.library_id ?? '—'
          }、批注 ${annotationAfter?.library_id ?? '—'}）`
    } catch (error) {
      snapshotDetail = `停用快照測試失敗：${message(error)}`
    } finally {
      await writeLibraryDisabled('senior', disabledBefore.senior)
    }
    add('停用評語後既有 work 快照保留文字與 library_id', snapshotOk, snapshotDetail)

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
