import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  logsOpened: boolean
}

/**
 * React 端的最後一道防線：元件樹出錯時保留可操作畫面。
 * 只記錄錯誤名稱與訊息，不記錄任何作品、名單或評語內容。
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, logsOpened: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const message = `${error.name}: ${error.message}`.slice(0, 800)
    void window.electronAPI?.logs
      .write('error', `React ErrorBoundary：${message}`)
      .catch(() => undefined)
    if (info.componentStack) {
      void window.electronAPI?.logs
        .write('error', `React component stack：${info.componentStack.slice(0, 800)}`)
        .catch(() => undefined)
    }
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleOpenLogs = (): void => {
    void window.electronAPI?.logs
      .open()
      .then(() => this.setState({ logsOpened: true }))
      .catch(() => this.setState({ logsOpened: false }))
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash-screen">
        <div className="crash-card">
          <p className="eyebrow">Essay Grader</p>
          <h1>畫面發生未預期的錯誤</h1>
          <p>資料仍在原本的資料夾，不會因為這個錯誤被刪除。可以先重新載入；若持續發生，請開啟日誌資料夾。</p>
          <pre className="crash-detail">{error.message || '未知錯誤'}</pre>
          <div className="crash-actions">
            <button className="primary" onClick={this.handleReload}>
              重新載入
            </button>
            <button onClick={this.handleOpenLogs}>開啟日誌資料夾</button>
          </div>
          {this.state.logsOpened && <p className="muted small-text">已開啟日誌資料夾。</p>}
          <p className="muted small-text">
            日誌只記錄事件與錯誤訊息，不含學生姓名、總評、批注全文或圖片內容。
          </p>
        </div>
      </div>
    )
  }
}
