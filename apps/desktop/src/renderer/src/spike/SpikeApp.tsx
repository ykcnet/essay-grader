import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Circle, Image as KonvaImage, Layer, Stage } from 'react-konva'
import type Konva from 'konva'

type Marker = { id: string; x: number; y: number }

const PAGE_W = 2600
const PAGE_H = 3466
const DISPLAY_W = 600
const DISPLAY_H = Math.round((DISPLAY_W * PAGE_H) / PAGE_W)
const STAGE_W = 740
const STAGE_H = 860

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

declare global {
  interface Window {
    __spike: {
      ready: () => Promise<void>
      placeMarkers: (count?: number) => Marker[]
      getMarkers: () => Marker[]
      clear: () => void
      save: () => Promise<{ path: string; count: number }>
      setZoom: (scale: number) => void
      getZoom: () => number
      fpsTest: (durationMs: number) => Promise<number>
      anchorError: () => number
    }
  }
}

export default function SpikeApp(): JSX.Element {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [markersLoaded, setMarkersLoaded] = useState(false)
  const [view, setView] = useState({ x: 70, y: 30, scale: 1 })
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const stageRef = useRef<Konva.Stage | null>(null)
  const markersRef = useRef<Marker[]>([])
  const viewRef = useRef(view)

  const readyRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  if (!readyRef.current) {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    readyRef.current = { promise, resolve }
  }

  const appendLog = useCallback((message: string) => {
    setLog((prev) => [...prev.slice(-40), message])
  }, [])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    let cancelled = false

    window.electronAPI.spike
      .loadPage()
      .then(({ dataUrl }: { dataUrl: string }) => {
        const img = new Image()
        img.onload = () => {
          if (!cancelled) setImage(img)
        }
        img.src = dataUrl
      })
      .catch((error: unknown) => appendLog(`載入頁面失敗：${String(error)}`))

    window.electronAPI.spike
      .loadMarkers()
      .then((list: Marker[]) => {
        if (cancelled) return
        markersRef.current = list
        setMarkers(list)
      })
      .finally(() => {
        if (!cancelled) setMarkersLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [appendLog])

  useEffect(() => {
    if (image && markersLoaded) readyRef.current?.resolve()
  }, [image, markersLoaded])

  const placeMarkers = useCallback((count = 50): Marker[] => {
    const next = Array.from({ length: count }, (_, index) => ({
      id: `m${index}`,
      x: ((index % 10) + 0.5) / 10,
      y: (Math.floor(index / 10) + 0.5) / 10
    }))
    markersRef.current = next
    setMarkers(next)
    return next
  }, [])

  const clear = useCallback(() => {
    markersRef.current = []
    setMarkers([])
  }, [])

  const save = useCallback(async () => {
    const result = await window.electronAPI.spike.saveMarkers(markersRef.current)
    appendLog(`已儲存 ${result.count} 個標記 → ${result.path}`)
    return result
  }, [appendLog])

  const setZoom = useCallback((scale: number) => {
    const stage = stageRef.current
    if (stage) {
      stage.scale({ x: scale, y: scale })
      stage.batchDraw()
    }
    setView((prev) => ({ ...prev, scale }))
  }, [])

  const getZoom = useCallback((): number => stageRef.current?.scaleX() ?? viewRef.current.scale, [])

  const fpsTest = useCallback((durationMs: number): Promise<number> => {
    const stage = stageRef.current
    if (!stage) return Promise.resolve(0)

    const originalScale = stage.scaleX()
    const started = performance.now()
    let frames = 0

    return new Promise<number>((resolve) => {
      const tick = (): void => {
        const elapsed = performance.now() - started
        const scale = 1 + 3 * Math.abs(Math.sin(elapsed / 300))
        stage.scale({ x: scale, y: scale })
        stage.batchDraw()
        frames += 1

        if (elapsed < durationMs) {
          requestAnimationFrame(tick)
        } else {
          stage.scale({ x: originalScale, y: originalScale })
          stage.batchDraw()
          resolve((frames / elapsed) * 1000)
        }
      }
      requestAnimationFrame(tick)
    })
  }, [])

  const anchorError = useCallback((): number => {
    const stage = stageRef.current
    if (!stage) return Number.POSITIVE_INFINITY

    const scale = stage.scaleX()
    const position = stage.position()
    let max = 0

    for (const marker of markersRef.current) {
      const node = stage.findOne(`#marker-${marker.id}`)
      if (!node) return Number.POSITIVE_INFINITY
      const absolute = node.getAbsolutePosition()
      const expectedX = position.x + marker.x * DISPLAY_W * scale
      const expectedY = position.y + marker.y * DISPLAY_H * scale
      max = Math.max(max, Math.abs(absolute.x - expectedX), Math.abs(absolute.y - expectedY))
    }
    return max
  }, [])

  useEffect(() => {
    window.__spike = {
      ready: () => readyRef.current!.promise,
      placeMarkers,
      getMarkers: () => markersRef.current,
      clear,
      save,
      setZoom,
      getZoom,
      fpsTest,
      anchorError
    }
  }, [placeMarkers, clear, save, setZoom, getZoom, fpsTest, anchorError])

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>): void => {
    event.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const oldScale = viewRef.current.scale
    const factor = event.evt.deltaY > 0 ? 1 / 1.12 : 1.12
    const nextScale = clamp(oldScale * factor, 0.2, 8)
    const point = {
      x: (pointer.x - viewRef.current.x) / oldScale,
      y: (pointer.y - viewRef.current.y) / oldScale
    }

    setView({
      x: pointer.x - point.x * nextScale,
      y: pointer.y - point.y * nextScale,
      scale: nextScale
    })
  }

  const handleClick = (event: Konva.KonvaEventObject<MouseEvent>): void => {
    if (event.target.name() === 'marker') return
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const scale = stage.scaleX()
    const position = stage.position()
    const x = (pointer.x - position.x) / scale / DISPLAY_W
    const y = (pointer.y - position.y) / scale / DISPLAY_H
    if (x < 0 || x > 1 || y < 0 || y > 1) return

    const next = [
      ...markersRef.current,
      { id: `m${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x, y }
    ]
    markersRef.current = next
    setMarkers(next)
  }

  const run = async (label: string, task: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      const result = await task()
      appendLog(`${label}：${JSON.stringify(result)}`)
    } catch (error) {
      appendLog(`${label} 失敗：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const zoomPercent = Math.round(view.scale * 100)

  return (
    <div className="spike">
      <header className="spike-head">
        <div>
          <p className="eyebrow">Spike · 1 天技術驗證</p>
          <h1>Canvas 批閱驗證</h1>
        </div>
        <div className="stats">
          <span>2600 × 3466</span>
          <span>{zoomPercent}%</span>
          <span>{markers.length} 標記</span>
        </div>
      </header>

      <div className="spike-body">
        <div className="canvas-wrap">
          <Stage
            ref={stageRef}
            width={STAGE_W}
            height={STAGE_H}
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
            draggable
            onWheel={handleWheel}
            onClick={handleClick}
            onDragEnd={(event) => {
              const node = event.target
              setView((prev) => ({ ...prev, x: node.x(), y: node.y() }))
            }}
          >
            <Layer>
              {image && <KonvaImage image={image} width={DISPLAY_W} height={DISPLAY_H} />}
              {markers.map((marker) => (
                <Circle
                  key={marker.id}
                  id={`marker-${marker.id}`}
                  name="marker"
                  x={marker.x * DISPLAY_W}
                  y={marker.y * DISPLAY_H}
                  radius={5 / view.scale}
                  fill="#c0392b"
                  stroke="#fffdf7"
                  strokeWidth={1.5 / view.scale}
                />
              ))}
            </Layer>
          </Stage>
        </div>

        <aside className="panel">
          <section>
            <h2>操作</h2>
            <div className="buttons">
              <button disabled={busy} onClick={() => placeMarkers(50)}>
                加 50 個標記
              </button>
              <button disabled={busy} onClick={() => void run('儲存', save)}>
                儲存標記
              </button>
              <button disabled={busy} onClick={() => location.reload()}>
                重新載入
              </button>
              <button disabled={busy} onClick={clear}>
                清除
              </button>
            </div>
            <p className="hint">滾輪縮放、拖曳平移、點擊放置標記。</p>
          </section>

          <section>
            <h2>自動檢查</h2>
            <div className="buttons">
              <button
                disabled={busy}
                onClick={() => void run('A4 PDF', window.electronAPI.spike.exportPdf)}
              >
                匯出 A4 PDF
              </button>
              <button
                disabled={busy}
                onClick={() => void run('資料夾監看', window.electronAPI.spike.runWatcher)}
              >
                監看 10 檔測試
              </button>
              <button
                disabled={busy}
                onClick={() => void run('記憶體', window.electronAPI.spike.memory)}
              >
                記憶體取樣
              </button>
              <button disabled={busy} onClick={() => void window.electronAPI.spike.openOut()}>
                開啟輸出資料夾
              </button>
            </div>
          </section>

          <section>
            <h2>日誌</h2>
            <pre className="log">{log.length === 0 ? '（尚無紀錄）' : log.join('\n')}</pre>
          </section>

          <section>
            <h2>驗收條件</h2>
            <ol className="checklist">
              <li>2600×3466 開圖、400% 縮放平移順暢</li>
              <li>50 標記重開後位置一致</li>
              <li>一頁 A4 中文 PDF 不缺字、不溢頁</li>
              <li>10 檔 + sidecar 3 秒內配對</li>
              <li>連續操作記憶體 &lt; 500MB</li>
            </ol>
          </section>

          <button className="back" onClick={() => (location.href = './index.html')}>
            回主畫面
          </button>
        </aside>
      </div>
    </div>
  )
}
