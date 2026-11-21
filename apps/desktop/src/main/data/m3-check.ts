import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BUILTIN_LIBRARY,
  JUNIOR_LIBRARY,
  LIBRARY_VERSION,
  LibrarySchema,
  RUBRIC_PRESETS,
  SENIOR_LIBRARY,
  computeScore,
  libraryForGrade,
  normalizeComment,
  resolveGrade,
  sortLibraryEntries,
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
import { readLibraryPrefs, readSettings, writeLibraryPrefs, writeSettings } from './settings'

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
}

interface LibraryUiExpectation {
  classId: string
  assignmentId: string
  usedSentenceId: string
  usedCommentId: string
  otherCommentId: string
  defaultCommentId: string
}

const emptyLibraryTools = (): LibraryToolsUiResult => ({
  ipcOk: false,
  ipcDetail: '未執行',
  sortUiOk: false,
  sortDetail: '未執行',
  persistOk: false,
  persistDetail: '未執行'
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
  } => ({
    ok: false,
    detail,
    libraryIpcOk: false,
    libraryUiOk: false,
    libraryDetail: '未執行',
    workStableOk: false,
    libraryTools: emptyLibraryTools()
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
        await window.electronAPI.library.setPrefs({ sort: 'default', pins: [] })
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
          prefsAfter
        }
      })()`
    )) as {
      ids: string[]
      modes: string[]
      versions: string[]
      counts: number[]
      usage: { current: Record<string, number>; overall: Record<string, number> }
      prefsBefore: { sort: string; pins: string[] }
      prefsSet: { sort: string; pins: string[] }
      prefsAfter: { sort: string; pins: string[] }
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
      libraryIpc.usage.overall[expectation.otherCommentId] === 1
    const prefsIpcOk =
      libraryIpc.prefsAfter.sort === 'unused' &&
      libraryIpc.prefsAfter.pins.join(',') === 'E-01,E-02' &&
      libraryIpc.prefsSet.sort === 'unused' &&
      libraryIpc.prefsSet.pins.join(',') === 'E-01,E-02'
    const libraryTools = emptyLibraryTools()
    libraryTools.ipcOk = usageIpcOk && prefsIpcOk
    libraryTools.ipcDetail = `usage 本批 ${libraryIpc.usage.current[usedSentenceId] ?? 0}／累計 ${
      libraryIpc.usage.overall[usedSentenceId] ?? 0
    }；prefs ${libraryIpc.prefsAfter.sort}／${libraryIpc.prefsAfter.pins.join(',') ||
      '無'}`

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

    const ok =
      reviewOk &&
      libraryIpcOk &&
      libraryUiOk &&
      workStableOk &&
      rubricEditorOk &&
      libraryTools.ipcOk &&
      libraryTools.sortUiOk &&
      libraryTools.persistOk
    const detail = ok
      ? `主畫面、preload API、批閱介面（S07）、評語庫切換／排序／釘選與量規編輯器正常`
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
                        : `重新載入後偏好未保留（${libraryTools.persistDetail}）`

    return {
      ok,
      detail,
      libraryIpcOk,
      libraryUiOk,
      libraryDetail: `${libraryIpc.ids.join('→')}；${libraryUiDetail}`,
      workStableOk,
      libraryTools
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
    await writeLibraryPrefs({ sort: 'default', pins: [] })

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
        defaultCommentId
      })
    } finally {
      await writeSettings({
        libraryMode: settingsBefore.libraryMode ?? 'auto',
        librarySort: prefsBefore.sort,
        libraryPins: prefsBefore.pins
      })
    }
    add('主畫面、API 與批閱介面', ui.ok, ui.detail)
    add('IPC library:get 依學制並可切換版本', ui.libraryIpcOk, ui.libraryDetail)
    add('批閱畫面評語庫版本下拉與草稿提示', ui.libraryUiOk, ui.libraryDetail)
    add('IPC library:usage／get-prefs／set-prefs', ui.libraryTools.ipcOk, ui.libraryTools.ipcDetail)
    add('評語庫常用排序、釘選與使用次數標示', ui.libraryTools.sortUiOk, ui.libraryTools.sortDetail)
    add('評語庫偏好重開面板與重新載入後保留', ui.libraryTools.persistOk, ui.libraryTools.persistDetail)

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
