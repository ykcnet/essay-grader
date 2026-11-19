import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { FeedbackSheet } from '@essay-grader/core'
import './feedback.css'

declare global {
  interface Window {
    /** 供 main 的 PDF 匯出判斷版面是否已量測完成 */
    __feedbackReady?: boolean
    /** 最小字級仍超過一頁 */
    __feedbackOverflow?: boolean
    /** 資料載入失敗時的原因，避免匯出成錯誤頁 */
    __feedbackFailed?: string
  }
}

type Density = 'normal' | 'compact' | 'tiny'
type Busy = '' | 'export' | 'save' | 'print'
type Notice = { kind: 'ok' | 'error' | 'info'; text: string }

const params = new URLSearchParams(window.location.search)
const context = {
  classId: params.get('classId') ?? '',
  assignmentId: params.get('assignmentId') ?? '',
  seat: params.get('seat') ?? ''
}
const hasContext = Boolean(context.classId && context.assignmentId && context.seat)

/** 沒有帶參數時顯示範例版面（Spike 的 PDF 檢查也會用到）。 */
const DEMO: FeedbackSheet = {
  classId: 'C302-2025F',
  className: '國中302',
  teacher: '王老師',
  seat: '07',
  name: '王小明',
  title: '我的母親',
  gradedAt: '2026-11-19',
  score: {
    items: [
      { id: 'content', name: '內容與思想', score: 32, max: 40 },
      { id: 'structure', name: '結構與組織', score: 24, max: 30 },
      { id: 'language', name: '語言與表達', score: 25, max: 30 }
    ],
    itemsTotal: 81,
    typoDeduction: 3.5,
    punctDeduction: 0,
    override: null,
    deduction: 3.5,
    cap: 10,
    total: 77.5,
    grade: 'B++'
  },
  comment:
    '取材真切，母親的形象清楚，能從生活細節寫出情感。文中「魑魅魍魎」「鸚鵡」「朦朧」等詞使用正確，可見平日閱讀累積。若能多寫一個具體事件，並在結尾收回前文的伏筆，情感會更有層次。整體結構完整，段落之間略缺過渡，建議下次先列出事件順序再下筆。',
  typos: [
    { wrong: '在', correct: '再', count: 2 },
    { wrong: '的', correct: '得', count: 1 },
    { wrong: '以', correct: '已', count: 1 },
    { wrong: '做', correct: '作', count: 1 },
    { wrong: '即', correct: '既', count: 1 },
    { wrong: '帘', correct: '簾', count: 1 }
  ],
  rewrites: [
    {
      original: '我因為下雨的關係所以沒有去學校。',
      revised: '因為下雨，我沒有去學校。',
      reason: '刪去冗贅的因果連接詞'
    },
    {
      original: '她總是把最好的東西留給我們吃。',
      revised: '她總是把最好的東西留給我們。',
      reason: '「留給我們吃」語意重複'
    },
    {
      original: '這件事情讓我感到非常地開心與快樂。',
      revised: '這件事讓我十分開心。',
      reason: '避免同義詞堆疊'
    }
  ],
  praises: [
    '「母親的手像一張舊地圖，每一道紋路都指著回家的方向。」— 比喻新鮮，畫面清楚。',
    '「雨停的時候，她才把傘收起來，彷彿把整個下午也收進口袋。」— 動作與情緒扣合。'
  ],
  counts: { typos: 7, sentences: 3, structures: 1, praises: 2 },
  truncated: { typos: false, rewrites: false, praises: false }
}

const format = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1)

const errorText = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

interface ExportResult {
  path: string
  pages: number
  bytes: number
  ms: number
  fileName: string
}

/**
 * 依序套用 normal → compact → tiny，量測固定 A4 高度是否容得下。
 * 直接改 DOM 的 data-density 是為了在同一次更新內完成三次量測，
 * 避免 React state 非同步造成畫面閃動。
 */
function fitSheet(element: HTMLElement): { density: Density; overflow: boolean } {
  const densities: Density[] = ['normal', 'compact', 'tiny']

  for (const density of densities) {
    element.dataset.density = density
    if (element.scrollHeight <= element.clientHeight + 1) {
      return { density, overflow: false }
    }
  }

  return { density: 'tiny', overflow: true }
}

export default function Feedback(): JSX.Element {
  const [sheet, setSheet] = useState<FeedbackSheet | null>(hasContext ? null : DEMO)
  const [error, setError] = useState('')
  const [density, setDensity] = useState<Density>('normal')
  const [overflow, setOverflow] = useState(false)
  const [busy, setBusy] = useState<Busy>('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [exported, setExported] = useState<ExportResult | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasContext) return
    let cancelled = false
    window.__feedbackFailed = ''

    if (!window.electronAPI?.feedback) {
      const reason = '找不到 feedback API，請從程式內開啟回饋單'
      setError(reason)
      window.__feedbackFailed = reason
      window.__feedbackOverflow = false
      window.__feedbackReady = true
      return
    }

    window.electronAPI.feedback
      .load(context.classId, context.assignmentId, context.seat)
      .then((result) => {
        if (!cancelled) setSheet(result as FeedbackSheet)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        const reason = errorText(loadError)
        setError(reason)
        window.__feedbackFailed = reason
        window.__feedbackOverflow = false
        window.__feedbackReady = true
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    window.__feedbackReady = false
    if (!sheet || !sheetRef.current) return

    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        await document.fonts.ready
      } catch {
        // 字型 API 不可用時仍可量測
      }

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (cancelled) return

      const element = sheetRef.current
      if (!element) return

      const result = fitSheet(element)
      setDensity(result.density)
      setOverflow(result.overflow)
      window.__feedbackOverflow = result.overflow

      requestAnimationFrame(() => {
        if (!cancelled) window.__feedbackReady = true
      })
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [sheet])

  const runAction = async (kind: Busy, action: () => Promise<Notice | null>): Promise<void> => {
    setBusy(kind)
    setNotice(null)
    try {
      const next = await action()
      if (next) setNotice(next)
    } catch (actionError) {
      setNotice({ kind: 'error', text: errorText(actionError) })
    } finally {
      setBusy('')
    }
  }

  const handleExport = (): void => {
    if (!hasContext) return
    void runAction('export', async () => {
      const result = (await window.electronAPI.feedback.exportPdf(
        context.classId,
        context.assignmentId,
        context.seat
      )) as ExportResult
      setExported(result)
      return {
        kind: 'ok',
        text: `已匯出 ${result.fileName}（${result.pages} 頁，${Math.round(result.bytes / 1024)} KB）`
      }
    })
  }

  const handleSaveAs = (): void => {
    if (!hasContext) return
    void runAction('save', async () => {
      const result = (await window.electronAPI.feedback.saveAs(
        context.classId,
        context.assignmentId,
        context.seat
      )) as ({ canceled: true } | { canceled: false } & ExportResult)

      if (result.canceled) return null
      setExported(result)
      return {
        kind: 'ok',
        text: `已另存 ${result.fileName}（${result.pages} 頁，${Math.round(result.bytes / 1024)} KB）`
      }
    })
  }

  const handlePrint = (): void => {
    if (!hasContext) {
      window.print()
      return
    }

    void runAction('print', async () => {
      const result = (await window.electronAPI.feedback.print()) as {
        success: boolean
        reason?: string
      }
      return result.success
        ? { kind: 'ok', text: '已送出列印' }
        : { kind: 'error', text: `列印失敗：${result.reason ?? '未知原因'}` }
    })
  }

  const score = sheet?.score
  const hasTypos = Boolean(sheet && sheet.typos.length > 0)
  const hasPraises = Boolean(sheet && sheet.praises.length > 0)
  const twoCol = hasTypos && hasPraises

  return (
    <div className="feedback-root">
      {hasContext && (
        <div className="toolbar">
          <div className="toolbar-title">
            <strong>回饋單預覽</strong>
            <span>{sheet ? `S${sheet.seat} ${sheet.name} · ${sheet.title}` : '載入中…'}</span>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => void handlePrint()} disabled={!sheet || busy !== ''}>
              {busy === 'print' ? '列印中…' : '列印'}
            </button>
            <button onClick={handleExport} disabled={!sheet || busy !== ''}>
              {busy === 'export' ? '匯出中…' : '匯出 PDF'}
            </button>
            <button className="primary" onClick={handleSaveAs} disabled={!sheet || busy !== ''}>
              {busy === 'save' ? '另存中…' : '另存 PDF…'}
            </button>
            <button className="ghost" onClick={() => window.close()}>
              關閉
            </button>
          </div>
          <div className="toolbar-status">
            {exported ? (
              <>
                <span title={exported.path}>{exported.fileName}</span>
                <button
                  className="link"
                  onClick={() => void window.electronAPI.feedback.reveal(exported.path)}
                >
                  開啟資料夾
                </button>
              </>
            ) : (
              <span>PDF 會存到學生資料夾</span>
            )}
          </div>
        </div>
      )}

      {overflow && (
        <div className="banner banner--error">
          內容超過一頁，已自動縮到最小字級仍放不下；請縮短總評或減少批注。PDF 匯出已停用。
        </div>
      )}
      {notice && <div className={`banner banner--${notice.kind}`}>{notice.text}</div>}
      {error && <div className="banner banner--error">無法載入回饋單：{error}</div>}

      {!sheet ? (
        <div className="stage">
          <p className="loading">載入回饋單…</p>
        </div>
      ) : (
        <div className="stage">
          <div className="sheet" ref={sheetRef} data-density={density}>
            <header className="head">
              <div>
                <p className="school">
                  {sheet.className} · 作文批閱
                  {sheet.teacher ? ` · ${sheet.teacher}` : ''}
                </p>
                <h1>作文回饋單</h1>
              </div>
              <table className="meta">
                <tbody>
                  <tr>
                    <th>座號</th>
                    <td>{sheet.seat}</td>
                    <th>姓名</th>
                    <td>{sheet.name}</td>
                  </tr>
                  <tr>
                    <th>題目</th>
                    <td colSpan={3}>{sheet.title}</td>
                  </tr>
                  <tr>
                    <th>日期</th>
                    <td>{sheet.gradedAt}</td>
                    <th>批閱</th>
                    <td>{sheet.teacher ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </header>

            <section className="score-row">
              <div className="score">
                <span className="score-value">{format(score?.total ?? 0)}</span>
                <span className="score-max">/ 100</span>
              </div>
              <div className="grade">
                <span className="grade-label">等第</span>
                <span className="grade-value">{score?.grade ?? '—'}</span>
              </div>
              <div className="deduction">
                <span>
                  錯字 {sheet.counts.typos} 處 · 扣 {format(score?.typoDeduction ?? 0)}
                </span>
                {(score?.punctDeduction ?? 0) > 0 && (
                  <span>標點扣 {format(score?.punctDeduction ?? 0)}</span>
                )}
                {score?.override !== null && score?.override !== undefined && (
                  <span>手動覆寫扣 {format(score.override)}</span>
                )}
                <span>扣分上限 {format(score?.cap ?? 0)}</span>
              </div>
            </section>

            <section>
              <h2>分項評分</h2>
              <table className="items">
                <tbody>
                  {score?.items.map((item) => {
                    const percent = item.max > 0 ? (item.score / item.max) * 100 : 0
                    return (
                      <tr key={item.id}>
                        <th>{item.name}</th>
                        <td className="bar">
                          <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                        </td>
                        <td className="num">
                          {format(item.score)} / {item.max}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>

            {sheet.comment.trim() && (
              <section>
                <h2>總評</h2>
                <p className="comment">{sheet.comment}</p>
              </section>
            )}

            {sheet.rewrites.length > 0 && (
              <section>
                <h2>詞句批改</h2>
                <ul className="rewrites">
                  {sheet.rewrites.map((item, index) => (
                    <li key={`${item.original}-${item.revised}-${index}`}>
                      <p className="original">
                        <span className="tag tag--before">原句</span>
                        {item.original || <span className="muted">（紙本未記錄原句）</span>}
                      </p>
                      <p className="revised">
                        <span className="tag tag--after">建議</span>
                        {item.revised}
                        {item.reason && <span className="reason">（{item.reason}）</span>}
                      </p>
                    </li>
                  ))}
                </ul>
                {sheet.truncated.rewrites && (
                  <p className="truncated">
                    僅列前 {sheet.rewrites.length} 句；其他批注請見批閱畫面。
                  </p>
                )}
              </section>
            )}

            {(hasTypos || hasPraises) && (
              <section className={twoCol ? 'two-col' : 'two-col two-col--single'}>
                {hasTypos && (
                  <div>
                    <h2>常錯字</h2>
                    <table className="typos">
                      <thead>
                        <tr>
                          <th>錯字</th>
                          <th>正確</th>
                          <th>次數</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.typos.map((item) => (
                          <tr key={`${item.wrong}-${item.correct}`}>
                            <td className="wrong">{item.wrong || '—'}</td>
                            <td className="correct">{item.correct || '—'}</td>
                            <td className="num">{item.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="truncated">
                      {sheet.truncated.typos
                        ? `僅列最常出現的 ${sheet.typos.length} 種；`
                        : ''}
                      本份共 {sheet.counts.typos} 處錯字。
                    </p>
                  </div>
                )}

                {hasPraises && (
                  <div>
                    <h2>佳句</h2>
                    <ul className="praise">
                      {sheet.praises.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                    {sheet.truncated.praises && (
                      <p className="truncated">
                        僅列前 {sheet.praises.length} 句；其他佳句請見批閱畫面。
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            {!hasTypos && !hasPraises && sheet.rewrites.length === 0 && (
              <section>
                <h2>批注摘要</h2>
                <p className="comment">
                  本份沒有記錄錯字、詞句改寫或佳句；回饋以總評與分項評分為主。
                </p>
              </section>
            )}

            <footer className="foot">
              <span>
                錯字 {sheet.counts.typos} 處 · 語句 {sheet.counts.sentences} 處 · 結構{' '}
                {sheet.counts.structures} 處
              </span>
              <span>Essay Grader · 一頁 A4 回饋單</span>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
