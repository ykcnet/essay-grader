import { app, BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'
import sharp from 'sharp'
import type { ImportEvent } from '@essay-grader/core'
import {
  closeDatabase,
  createAssignment,
  createClass,
  listWorks,
  loadClass,
  loadWork,
  openDatabase,
  saveClass
} from '../data/repository'
import { clearExternalInboxRoot, writeSettings } from '../data/settings'
import { startExternalWatcher } from './external'
import { ensureInbox, onImportEvent } from './watcher'
import {
  assignUnmatched,
  getUnmatchedThumbnail,
  listUnmatched,
  type UnmatchedPhoto
} from './unmatched'

interface Check {
  label: string
  ok: boolean
  detail: string
}

const pass = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await delay(200)
  }
  return false
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function findFile(dir: string, suffix: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[])
  const target = files.find(
    (file) =>
      file.endsWith(suffix) &&
      !file.endsWith('.reason.txt') &&
      !file.endsWith('.meta.json') &&
      !file.endsWith('.json')
  )
  return target ? join(dir, target) : null
}

async function findNewestImage(dir: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[])
  const images = files.filter(
    (file) =>
      /\.(jpe?g|png)$/i.test(file) &&
      !file.endsWith('.reason.txt') &&
      !file.endsWith('.meta.json')
  )
  if (images.length === 0) return null
  const withStats = await Promise.all(
    images.map(async (file) => ({ file, info: await stat(join(dir, file)) }))
  )
  withStats.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)
  return join(dir, withStats[0]!.file)
}

function waitForWindow(
  win: BrowserWindow,
  expression: string,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now()
  return (async () => {
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = (await win.webContents.executeJavaScript(
          `Boolean(${expression})`
        )) as boolean
        if (ok) return true
      } catch {
        // 頁面還在下載
      }
      await delay(120)
    }
    return false
  })()
}

async function runUiSmoke(assignmentId: string): Promise<{ ok: boolean; detail: string }> {
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
    const ready = await waitForWindow(
      win,
      "document.body.innerText.includes('作文批閱') && document.querySelectorAll('.assignment-row').length > 0",
      10000
    )
    if (!ready) return { ok: false, detail: '主畫面或作業列表未渲染' }

    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const row = [...document.querySelectorAll('.assignment-row')].find(
          (item) => item.textContent?.includes(${JSON.stringify(assignmentId)})
        ) ?? document.querySelector('.assignment-row')
        if (!row) return false
        row.click()
        return true
      })()`
    )) as boolean
    if (!clicked) return { ok: false, detail: '找不到作業列可點擊' }

    const buttonReady = await waitForWindow(
      win,
      "[...document.querySelectorAll('.unmatched-toggle')].length > 0",
      10000
    )
    if (!buttonReady) return { ok: false, detail: '找不到「未匹配照片」按鈕' }

    await win.webContents.executeJavaScript(
      `document.querySelector('.unmatched-toggle').click()`
    )

    const panelReady = await waitForWindow(
      win,
      "document.querySelector('.unmatched-panel') !== null",
      10000
    )
    const cardsReady = await waitForWindow(
      win,
      "document.querySelectorAll('.unmatched-card').length > 0",
      15000
    )
    const thumbReady = await waitForWindow(
      win,
      "document.querySelector('.unmatched-card .unmatched-thumb img') !== null",
      15000
    )
    const controls = (await win.webContents.executeJavaScript(
      `(() => {
        const select = document.querySelector('.unmatched-student')
        return {
          options: select ? select.querySelectorAll('option').length : 0,
          assign: document.querySelector('.unmatched-assign')?.textContent?.includes('S07') === true,
          confirm: document.querySelector('.unmatched-confirm')?.textContent?.includes('來源會刪除') === true,
          selectAll: [...document.querySelectorAll('.unmatched-select-actions button')].some(
            (item) => item.textContent?.trim() === '全選'
          ),
          clear: [...document.querySelectorAll('.unmatched-select-actions button')].some(
            (item) => item.textContent?.trim() === '清除選取'
          )
        }
      })()`
    )) as {
      options: number
      assign: boolean
      confirm: boolean
      selectAll: boolean
      clear: boolean
    }

    const apiReady = (await win.webContents.executeJavaScript(
      `Boolean(
        window.electronAPI &&
        typeof window.electronAPI.imports?.listUnmatched === 'function' &&
        typeof window.electronAPI.imports?.unmatchedThumbnail === 'function' &&
        typeof window.electronAPI.imports?.assignUnmatched === 'function'
      )`
    )) as boolean

    const ok =
      panelReady &&
      cardsReady &&
      thumbReady &&
      controls.options === 2 &&
      controls.assign &&
      controls.confirm &&
      controls.selectAll &&
      controls.clear &&
      apiReady

    return {
      ok,
      detail: `面板 ${panelReady ? '是' : '否'}、卡片 ${cardsReady ? '是' : '否'}、縮圖 ${thumbReady ? '是' : '否'}、學生選項 ${controls.options}、指定按鈕 ${controls.assign ? '是' : '否'}、確認文字 ${controls.confirm ? '是' : '否'}、全選／清除 ${controls.selectAll && controls.clear ? '是' : '否'}、preload API ${apiReady ? '是' : '否'}`
    }
  } finally {
    win.destroy()
  }
}

function writeMeta(
  path: string,
  payload: {
    classId?: string
    assignmentId?: string
    seat?: string
    reason: string
    source: 'inbox' | 'drive'
    originalName?: string
  }
): Promise<void> {
  return writeFile(
    `${path}.meta.json`,
    `${JSON.stringify(
      {
        schema_version: 1,
        ...payload,
        movedAt: new Date().toISOString(),
        originalName: payload.originalName ?? basename(path)
      },
      null,
      2
    )}\n`,
    'utf8'
  )
}

/** `--match-check`：驗證未匹配照片的列表、縮圖、手動指定與 UI。 */
export async function runMatchCheck(): Promise<number> {
  const repoRoot = join(app.getAppPath(), '..', '..')
  const work = join(repoRoot, 'spike-out', 'match-check')
  const dbRoot = join(work, 'db')
  const driveRoot = join(work, 'Google 雲端硬碟', 'EssayGrader', 'inbox')
  const userData = join(work, 'userData')
  const source = join(repoRoot, 'spike-assets', 'page-2600.jpg')

  await rm(work, { recursive: true, force: true })
  await mkdir(dbRoot, { recursive: true })
  await mkdir(driveRoot, { recursive: true })
  await mkdir(userData, { recursive: true })
  app.setPath('userData', userData)

  const checks: Check[] = []
  const add = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail })
  }

  const received: ImportEvent[] = []
  const off = onImportEvent((event) => received.push(event))
  const driveEvents = (): ImportEvent[] =>
    received.filter((event) => event.source === 'drive')
  const countEvents = (type: string, source?: 'drive'): number =>
    received.filter((event) => event.type === type && (!source || event.source === source))
      .length

  try {
    await openDatabase(dbRoot, { remember: false })
    add('開啟資料庫', true, dbRoot)

    const created = await createClass({
      classNo: '302',
      name: '國中302',
      grade: 'junior',
      academicYear: '114',
      semester: 1,
      teacher: '王老師'
    })
    const loaded = await loadClass(created.id)
    loaded.data.students = [
      { seat: '07', name: '王小明', active: true },
      { seat: '08', name: '陳怡君', active: true },
      { seat: '09', name: '林志豪', active: false }
    ]
    await saveClass(loaded.data)

    const assignment = await createAssignment({
      classId: created.id,
      title: '我的母親',
      prompt: '',
      genre: 'narrative',
      wordLimit: 600,
      rubricPreset: 'junior'
    })
    const inbox = await ensureInbox(created.id, assignment.id)
    const internalUnmatched = join(inbox, '_unmatched')
    await mkdir(internalUnmatched, { recursive: true })

    await writeSettings({ externalInboxRoot: driveRoot })
    await startExternalWatcher(driveRoot, dbRoot)
    add('建立班級、作業與內外 watcher', true, `${created.id}／${assignment.id}`)

    const base = await readFile(source)
    const bytes = (tag: string): Buffer => Buffer.concat([base, Buffer.from(`\n${tag}`)])

    // 內部 watcher：sidecar 指向名單外座號，以及缺少 sidecar。
    await writeFile(join(inbox, 'S99__META__001.jpg'), bytes('match-s99'))
    await writeFile(
      join(inbox, 'S99__META__001.json'),
      JSON.stringify({
        schema_version: 1,
        class_id: created.id,
        assignment_id: assignment.id,
        seat: '99',
        seq: 1,
        session_id: 'MATCH',
        captured_at: new Date().toISOString()
      }),
      'utf8'
    )
    await writeFile(join(inbox, 'ORPHAN-META.jpg'), bytes('match-orphan'))

    // 外部 watcher：扁平缺 sidecar、sidecar 指向錯誤班級，以及一份正常 S08 與其重複檔。
    const externalAssignment = join(driveRoot, created.id, assignment.id)
    await mkdir(externalAssignment, { recursive: true })
    await writeFile(join(driveRoot, 'flat-no-seat.jpg'), bytes('match-flat'))
    await writeFile(join(externalAssignment, 'S07__WRONG.jpg'), bytes('match-wrong'))
    await writeFile(
      join(externalAssignment, 'S07__WRONG.json'),
      JSON.stringify({
        schema_version: 1,
        class_id: 'C999-2099F',
        assignment_id: assignment.id,
        seat: '07',
        seq: 1,
        session_id: 'MATCH',
        captured_at: new Date().toISOString()
      }),
      'utf8'
    )

    const s08Bytes = bytes('match-drive-s08')
    await writeFile(join(externalAssignment, 'S08__DRIVE__001.jpg'), s08Bytes)
    const externalImported = await waitFor(
      async () => countEvents('imported', 'drive') >= 1,
      30000
    )
    add(
      '外部 S08 先匯入',
      externalImported && (await exists(join(dbRoot, created.id, assignment.id, 'S08', 'work.json'))),
      '作為外部重複檔比對基準'
    )

    await writeFile(join(externalAssignment, 'S08__DRIVE__001 (1).jpg'), s08Bytes)
    const externalDuplicate = await waitFor(
      async () => countEvents('duplicate', 'drive') >= 1,
      30000
    )

    const internalFailed = await waitFor(
      async () =>
        (await exists(join(internalUnmatched, 'ORPHAN-META.jpg'))) === false &&
        (await findFile(internalUnmatched, 'ORPHAN-META.jpg')) !== null &&
        (await findFile(internalUnmatched, 'S99__META__001.jpg')) !== null,
      30000
    )
    const externalFailed = await waitFor(
      async () =>
        (await findFile(join(driveRoot, '_unmatched'), 'flat-no-seat.jpg')) !== null &&
        (await findFile(join(driveRoot, '_unmatched'), 'S07__WRONG.jpg')) !== null,
      30000
    )

    const s99File = await findFile(internalUnmatched, 'S99__META__001.jpg')
    const orphanFile = await findFile(internalUnmatched, 'ORPHAN-META.jpg')
    const s99Meta = s99File ? await readJson(`${s99File}.meta.json`) : null
    const orphanMeta = orphanFile ? await readJson(`${orphanFile}.meta.json`) : null

    add(
      '內部失敗檔寫入 meta',
      internalFailed &&
        s99Meta?.['classId'] === created.id &&
        s99Meta?.['assignmentId'] === assignment.id &&
        s99Meta?.['seat'] === '99' &&
        s99Meta?.['source'] === 'inbox' &&
        String(s99Meta?.['reason'] ?? '').includes('不在名單') &&
        orphanMeta?.['classId'] === created.id &&
        orphanMeta?.['assignmentId'] === assignment.id &&
        orphanMeta?.['seat'] === undefined &&
        String(orphanMeta?.['reason'] ?? '').includes('缺少 sidecar'),
      `S99：${s99Meta?.['seat'] ?? '無 seat'}／${s99Meta?.['reason'] ?? '無 reason'}；缺 sidecar：${orphanMeta?.['reason'] ?? '無'}`
    )

    const flatFile = await findFile(join(driveRoot, '_unmatched'), 'flat-no-seat.jpg')
    const wrongFile = await findFile(join(driveRoot, '_unmatched'), 'S07__WRONG.jpg')
    const flatMeta = flatFile ? await readJson(`${flatFile}.meta.json`) : null
    const wrongMeta = wrongFile ? await readJson(`${wrongFile}.meta.json`) : null
    add(
      '外部失敗檔寫入 meta',
      externalFailed &&
        flatMeta?.['source'] === 'drive' &&
        flatMeta?.['classId'] === undefined &&
        String(flatMeta?.['reason'] ?? '').includes('缺少 sidecar') &&
        wrongMeta?.['classId'] === created.id &&
        wrongMeta?.['assignmentId'] === assignment.id &&
        wrongMeta?.['seat'] === '07' &&
        wrongMeta?.['source'] === 'drive' &&
        String(wrongMeta?.['reason'] ?? '').includes('不符'),
      `扁平：${flatMeta?.['reason'] ?? '無'}；錯誤 sidecar：${wrongMeta?.['seat'] ?? '無 seat'}／${wrongMeta?.['reason'] ?? '無'}`
    )

    const driveDuplicateFile = await findNewestImage(join(driveRoot, '_duplicates'))
    const driveDuplicateMeta = driveDuplicateFile
      ? await readJson(`${driveDuplicateFile}.meta.json`)
      : null
    add(
      '重複移動也帶 meta',
      externalDuplicate &&
        driveDuplicateMeta?.['classId'] === created.id &&
        driveDuplicateMeta?.['assignmentId'] === assignment.id &&
        driveDuplicateMeta?.['seat'] === '08' &&
        driveDuplicateMeta?.['source'] === 'drive' &&
        String(driveDuplicateMeta?.['reason'] ?? '').includes('重複'),
      driveDuplicateFile ? basename(driveDuplicateFile) : '未找到重複檔'
    )

    // 沒有 meta 的舊檔：仍要列出，且 class／assignment 留空。
    const oldPhoto = join(internalUnmatched, '2026-01-02T03-04-05-000Z__old-photo.jpg')
    await writeFile(oldPhoto, bytes('match-old'))

    const listing = await listUnmatched(created.id, assignment.id)
    const findPhoto = (name: string, source: 'inbox' | 'drive'): UnmatchedPhoto | undefined =>
      listing.photos.find((photo) => photo.name === name && photo.source === source)
    const old = findPhoto('old-photo.jpg', 'inbox')
    const s99 = findPhoto('S99__META__001.jpg', 'inbox')
    const orphan = findPhoto('ORPHAN-META.jpg', 'inbox')
    const flat = findPhoto('flat-no-seat.jpg', 'drive')
    const wrong = findPhoto('S07__WRONG.jpg', 'drive')

    add(
      '列出內外 _unmatched 與來源',
      listing.photos.length === 5 &&
        listing.photos.filter((photo) => photo.source === 'inbox').length === 3 &&
        listing.photos.filter((photo) => photo.source === 'drive').length === 2,
      `共 ${listing.photos.length} 張（本機 ${listing.photos.filter((p) => p.source === 'inbox').length }、Drive ${listing.photos.filter((p) => p.source === 'drive').length}）`
    )
    add(
      '顯示名稱去掉時間戳、舊檔無 meta',
      old?.classId === undefined &&
        old?.assignmentId === undefined &&
        old?.hasMeta === false &&
        old?.reason === '未記錄原因' &&
        old?.name === 'old-photo.jpg',
      old ? `${old.name}／${old.hasMeta ? '有 meta' : '無 meta'}／${old.reason}` : '未列出舊檔'
    )
    add(
      '列表 meta 與原因正確',
      s99?.classId === created.id &&
        s99?.assignmentId === assignment.id &&
        s99?.seat === '99' &&
        s99.reason.includes('不在名單') &&
        orphan?.classId === created.id &&
        orphan?.seat === undefined &&
        flat?.source === 'drive' &&
        flat?.classId === undefined &&
        wrong?.classId === created.id &&
        wrong?.seat === '07' &&
        wrong.reason.includes('不符'),
      `S99 ${s99?.seat ?? '—'}、缺 sidecar ${orphan?.seat ?? '無 seat'}、扁平 ${flat?.classId ?? '未指定'}、錯誤 ${wrong?.seat ?? '—'}`
    )
    add(
      '依修改時間與檔名排序',
      listing.photos.every((photo, index, all) => {
        if (index === 0) return true
        const prev = all[index - 1]!
        if (prev.modifiedAt < photo.modifiedAt) return true
        return prev.modifiedAt === photo.modifiedAt && prev.name.localeCompare(photo.name) <= 0
      }),
      `${listing.photos.map((photo) => photo.modifiedAt.slice(11, 19)).join(', ')}`
    )

    // 縮圖：data URL 可解碼，尺寸不超過 320。
    const thumbPhoto = s99 ?? old
    const thumbnail = thumbPhoto
      ? await getUnmatchedThumbnail(created.id, assignment.id, thumbPhoto.path)
      : null
    let thumbMeta: { width?: number; height?: number } | null = null
    if (thumbnail?.dataUrl.startsWith('data:image/jpeg;base64,')) {
      const buffer = Buffer.from(thumbnail.dataUrl.split(',')[1] ?? '', 'base64')
      thumbMeta = await sharp(buffer).metadata()
    }
    add(
      '縮圖 data URL 與尺寸',
      Boolean(
        thumbnail &&
          thumbnail.dataUrl.startsWith('data:image/jpeg;base64,') &&
          thumbnail.dataUrl.length > 1000 &&
          (thumbMeta?.width ?? 0) > 0 &&
          (thumbMeta?.height ?? 0) > 0 &&
          (thumbMeta?.width ?? 0) <= 320 &&
          (thumbMeta?.height ?? 0) <= 320
      ),
      thumbnail
        ? `${thumbMeta?.width ?? 0}×${thumbMeta?.height ?? 0}、${thumbnail.bytes} bytes`
        : '未產生縮圖'
    )

    // 三張待指定照片：刻意亂序建立，主程序需依 mtime 排序。
    const assignSpecs = [
      { tag: 'assign-a', mtime: new Date('2026-11-20T10:00:00Z') },
      { tag: 'assign-b', mtime: new Date('2026-11-20T10:01:00Z') },
      { tag: 'assign-c', mtime: new Date('2026-11-20T10:02:00Z') }
    ]
    const createdPaths: string[] = []
    for (const spec of [assignSpecs[2]!, assignSpecs[0]!, assignSpecs[1]!]) {
      const path = join(internalUnmatched, `2026-11-20T00-00-00-000Z__${spec.tag}.jpg`)
      await writeFile(path, bytes(spec.tag))
      await writeFile(`${path}.reason.txt`, '手動測試\n', 'utf8')
      await writeMeta(path, {
        classId: created.id,
        assignmentId: assignment.id,
        reason: '手動測試',
        source: 'inbox'
      })
      await utimes(path, spec.mtime, spec.mtime)
      createdPaths.push(path)
    }
    // 同名的殘留 sidecar 也應在指定成功後刪除。
    const staleSidecar = `${createdPaths[1]}.json`
    await writeFile(staleSidecar, '{}', 'utf8')

    const expectedShas = [
      await sha256(createdPaths[1]!),
      await sha256(createdPaths[2]!),
      await sha256(createdPaths[0]!)
    ]
    const assignResult = await assignUnmatched({
      classId: created.id,
      assignmentId: assignment.id,
      seat: '07',
      paths: [createdPaths[2]!, createdPaths[0]!, createdPaths[1]!]
    })

    const imported = await waitFor(async () => {
      const works = await listWorks(created.id, assignment.id)
      return works.find((work) => work.seat === '07')?.pages === 3
    }, 30000)

    const s07 = await loadWork(created.id, assignment.id, '07')
    const actualShas = s07.pages.map((page) => page.sha256)
    add(
      '指定 3 張並排入匯入',
      assignResult.queued === 3 && assignResult.failed.length === 0,
      `queued=${assignResult.queued}、failed=${assignResult.failed.length}`
    )
    add(
      'watcher 附加 3 頁且順序正確',
      imported &&
        s07.pages.length === 3 &&
        actualShas.every((sha, index) => sha === expectedShas[index]),
      `pages=${s07.pages.length}、順序 ${actualShas.map((sha) => (sha ?? '').slice(0, 6)).join('→')}`
    )
    add(
      '來源圖片、reason、meta、sidecar 已刪除',
      (await Promise.all(
        createdPaths.flatMap((path) =>
          [
            path,
            `${path}.reason.txt`,
            `${path}.meta.json`
          ].map(async (file) => !(await exists(file)))
        )
      )).every(Boolean) && !(await exists(staleSidecar)),
      '3 張來源與附屬檔皆不存在'
    )
    add(
      '指定後 inbox 無殘留手動檔',
      (await readdir(inbox)).every((file) => !file.includes('__manual__')),
      'watcher 已處理或收走手動檔'
    )

    // 重複圖：與已匯入頁面相同位元組，指定後不得新增頁面。
    const duplicateSource = join(internalUnmatched, 'duplicate-photo.jpg')
    await writeFile(duplicateSource, bytes('assign-a'))
    const beforeDuplicatePages = (await listWorks(created.id, assignment.id)).find(
      (work) => work.seat === '07'
    )?.pages ?? 0
    const duplicateAssign = await assignUnmatched({
      classId: created.id,
      assignmentId: assignment.id,
      seat: '07',
      paths: [duplicateSource]
    })
    const duplicateEvent = await waitFor(
      async () =>
        received.some(
          (event) => event.type === 'duplicate' && event.source !== 'drive'
        ),
      20000
    )
    const afterDuplicatePages = (await listWorks(created.id, assignment.id)).find(
      (work) => work.seat === '07'
    )?.pages ?? 0
    const duplicateFile = await findNewestImage(join(inbox, '_duplicates'))
    const duplicateMeta = duplicateFile
      ? await readJson(`${duplicateFile}.meta.json`)
      : null
    add(
      '重複照片不新增頁面',
      duplicateAssign.queued === 1 &&
        duplicateEvent &&
        beforeDuplicatePages === 3 &&
        afterDuplicatePages === 3 &&
        !(await exists(duplicateSource)) &&
        duplicateMeta?.['seat'] === '07' &&
        duplicateMeta?.['source'] === 'inbox',
      `頁數 ${beforeDuplicatePages}→${afterDuplicatePages}，${duplicateEvent ? '已收到 duplicate 事件' : '未收到 duplicate 事件'}`
    )

    // 拒絕情境。
    let inactiveRejected = ''
    try {
      await assignUnmatched({
        classId: created.id,
        assignmentId: assignment.id,
        seat: '09',
        paths: [oldPhoto]
      })
    } catch (error) {
      inactiveRejected = message(error)
    }

    const outside = join(work, 'outside.jpg')
    const dbOutside = join(dbRoot, 'outside.jpg')
    await writeFile(outside, bytes('outside'))
    await writeFile(dbOutside, bytes('outside-inside-db'))
    let traversalRejected = ''
    try {
      await assignUnmatched({
        classId: created.id,
        assignmentId: assignment.id,
        seat: '07',
        paths: [join(internalUnmatched, '..', '..', '..', '..', 'outside.jpg')]
      })
    } catch (error) {
      traversalRejected = message(error)
    }

    let arbitraryRejected = ''
    try {
      await assignUnmatched({
        classId: created.id,
        assignmentId: assignment.id,
        seat: '07',
        paths: [source]
      })
    } catch (error) {
      arbitraryRejected = message(error)
    }

    let emptyRejected = ''
    try {
      await assignUnmatched({
        classId: created.id,
        assignmentId: assignment.id,
        seat: '07',
        paths: []
      })
    } catch (error) {
      emptyRejected = message(error)
    }

    add(
      '拒絕非在學座號',
      inactiveRejected.includes('不在在學名單'),
      inactiveRejected || '未拒絕'
    )
    add(
      '拒絕路徑穿越與任意路徑',
      traversalRejected.length > 0 &&
        arbitraryRejected.includes('_unmatched') &&
        isAbsolute(outside) &&
        relative(dbRoot, outside).startsWith('..'),
      `穿越：${traversalRejected || '未拒絕'}；任意：${arbitraryRejected || '未拒絕'}`
    )
    add(
      '拒絕空選取',
      emptyRejected.includes('至少一張'),
      emptyRejected || '未拒絕'
    )

    const ui = await runUiSmoke(assignment.id)
    add('UI 未匹配照片面板與 preload API', ui.ok, ui.detail)

    await clearExternalInboxRoot()
    await closeDatabase()
    add('關閉資料庫', true, 'watcher 已停止')
  } catch (error) {
    add('執行流程', false, message(error))
    try {
      await closeDatabase()
    } catch {
      // 已關閉或從未開啟
    }
  } finally {
    off()
  }

  console.log('')
  for (const check of checks) {
    console.log(`[${pass(check.ok)}] ${check.label}：${check.detail}`)
  }

  const ok = checks.every((check) => check.ok)
  console.log('')
  console.log(
    `[match] ${ok ? '全部通過' : '有項目失敗'}（${checks.filter((c) => c.ok).length}/${checks.length}）`
  )
  return ok ? 0 : 1
}
