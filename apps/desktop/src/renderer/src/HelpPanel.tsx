import type { JSX } from 'react'

/** 桌機版內建使用說明：覆蓋式面板，內容以實際操作流程為主。 */
export function HelpPanel({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="help-backdrop" role="presentation" onClick={onClose}>
      <section
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-label="使用說明"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="help-head">
          <h2>使用說明</h2>
          <button className="small" onClick={onClose}>
            關閉
          </button>
        </header>

        <div className="help-body">
          <h3>第一次使用</h3>
          <ol>
            <li>按「開啟資料庫」，選一個資料夾；資料庫就是這個資料夾，內容是 JSON 與圖片。</li>
            <li>在左側新增班級，填座號與姓名，勾選在學學生。</li>
            <li>在右側新增作業，選量規（均衡／內容／語言）與繳交日期。</li>
            <li>資料庫不要放在 Google Drive 等即時同步資料夾；可用「備份資料庫」備份。</li>
          </ol>

          <h3>批閱流程</h3>
          <ol>
            <li>點作業卡片，下方出現作品列表。</li>
            <li>按作品的「批閱」進入批閱畫面：左側頁面、右側評分與批注。</li>
            <li>完成後按「完成批閱」；需要時可輸出回饋單。</li>
          </ol>

          <h3>快速給分</h3>
          <ul>
            <li><strong>分項合計</strong>：輸入扣分前總分（0–100），按「分配到三項」依量規比例拆到各分項。</li>
            <li><strong>複製上一份</strong>：帶入同作業最近一份已評分作品的分項與手動扣分，不含總評、批注與狀態。</li>
            <li>畫面下方會同時顯示「扣分後總分」，與分項合計可能不同。</li>
          </ul>

          <h3>回饋單與統計</h3>
          <ul>
            <li>單份：批閱畫面的「回饋單」可預覽、列印或另存 PDF。</li>
            <li>整班：作品列表的「批次回饋單」，跳過未完成作品，輸出到資料庫的 <code>_feedback/</code>。</li>
            <li>統計：分數摘要、弱項排行、常錯字、個人弱項與 CSV 匯出。</li>
            <li>匯出成績 Excel：統計面板按「匯出成績 Excel」，不需原始 Excel，輸出到 <code>_stats/</code>（座號、姓名、分項、總分、等第、總評）。</li>
            <li>成績寫回：設定 Excel 檔與座號欄位後，輸出 graded 副本，不直接改原檔。</li>
          </ul>

          <h3>Google Drive inbox（手機掃描）</h3>
          <ol>
            <li>上方按 <strong>Drive inbox</strong> → 「設定／變更」，選 Google Drive 本機同步的 <code>inbox</code> 根目錄。</li>
            <li>先選班級，再按「產生手機 manifest」；內容含該班全部作業與在學學生座號、姓名。</li>
            <li>手機上傳後，桌機會自動匯入；來源圖片在成功匯入後刪除。</li>
            <li>無法匹配的檔案會移到 <code>inbox/_unmatched</code>，可用「未匹配照片」手動指定學生。</li>
          </ol>

          <h3>手機掃描器</h3>
          <ol>
            <li>安裝 <code>EssayGrader-Scanner</code> APK，開啟後選 Drive 的 <code>inbox</code> 根目錄。</li>
            <li>按「重新讀取 manifest」，選班級、作業、學生。</li>
            <li>按「開始掃描」拍照；完成後在方向確認選 0°／90°／180°／270° 的正立縮圖。</li>
            <li>按「上傳」。沒有網路時會留在「待上傳」，恢復後按「重新上傳待上傳」。</li>
          </ol>

          <h3>備份、還原與日誌</h3>
          <ul>
            <li>「備份資料庫」會產生 zip；「還原備份」會先要求空的目的地，避免覆蓋使用中的資料。</li>
            <li>「開啟日誌」可看執行紀錄；日誌不包含學生姓名、總評或批注內容。</li>
          </ul>

          <h3>注意事項</h3>
          <ul>
            <li>同一個資料庫不要同時在兩台電腦開啟（有 lock 保護，但仍應避免）。</li>
            <li>Google Drive for desktop 可能在上傳後鎖住大圖數分鐘；來源刪除失敗會顯示警告並保留 sidecar，可稍後手動清除。</li>
            <li>manifest 是產生當下的快照；新增作業或改名單後要重新產生，手機也要重新讀取。</li>
          </ul>

          <h3>疑難排解</h3>
          <ul>
            <li><strong>Drive inbox 找不到</strong>：先選作業才會在舊位置出現；現在也可從上方「Drive inbox」直接開啟。</li>
            <li><strong>手機讀不到 manifest</strong>：確認選的是 <code>inbox</code> 根目錄；必要時用「選擇 manifest.json」直接指定檔案。</li>
            <li><strong>資料庫被另一台電腦鎖住</strong>：確認該電腦已關閉程式，再刪除資料夾內的 <code>.essay-grader.lock</code>。</li>
            <li><strong>手機上傳失敗</strong>：確認 Wi-Fi、Google Drive 同步狀態；失敗的掃描會留在待上傳。</li>
          </ul>

          <p className="help-footnote">
            完整說明與版本限制見專案內的 <code>docs/使用說明.md</code>。
          </p>
        </div>
      </section>
    </div>
  )
}
