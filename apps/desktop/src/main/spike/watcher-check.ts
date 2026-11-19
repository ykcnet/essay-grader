import chokidar from 'chokidar'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { inboxDir, spikePagePath } from './paths'

export interface WatcherResult {
  ok: boolean
  ms: number
  pairs: number
  images: number
  sidecars: number
  error?: string
}

const TOTAL = 10

/** 丢 10 張圖 + 10 個 sidecar，量到全部配對為止；目標 3 秒內。 */
export async function runWatcherCheck(): Promise<WatcherResult> {
  await rm(inboxDir, { recursive: true, force: true })
  await mkdir(inboxDir, { recursive: true })

  const images = new Set<string>()
  const sidecars = new Set<string>()
  const matched = new Set<string>()
  const started = performance.now()

  const watcher = chokidar.watch(inboxDir, {
    ignoreInitial: true,
    // Windows 上逐檔 fs.watch 會遇到 EBUSY（檔案正被寫入），改用輪詢
    usePolling: true,
    interval: 100,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })

  // chokidar 的 watch 錯誤不該讓整個 spike 中斷
  watcher.on('error', () => undefined)

  const done = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('3 秒內未完成配對')), 3200)

    watcher.on('add', (file) => {
      const name = basename(file)
      const ext = extname(name).toLowerCase()
      const key = name.slice(0, -ext.length)

      if (ext === '.jpg') images.add(key)
      else if (ext === '.json') sidecars.add(key)

      if (images.has(key) && sidecars.has(key)) matched.add(key)
      if (matched.size === TOTAL) {
        clearTimeout(timer)
        resolve(performance.now() - started)
      }
    })
  })

  // 等 watcher 完成初始掃描，避免第一批檔案被當成 ignoreInitial
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))

  try {
    for (let i = 0; i < TOTAL; i++) {
      const key = `S${String(i + 1).padStart(2, '0')}__001`
      await copyFile(spikePagePath, join(inboxDir, `${key}.jpg`))
      await writeFile(
        join(inboxDir, `${key}.json`),
        JSON.stringify({ seat: String(i + 1).padStart(2, '0'), seq: 1 }),
        'utf8'
      )
    }
    // 應被忽略的暫存檔
    await writeFile(join(inboxDir, 'noise.tmp'), 'ignore me', 'utf8')

    const ms = await done
    return {
      ok: ms <= 3000 && matched.size === TOTAL,
      ms,
      pairs: matched.size,
      images: images.size,
      sidecars: sidecars.size
    }
  } catch (error) {
    return {
      ok: false,
      ms: performance.now() - started,
      pairs: matched.size,
      images: images.size,
      sidecars: sidecars.size,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await watcher.close()
  }
}
