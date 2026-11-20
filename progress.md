# Essay Grader — Progress

> 最後更新：2026-11-20
> 階段：**M0–M7＋Google Drive 外部 inbox＋E6 成績寫回＋未匹配照片手動分配＋F2 整班批次回饋單完成；下一步 M8 手機**

---

## 一、檔案

| 檔案 | 內容 |
|---|---|
| `features.md` | 功能清單 77 項，含優先級與不做清單 |
| `comment-library-senior.md` | 內建評語 126 條，含更新與輪替機制 |
| `plan.md` | 製作方案：技術棧比較、架構、資料模型、里程碑、風險 |
| `progress.md` | 本檔，記錄決策與待辦 |
| `icon.png` | 應用程式圖示 1024×1024 |
| `app.ico` | Windows 圖示，內含 8 種尺寸 |
| `icon-*.png` / `assets/android/**` | 各平台尺寸（含 Android 五種 mipmap） |
| `ref.png` | 紅圈筆跡參考圖，描線來源 |
| `tools/make_icon.py` | 圖示產生器，可重跑；`--preview` 只寫到 `preview\` |
| `tools/trace_circle.py` | 由 `ref.png` 取出紅色筆畫中心線 → `tools/circle_path.json` |
| `tools/make_fixture_pages.ps1` | 產生 fixtures 的 1200×1600 測試頁面 |
| `tools/make_spike_page.ps1` | 產生 Spike 的 2600×3466 測試頁面 |
| `apps/desktop/src/main/spike/` | Spike 自動檢查：Canvas、PDF、監看、記憶體 |
| `apps/desktop/src/main/data/` | M1 資料層：原子寫入、`.bak` 還原、鎖、repository、IPC；M3–M7 驗收 |
| `packages/core/src/audit.ts` | M4 作業層級批次檢查純函式（未匯入、總評不足、重複、未評分、缺頁） |
| `apps/desktop/src/main/data/m4-check.ts` | M4 驗收：45 人、44 份作品的批次檢查與 UI 煙霧 |
| `packages/core/src/feedback.ts` | M5 回饋單 view model：分項、扣分、錯字聚合、詞句改寫、佳句、檔名規則 |
| `apps/desktop/src/main/feedback/` | M5 回饋單預覽視窗、單份 PDF（隱藏視窗＋printToPDF）、列印、另存 |
| `apps/desktop/src/main/data/m5-check.ts` | M5 驗收：資料推導、檔名、單頁 PDF、溢頁阻擋與 UI 煙霧 |
| `packages/core/src/stats.ts` | M6 統計純函式：分數摘要、G1 弱項排行、G2 常錯字、G3 個人前三、CSV 四檔 |
| `apps/desktop/src/main/data/m6-check.ts` | M6 驗收：統計範圍、G1／G2／G3、CSV 內容與 UI 煙霧、統計截圖 |
| `apps/desktop/src/renderer/src/App.tsx`（StatsPanel） | M6 統計面板：摘要、等第／分項平均、G1／G2／G3、匯出 CSV、開啟資料夾 |
| `apps/desktop/src/main/data/backup.ts` | M7 備份／還原：archiver 相對路徑 zip、排除 lock／tmp、yauzl 串流解壓、zip slip 與非空目的地防護 |
| `apps/desktop/src/main/logger.ts` | M7 主程序日誌：時間／level、2 MB 輪替、未捕捉例外與 renderer crash、開啟日誌資料夾 |
| `apps/desktop/src/main/data/m7-check.ts` | M7 驗收：備份內容、還原可讀、zip slip、日誌輪替與敏感內容、UI API、打包設定 |
| `apps/desktop/src/renderer/src/ErrorBoundary.tsx` | M7 React 錯誤邊界：友善畫面、重新載入、開啟日誌，不讓視窗空白 |
| `apps/desktop/electron-builder.yml` | M7 打包：appId、NSIS／portable、asar、sharp asarUnpack、ASCII 產物名稱 |
| `docs/使用說明.md` | M7 使用者說明：安裝／portable、資料庫、匯入、批閱、評分、回饋單、統計、備份、日誌、隱私與 FAQ |
| `tools/fix-m-drive.ps1` | 把專案所在磁碟區固定為 `M:`；需系統管理員，已在目前主機驗證 |
| `apps/desktop/src/main/import/` | M2 匯入：inbox watcher、sidecar 配對、去重、Excel 名單、sharp 前處理；Drive 外部 inbox watcher 與驗收 |
| `apps/desktop/src/main/import/external.ts` | Google Drive 外部 inbox：遞迴監看、子資料夾／扁平路由、grace、PDF 擋下、去重、來源清理與 `_unmatched`／`_duplicates` |
| `apps/desktop/src/main/import/drive-check.ts` | Drive 驗收：兩種擺法、sidecar 優先、PDF、錯誤路徑、設定持久化與 UI 煙霧 |
| `apps/desktop/src/main/import/unmatched.ts` | 未匹配照片：內外清單、`.meta.json` 解析、320px 縮圖、路徑 realpath 防護、複製到 `_inbox` 與來源清理 |
| `apps/desktop/src/main/import/match-check.ts` | 未匹配照片驗收：meta／reason、舊檔、縮圖、指定 3 張頁序、去重、拒絕情境與 UI 煙霧 |
| `apps/desktop/src/main/feedback/batch.ts` | F2 整班批次：逐份輸出、跳過未完成、單份失敗不中斷、進度／取消、`_feedback/` 中文檔名與 JSON／CSV 報告 |
| `apps/desktop/src/main/feedback/batch-check.ts` | F2 驗收：5 人輸出／跳過／溢頁失敗、報告、進度順序、取消、重複啟動與 UI 煙霧 |
| `apps/desktop/src/renderer/src/App.tsx`（BatchFeedbackPanel） | F2 批次面板：已批／未完成、輸出位置、開始／取消／開啟資料夾、進度條與明細表 |
| `apps/desktop/src/renderer/src/review/` | M3 三欄式批閱介面：Konva 縮放平移、五類批注、評語庫、評分、總評、autosave |
| `apps/desktop/src/renderer/src/feedback/` | M5 一頁 A4 回饋單：真實資料、密度調整、列印工具列 |
| `apps/desktop/src/renderer/src/spike/` | 手動驗證頁（縮放、標記、日誌） |
| `apps/desktop/` | Electron + React + TypeScript（M0 可啟動殼） |
| `packages/core/` | zod schema、資料夾命名、匯入忽略規則 |
| `fixtures/` | 3 位學生 × 2 頁，含 D25 詞句改寫範例 |
| `README.md` | 專案入口與指令 |

---

## 二、已定案決策

| # | 項目 | 決定 |
|---|---|---|
| 1 | 使用對象 | 國中、高中職（國中版評語庫暫緩） |
| 2 | 使用型態 | 校內教師個人使用，**無學生帳號** |
| 3 | 主要場景 | **紙本為主**，拍照後數位批閱 |
| 4 | 裝置 | Windows 桌機批閱 ＋ Android 手機掃描 |
| 5 | 批注方式 | 定位標記 ＋ 打字評語（**不做手寫塗鴉**） |
| 6 | 跨裝置 | Local-first：資料夾即資料庫，雲端僅搬檔 |
| 7 | 名單 | Excel 匯入 ＋ 可手動增修 |
| 8 | 評分 | 分項評分＋總分；量規預設均衡／內容導向／語言導向，舊國中／高中／高職 id 保留為別名 |
| 9 | 批注類型 | 五類固定（錯字／語句／結構／佳句／評語）＋可自訂 |
| 10 | 批閱動線 | 佇列式，批完自動跳下一份 |
| 11 | 回饋單 | 一頁 A4：分數＋總評＋錯誤統計＋佳句（不印原圖） |
| 12 | 統計 | 弱項排行＋常錯字表＋個人弱項＋與上次比較 |
| 13 | 手機端 | 智能掃描器（自動裁切、多頁合併、依座號命名） |
| 14 | 評語字數 | **只有總評 ≥30 字**，其餘不設限 |
| 15 | 重複檢查 | 總評同批上限 2 次、第 3 次阻擋；其餘僅提示 |
| 16 | 圖示 | 深藍底＋米白作文紙＋紅筆勾＋手寫紅圈；紅圈由 `ref.png` 描中心線重繪，非另行手繪 |
| 17 | 圖示尺寸策略 | 48 以上保留紅圈（線寬依尺寸補償），32／16 用無圈簡化版；縮圖加 `reducing_gap` 避免鋸齒 |
| 18 | 施工順序 | **先桌機批閱，手機掃描後補**（2026-11-19） |
| 19 | 最低系統 | **Windows 10 22H2 以上（x64）**（2026-11-19） |
| 20 | 桌機技術棧 | **Electron + React + TypeScript（2026-11-19 定案）**；不採 Flutter／Tauri／WPF |
| 21 | 手機技術棧 | **Kotlin + ML Kit Document Scanner**（第二階段；只寫 `_inbox`，不寫資料庫） |
| 22 | Excel 成績登錄 | **讀既有 `.xlsx`，依座號寫入指定欄，另存副本、原檔不動**；失敗可退回匯出新檔 |
| 23 | 不採 Flutter 的理由 | 手機只負責拍照上傳，共用程式碼的效益低於桌機 PDF／UI 成本 |
| 24 | 詞句不通順批改 | **標記句子範圍＋輸入建議改寫**；存 `original`／`revised`，回饋單顯示前後對照 |
| 25 | Spike 結果（2026-11-19） | Canvas 400% 60fps、50 標記位移 0、A4 PDF 1 頁、監看 373ms、private 343MB，**全數通過** |
| 26 | 離屏視窗 | Spike 用「螢幕外可見視窗＋關閉背景節流」量 FPS；正式功能不需此設定 |
| 27 | M1 儲存策略 | 主檔＋`.bak`＋`.tmp` → fsync → rename；壞檔自動從 `.bak` 還原並修復主檔 |
| 28 | M1 資料庫鎖 | `.essay-grader.lock`（pid＋host）；同機殘留鎖自動接手，跨機或同機活躍程式擋下 |
| 29 | 量規預設值 | 三組：均衡 40／30／30、內容 45／25／30、語言 35／30／35；扣分皆 0.5／0.5、上限 10；**數值仍待老師確認** |
| 30 | M1 驗收 | `npm run m1:check` 11/11 通過（含壞檔還原、鎖、主畫面渲染） |
| 31 | M2 監看 | chokidar 輪詢 250ms＋檔案穩定 400ms；10 檔平均 1.1 秒完成 |
| 32 | 配對規則 | 以 sidecar 為準；缺 sidecar 或座號不在名單 → `_unmatched` |
| 33 | 去重 | SHA-256 比對同作業所有 work；重複檔移到 `_duplicates` |
| 34 | 匯入結果 | 新 work 為 `pending`；多頁依 seq 依序 append，座號對應 `S{seat}` |
| 35 | Excel 名單 | exceljs；自動找「座號／姓名」表頭、座號補零、同座號更新姓名 |
| 36 | M2 驗收 | `npm run m2:check` 13/13 通過 |
| 37 | M3 圖片前處理 | sharp：EXIF 轉正、移除中繼資料、長邊上限 2600、JPEG q85、另存 600px WebP 縮圖；關閉 mozjpeg 讓 10 檔匯入維持 1.9 秒 |
| 38 | M3 批閱介面 | 主畫面佇列每列加「批閱」，以 state 切換三欄式：左作品佇列、中 Konva 畫布、右批注／評語庫／評分／總評 |
| 39 | M3 畫布操作 | 滾輪縮放 0.2–8、拖曳平移、PageUp／PageDown 翻頁、點畫布建立 0–1 正規化錨點 |
| 40 | M3 批注 | 五類快捷鍵 1–5；sentence 顯示 D25 `original`／`revised`／`reason`；id 用 UUID、時間用 ISO |
| 41 | M3 儲存策略 | 批注／分數／總評變更後 600ms debounce `work:save`；切換作品或離開前 flush；pending 開啟即改 grading |
| 42 | M3 復原 | Ctrl+Z／Ctrl+Y 只涵蓋 annotations，最多 100 步；同一欄位 800ms 內連續輸入合併為一步 |
| 43 | M3 重複檢查 | 總評輸入時查 `work:reuse`；達 `final_max_reuse` 顯示紅字並由 `validateWork` 阻止完成 |
| 44 | M3 驗收 | `npm run m3:check` 25/25 通過；m1 11/11、m2 13/13（約 2 秒） |
| 45 | 建立作業選量規 | `CreateAssignmentForm` 可選均衡／內容導向／語言導向，預設均衡，選單下方即時顯示三項配分；`assignment.json` 寫入對應 preset 數值 |
| 46 | 評分前調整量規 | 批閱「評分」區上方顯示配分與扣分規則；可改 preset、三項滿分、錯字／標點扣分與上限。合計須為 100，由 main 以 `RubricSchema` 驗證後原子寫回 `assignment.json` |
| 47 | 量規變更規則 | 已有 work 帶 `scores` 或 `status === 'done'` 時先確認（顯示份數）；只影響之後的計算，不改寫既有 `scores`；目前這份預覽用新量規重算，完成批閱才落盤 |
| 48 | 等第門檻編輯 | 評分前「調整量規」可新增／刪除等第、改名稱與最低分；載入時顯示該作業現有 grades，並即時預覽目前總分落在哪一級；儲存成功後更新本地 assignment 並用新門檻重算預覽 |
| 49 | 等第驗證規則 | 至少一筆；名稱去空白後不可空白、不可重複；最低分須為 0–100 數字且不可重複；儲存時由高到低排序。UI 與 main 共用 core 的 `validateGradeBands`／`sortGradeBands`，後端錯誤為繁體中文 |
| 50 | 等第變更與既有分數 | 更新 grades 只改 `assignment.json`，不重算也不改寫任何 `work.json` 的 `scores`（含舊等第）；要套用新門檻需重新完成該份批閱 |
| 51 | 批次檢查範圍 | 以一份作業為範圍、只掃在學學生；規則：未匯入、總評不足、總評重複超限、未評分、缺頁檔案、尚未完成 |
| 52 | 重複超限順序 | 同作業相同正規化總評依座號排序，前 `final_max_reuse` 次合法，之後才標記；只標超限者，不是整組都錯 |
| 53 | 尚未完成的定位 | `pending`／`grading` 列為提醒（不阻擋、不影響「乾淨」旗標）；`status === 'done'` 才算完成 |
| 54 | 批次檢查 UI | 匯入佇列面板加「批次檢查」，結果用同卡片面板呈現；可切「只看有問題／全部」、重新檢查、前往批閱；從批閱返回會自動重查 |
| 55 | 量規預設 | 新作業未指定時一律用均衡版（`balanced-default`，40／30／30）；建立表單預設也是均衡版，之後可再調整 |
| 56 | M4 驗收 | `npm run m4:check` 17/17：45 人在學、44 份作品、問題 14／提醒 11、重複只標第 3 份、缺頁與未匯入皆抓到，檢查約 32 ms |
| 57 | 回饋單資料來源 | 由 `class.json`＋`assignment.json`＋`work.json` 即時推導，不另存；分數與等第用 `done` 當下的 `work.scores` 快照，避免量規事後變更影響已批結果 |
| 58 | 回饋單內容 | 一頁 A4 只印：分數／等第／扣分、分項、總評、詞句前後對照、常錯字統計、佳句；**不印原圖** |
| 59 | 回饋單摘要上限 | 錯字 12 種、詞句 6 句、佳句 4 句；超出只截顯示，`work.json` 完整保留，版面另註「僅列前 N 筆」 |
| 60 | 回饋單溢頁 | 依序套 normal（10pt）→ compact（9.2pt）→ tiny（8.4pt）；最小字級仍超過 297mm 就標示溢頁並**阻擋 PDF 匯出**，不產生被裁切的檔 |
| 61 | 回饋單 PDF | 隱藏 BrowserWindow 載入同一個 React 版面，`printToPDF` A4、0 邊界、`preferCSSPageSize`；產生後數頁數，必須為 1 頁才寫檔 |
| 62 | 回饋單檔名 | 程式用固定 `S{座號}_feedback.pdf`，存在學生資料夾；另存用中文 `{班級}_{題目}_S{座號}_{姓名}_回饋單_{日期}.pdf`，Windows 非法字元換底線 |
| 63 | 回饋單入口 | 匯入佇列只有 `done` 的列顯示「回饋單」；批閱畫面右下角也有按鈕。預覽工具列提供列印、匯出 PDF、另存 PDF、開啟資料夾 |
| 64 | M5 驗收 | `npm run m5:check` 19/19：資料與錯字聚合、檔名清洗、1 頁 150 KB／約 360 ms、JhengHei 子集、超長內容與未完成批閱皆被擋、預覽視窗可開啟且重用、UI 煙霧 |
| 65 | M6 統計範圍 | 只計 `status === 'done'` 的作品；`pending`／`grading` 與未匯入仍列在個人表，但標示「不計入」，不影響班級摘要與排行 |
| 66 | G1 弱項排行 | 以「類別＋子類」為一列，依次數排序；佔比分母為**全部弱項批注總數**（不含佳句與一般評語），另顯示涉及人數 |
| 67 | G2 常錯字 | 跨學生聚合 `meta.wrong`／`meta.correct`，同一組錯字合併次數並列出座號；未填結構化欄位的錯字不進常錯字表 |
| 68 | G3 個人弱項 | 每人取次數最多的前三項弱項；未完成或未匯入不顯示弱項，避免把批閱中的資料當成結果 |
| 69 | CSV 格式 | 固定四檔：`scores.csv`、`weakness-ranking.csv`、`common-typos.csv`、`student-weakness.csv`；UTF-8 BOM＋CRLF，Excel 可直接開，逗號與引號正確轉義 |
| 70 | CSV 位置 | 寫在該作業資料夾的 `_stats/`，重新匯出覆寫同名檔；不寫入資料庫根目錄 |
| 71 | M6 驗收 | `npm run m6:check` 17/17：6 人、5 份作品、4 份 `done`、13 個弱項、在→再×3、平均 81、四份 CSV、統計 UI 與截圖 |
| 72 | 跨裝置搬檔 | **Google Drive 本機同步資料夾**：只作為外部 inbox，資料庫與 `work.json` 不進雲端 |
| 73 | 外部 inbox 擺法 | 支援子資料夾 `<root>/<classId>/<assignmentId>/`（建議）與扁平 `<root>/`；扁平模式必須有 sidecar |
| 74 | 外部座號來源 | 有 sidecar 用 sidecar 的 seat；無 sidecar 只接受 `S07…`、`S07_…`、`S07-…`、`S07 …` 或開頭正好 `07`，其餘不猜 |
| 75 | 外部監看參數 | chokidar 遞迴、輪詢 500ms、`awaitWriteFinish` 1500ms；圖片與 sidecar 先後到達等 2500ms grace |
| 76 | 外部失敗處理 | 重複檔移到根目錄 `_duplicates/`；失敗移到 `_unmatched/` 並附 `.reason.txt`；PDF 明確標示不支援 |
| 77 | 外部成功清理 | 寫入本機 `work.json` 後刪除 Drive 來源圖片與 sidecar，作品不長期留在雲端 |
| 78 | 外部狀態 | `ImportStatus` 增加 `externalRoot`／`externalWatching`／`externalError`；事件加 `source: 'drive'`，訊息以「Drive：」開頭 |
| 79 | 外部設定 | `settings.json` 增加 `externalInboxRoot`；設定／清除立即套用，重開保留；資料夾選擇器只在 UI 層，核心流程可直接指定路徑 |
| 80 | Drive 驗收 | `npm run drive:check` 23/23：兩種擺法、sidecar 優先、去重、PDF、錯誤路由、根目錄不存在、設定持久化、UI 與 preload API |
| 81 | 批次輸出範圍 | 只處理 `done` 且有分數的作品；`pending`／`grading`／已批未評分列為 skipped，單份溢頁或錯誤列為 failed，皆不中斷整批；依座號逐份處理 |
| 82 | 批次輸出位置 | 保留 `S{座號}/S{座號}_feedback.pdf`；另複製到作業資料夾 `_feedback/S{座號}_{姓名}_回饋單.pdf`，姓名空白退回 `S{座號}_回饋單.pdf`，沿用 `sanitizeFileName` |
| 83 | 批次報告 | `_feedback/report.json` 與 `report.csv`（UTF-8 BOM＋CRLF），含 generatedAt、總數、成功／跳過／失敗／取消、每筆座號／姓名／狀態／路徑／原因／耗時；重跑覆蓋同名檔 |
| 84 | 批次進度與取消 | 每份完成送 `feedback:batch-progress`（jobId、index／total、seat／name、status、message、completed）；同一時間僅一個批次；取消在下一份前停止，其餘標 cancelled 並回完整報告 |
| 85 | F2 驗收 | `npm run batch:check` 17/17：3 輸出、1 跳過、1 溢頁失敗、1 頁 PDF 135–136 KB、中文檔名與報告一致、進度順序、取消、重複啟動與 UI 煙霧 |

---

## 三、規模

| 優先級 | 項數 |
|---|---|
| P0（第一版） | 39 |
| P1（第二版） | 22 |
| P2（選配） | 16 |
| **合計** | **77** |

**核心主線**：拍照匯入 → 批注 → 評分 → 輸出回饋單

---

## 四、資料夾結構（已定案）

```
essay-grader-data/
  C302-2025F/
    class.json
    E20250107/
      assignment.json
      S07/
        p1.jpg
        p2.jpg
        work.json
        S07_feedback.pdf
      _stats/
        scores.csv
        weakness-ranking.csv
        common-typos.csv
        student-weakness.csv
      _feedback/
        S07_王小明_回饋單.pdf
        report.json
        report.csv
```

**命名規則**：全 ASCII，中文只存在 JSON

| 層級 | 格式 | 範例 | 中文 |
|---|---|---|---|
| 根 | 固定 | `essay-grader-data` | — |
| 班級 | `C{班號}-{學期}` | `C302-2025F` | 國中302 |
| 作業 | `E{日期}` | `E20250107` | 我的母親 |
| 學生 | `S{座號}` | `S07` | 王小明 |
| 頁面 | `p{n}.jpg` | `p1.jpg` | — |
| 回饋單 | `S{座號}_feedback.pdf` | `S07_feedback.pdf` | — |

六個關鍵設計：

1. 批注座標用 0～1 正規化，換解析度不跑位
2. 錯別字扣分由標記數自動計算，可手動覆寫
3. `work.json` 原子寫入；評語存**文字快照＋來源 id**
4. 路徑全 ASCII，避免 ZIP 亂碼、Git 跳脫碼、跨平台編碼問題
5. 中文名存 JSON（`class.name`、`assignment.title`、`work.name`），由 App 顯示
6. 匯出給人看的檔案可另存中文檔名，該檔不再被程式解析

---

## 五、待辦

- [x] 決定施工順序：先桌機批閱，手機掃描後補（2026-11-19）
- [x] 技術棧四方案比較（Electron／Tauri／Flutter／C# WPF）
- [x] 資料模型草案（`plan.md`：`work.json`、annotation、scores、library）
- [x] **技術棧定案：Electron + React + TypeScript**（2026-11-19）
- [x] **M0 骨架：schema、fixtures、可啟動 Electron 殼**（2026-11-19）
- [x] **Spike 通過：400% 60fps、50 標記位移 0、A4 PDF 1 頁、監看 373ms、private 343MB**（2026-11-19）
- [x] **M1 資料層：`m1:check` 11/11 通過**（2026-11-19）
- [x] **M2 匯入與佇列：`m2:check` 13/13 通過**（2026-11-19）
- [x] **M3 批閱核心：`m3:check` 25/25 通過**（2026-11-19）
- [x] M3 前補圖片處理：EXIF 轉正、移除 GPS／中繼資料、長邊上限、縮圖
- [x] 建立作業可選量規；評分前可調整配分與等第門檻；已有評分不自動改寫（2026-11-19）
- [x] M4 批次檢查與評分收斂：均衡版預設、整班問題掃描、45 份流程驗收（2026-11-19）
- [x] **M5 回饋單：一頁 A4、單份 PDF、列印、檔名規則、溢頁阻擋**（2026-11-19）
- [x] **M6 統計：G1 弱項排行、G2 常錯字、G3 個人弱項、CSV 四檔**（2026-11-19）
- [ ] 10 分鐘連續操作 soak（自動化目前只跑短時間壓力與 UI 煙霧）
- [x] **E6 成績寫回 Excel：`excel:check` 25/25 通過**（2026-11-20）
- [ ] 量規分項／權重／等第預設數值（老師確認）
- [x] 回饋單版面：一頁 A4、只印文字與統計、不印原圖（2026-11-19）
- [x] **F2 整班批次回饋單：逐份輸出、跳過未完成、溢頁不中斷、進度／取消與報告**（2026-11-20）
- [x] 決定跨裝置搬檔方式：**Google Drive 本機同步資料夾（僅 inbox，資料庫不進雲端）**（2026-11-19）
- [ ] 補國中版評語庫（介面先留空位）
- [ ] 批閱主畫面草圖（一頁）
- [x] **M1 資料層**（2026-11-19）
- [x] **M2 匯入與佇列**（2026-11-19）
- [x] **M3 批閱核心**（2026-11-19）
- [x] **M4 批次檢查**（2026-11-19）
- [x] **M5 回饋單**（2026-11-19）
- [x] **M6 統計**（2026-11-19）

### M4 驗收（2026-11-19）

- 1 班 45 人、1 份作業；不帶 `rubricPreset` 建立時為 `balanced-default`（40／30／30，總評 30 字、重複上限 2）。
- 44 份作品：29 份合法 `done`、5 份總評不足、5 份未評分、3 份共用總評、2 份缺頁檔案；S45 完全沒有 work.json。
- 統計：在學 45、已匯入 44、待批 0、批閱中 11、已批 33、未匯入 1；問題 14 條、提醒 11 條、合計 25。
- 重複規則：S40、S41 合法，只有 S42 被標為第 3 次超過上限 2 次。
- 缺頁 S43、S44（缺 `p1.jpg`）與未匯入 S45 都有被抓到；整班掃描約 32 ms（門檻 < 2 秒）。
- `npm run m4:check` 17/17；重跑 `m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`typecheck`、`build` 全數通過。

### M5 驗收（2026-11-19）

- 1 班 3 人：S07 合法 `done`（4 個錯字批注，其中 2 個「在→再」、1 個「的→得」、1 個未填結構化欄位；2 句改寫、2 句佳句、1 個結構批注），S08 超長總評（約 7,600 字）用來測溢頁，S09 仍在 `grading`。
- 回饋單資料：分項 32／24／25（合計 81）、錯字扣 2、總分 79、等第 B++；錯字聚合為「在→再×2、的→得×1」，未填 wrong／correct 的只計入「本份共 4 處」；詞句只收有 `revised` 的 2 句，其中一句原句空白時顯示「（紙本未記錄原句）」。
- 檔名：固定 `S07_feedback.pdf`；另存中文檔名為 `高中302_我的母親：段考_作文_S07_王小明_回饋單_2026-11-19.pdf`；`<>:"/\|?*`、多餘空白、尾端句點都經清洗。
- PDF：1 頁、150 KB、約 360 ms；檔頭 `%PDF`、內嵌 JhengHei 子集；另存到 `spike-out/m5-assets/` 也成功。
- 溢頁：S08 約 7,600 字總評在 normal→compact→tiny 後仍超過 297mm，匯出被擋下並回「回饋單內容超過一頁」；S09 未完成批閱也被擋下。
- UI：匯入佇列只有 S07 該列有「回饋單」，S09 只有「批閱」；回饋單頁以 normal 密度載入，工具列、學生姓名、79、B++ 與錯字對照皆正確；預覽圖存到 `spike-out/m5-preview.png`；實際開啟預覽視窗與同份重複開啟重用同一視窗也通過。
- `npm run m5:check` 19/19；重跑 `m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`spike`、`typecheck`、`build` 全數通過（spike 記憶體首次量到 500 MB 邊界值，重跑 462 MB 通過）。

### M6 驗收（2026-11-19）

- 1 班 6 人、1 份作業、5 份作品：S07／S08／S12／S15 為 `done`，S20 仍在 `grading`，S21 未匯入。
- 統計範圍：在學 6、匯入 5、已批 4、未完成 1、未匯入 1；班級數字與排行只採計 4 份 `done`。
- 分數摘要：平均 81、中位 82、最高 90、最低 70；等第 A++ 1、A+ 1、B++ 1、B+ 1；分項平均內容 33／40（82.5%）、結構 24.3／30、語言 24.3／30。統計計算約 11 ms。
- G1：13 個弱項批注；錯字 5（38.5%、3 人）、冗贅 2、用詞 2、轉折不足 2、銜接 1、離題 1；類別合計錯字 5、語句 5、結構 3。
- G2：在→再×3（S07、S08）、的→得×1、已→以×1。
- G3：S07 錯字 3／用詞 2／轉折不足 1；S08 冗贅 2／錯字 1／離題 1；S12 錯字 1／銜接 1／轉折不足 1；S15 無弱項批注。S20 雖有 5 個錯字批注，因未完成不計入；S21 顯示未匯入。
- CSV：`_stats/` 下四檔齊全；`scores.csv` 633 bytes、UTF-8 BOM＋CRLF、`陳,大華` 正確加引號；未完成與未匯入皆標「否」。常錯字、弱項排行與個人弱項內容一致。
- UI：匯入佇列按「統計」可載入摘要與 G1／G2／G3（表格共 15 列），按「匯出 CSV」成功並顯示四個檔名；截圖 `spike-out/m6-stats.png` 已調整視窗高度與捲動，完整拍到摘要、G1、G2、G3。
- `npm run m6:check` 17/17；重跑 `typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`spike` 全數通過（private 453 MB）。

### M7 驗收（2026-11-19）

- 備份：`createBackupZip(source, target)` 不經對話框，直接壓整個資料庫根目錄；測試資料庫 7 個檔案壓成 634 bytes zip，含 `class.json`、`work.json`、`p1.jpg`、`_stats/scores.csv`、`work.json.bak`；排除 `.essay-grader.lock`、`*.tmp`、`*.restore.tmp`；所有 entry 皆相對路徑（無磁碟代號、開頭斜線、反斜線或 `..`），也不含目標 zip 自身。
- 還原：目的地非空會拒絕且不動原檔；惡意 zip（`../m7-evil.txt`）在寫入前被擋下，目的地外沒有逃逸檔案；正常備份還原 7 檔、837 bytes，`openDatabase` 後 1 班級、1 份作品、總分 81、總評一致；再對目前資料庫還原會被拒，資料庫仍為 1 班級。直接測試 5 種 zip slip 路徑（`../`、`..\\`、`C:/`、`/`、`a/../../`）皆被 `safeEntryPath` 拒絕。
- 日誌：每筆含 ISO timestamp 與 `[INFO]`／`[WARN]`／`[ERROR]`；連續寫入後 `app.1.log` 2,098,947 bytes、`app.log` 164,250 bytes，確認超過 2 MB 會輪替；日誌不含測試學生姓名與總評全文。主程序另捕捉 `uncaughtException`、`unhandledRejection`、`render-process-gone`、載入失敗，React ErrorBoundary 已進建置產物。
- UI／API：主畫面有「備份資料庫」「還原備份」「開啟日誌」；preload 的 `backup.create`、`backup.restore`、`logs.open`、`logs.path`、`logs.write` 皆存在（隱藏視窗煙霧）。
- 打包設定：`apps/desktop/electron-builder.yml` 具 appId `tw.edu.essaygrader`、productName 作文批閱、win x64 的 nsis＋portable、NSIS 非 oneClick 且可選安裝路徑、桌面捷徑、asar、sharp／@img asarUnpack、`npmRebuild: false`、ASCII 產物名、輸出到 `apps/desktop/release`；根目錄 `app.ico` 410,598 bytes；三份 package.json 版本一致 0.1.0。
- 打包產物：`EssayGrader-0.1.0-Setup.exe` 134,137,825 bytes（約 127.9 MB）、`EssayGrader-0.1.0-Portable.exe` 120,788,287 bytes（約 115.2 MB）、`EssayGrader-0.1.0-Setup.exe.blockmap`；`win-unpacked` 以 `--user-data-dir` 啟動成功，packaged 版日誌正常寫入。E6 完成後於 2026-11-20 以同版號重新打包；F2 完成後再次以同版號打包，產物已含批次回饋單。第一次打包因 GitHub 下載 Electron 卡住，改用本機已安裝的 `electronDist` 後完成；快取中的 NSIS／7zip 可重用。
- 完整回歸：`typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`spike` 全通過（FPS 60.0、A4 PDF 178 KB／105 ms、監看 10/10 78 ms、private 446 MB）。

### Google Drive 外部 inbox 驗收（2026-11-19）

- 設定：`settings.json` 新增 `externalInboxRoot`；寫入後重讀仍在，清除後 key 消失。設定／變更、清除、建立此作業資料夾、開啟資料夾皆即時套用，不需重開。
- 監看：chokidar 遞迴、`usePolling` 500ms、`awaitWriteFinish` 1500ms；忽略 `_unmatched`／`_duplicates`／`_imported`、隱藏檔、`*.tmp`、`.gdoc`、`.gsheet`、`desktop.ini`、`~$*`。圖片與 sidecar 先後到達等 2500ms grace。
- 子資料夾：`S07__…jpg` 無 sidecar 靠檔名匯入；`S08__…jpg` 帶 sidecar 匯入；檔名 `S07` 但 sidecar 指定 `seat=12` 時以 sidecar 為準。測試結果 S07 1 頁、S08 2 頁（含扁平）、S12 1 頁，共 3 份／4 頁。
- 扁平：`flat-photo.jpg` 由 sidecar 的 `class_id`／`assignment_id`／`seat` 路由進 S08；沒有 sidecar 的 `flat-orphan.jpg` 進 `_unmatched`。
- 座號解析：`S07__`、`S07_`、`S07-`、`S07 `、`S07 (1)`、`07` 可解析；`7`、`S7`、`S072`、無座號回 null，不猜。
- 失敗處理：PDF 進 `_unmatched`，原因含「不支援 PDF，請上傳 JPG／PNG」；無座號檔、扁平缺 sidecar、sidecar 指向錯誤 class／assignment 都進 `_unmatched` 並附 reason。4 個失敗來源都保留。
- 去重：Drive 衝突副本 `S07 (1).jpg` 與已匯入頁面 SHA-256 相同，移到 `_duplicates/` 並附重複原因，S07 頁數仍為 1。
- 清理：成功匯入的圖片與 sidecar 都從 Drive 資料夾刪除；測試確認 4 個來源圖片與 3 個 sidecar 皆不存在。
- 根目錄不存在：啟動外部 watcher 時回 `externalWatching=false` 並發 `error` 事件（ENOENT），程式不崩潰；修正路徑後可重新啟動。
- UI：匯入佇列顯示「Google Drive inbox」路徑與監看狀態，具「設定／變更」「清除」「建立此作業資料夾」「開啟資料夾」四個按鈕；preload 的 `chooseDriveRoot`／`clearDriveRoot`／`openDriveRoot`／`ensureDriveFolder` 皆存在（隱藏視窗煙霧）。
- `npm run drive:check` 23/23；回歸 `typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`spike` 全數通過。

### E6 成績寫回 Excel 驗收（2026-11-20）

- 測試成績表「作文」：表頭 `編號／座號／姓名／作文一／等第`，座號含 `7`、`08`、`S12` 與 `99`；自動偵測回傳表頭第 1 列、座號 B、姓名 C、分數 D、等第 E。
- 寫回 S07／S08／S12（皆 `done`）：成功 3 筆；S15 不在表內列為 unmatched；S20 `grading` 列為「未完成，未寫入」。`written=3`、`verified=true`。
- 原檔 6,655 bytes，寫回前後位元組完全相同；副本 `gradebook.graded-20261120-100000.xlsx` 存在，列數維持 5。副本 D 欄 81／74／90、E 欄 A-／B++／A++；座號與姓名未變，99 的列保持 0 與空白。
- 報告 changes：`07: 0→81`、`08: 0→74`、`12: 0→90`，等第同時列出前後值；重複寫回產生 `…-100001.xlsx`，原檔仍不變；同時間戳再寫一次產生 `…-100000-02.xlsx`。
- 重複座號：工作表同時有 `7` 與 `07` 時整次中止，報告列出座號 07 的重複列 2、3，不產生副本，原檔不變，並保留 CSV。
- 匯出模式：`.xlsm` 與含 `xl/charts/` 字樣的檔案都判定為 export；原檔位元組不變，輸出乾淨 xlsx（表頭＋4 筆已批作品），報告含警告與 verified=true。
- 沒有可寫作品時回「沒有可寫回的作品；需要狀態為『已批』且已有分數」，並匯出 CSV。
- 錯誤處理：欄位格式、檔案不存在、工作表不存在、座號欄空白都回繁體中文；重複座號與上述失敗皆保留 CSV 路徑。
- CSV：`_gradebook/grades-20261120-100100.csv` 178 bytes、UTF-8 BOM＋CRLF，表頭 `座號,姓名,分數,等第,狀態`，含 `07,王小明,81,A-,已批` 與 `20,李大同,55,C,批閱中`。
- 設定：`gradebook.json` 296 bytes，寫入後可重讀，路徑／sheet／座號欄／分數欄一致。
- UI：隱藏視窗確認「成績寫回」按鈕、面板、六個操作按鈕與七個 preload API（`getConfig`／`chooseFile`／`inspect`／`saveConfig`／`write`／`exportCsv`／`reveal`）。
- `npm run excel:check` 25/25；回歸 `typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`spike` 全數通過。

### 未匹配照片手動分配座號驗收（2026-11-20）

- 結構化 metadata：`moveToSubfolder` 可選擇在圖片旁寫 `<檔名>.meta.json`，內容含 `classId`、`assignmentId`、`seat`、`reason`、`source`、`movedAt`、`originalName`；既有 `.reason.txt` 與時間戳檔名規則不變。內部 watcher 的格式錯誤／指向錯誤／缺 sidecar／名單外／重複／work 損壞／前處理失敗，以及外部 watcher 的失敗與重複，都帶入已知班級、作業、座號與來源。
- 清單：同時列出目前作業的 `_inbox/_unmatched` 與外部 Drive 根目錄 `_unmatched`；測試共 5 張（本機 3、Drive 2）。沒有 `.meta.json` 的舊檔仍會列出，`classId`／`assignmentId` 留空並顯示「未指定作業」，原因顯示「未記錄原因」。
- 名稱與排序：顯示名稱會去掉 `YYYY-MM-DDTHH-MM-SS-sssZ__` 時間戳前綴；清單依 `modifiedAt`、再依檔名排序。失敗原因與 meta 的班級／作業／座號皆正確。
- 縮圖：`sharp` 輸出 320px 內 JPEG data URL；測試縮圖 240×320、5,954 bytes，可解碼且尺寸合理。縮圖一次只讀一張，renderer 不直接接觸檔案系統。
- 指定座號：3 張測試圖刻意亂序建立並設定不同 mtime，指定給 S07 後依 mtime 排序附加；`queued=3`、`failed=0`，`work.pages` 由 0 增加為 3，頁面 SHA-256 順序與來源一致。每張會等待 watcher 消化後再放下一張，避免 chokidar 事件順序造成頁序錯亂。
- 來源清理：3 張來源圖片、`.reason.txt`、`.meta.json` 與殘留同名 sidecar 都在排入後刪除；`_inbox` 無殘留 `__manual__` 檔。
- 去重：以已匯入頁面的相同位元組再指定一次，`queued=1`、頁數維持 3，收到 `duplicate` 事件，重複檔進 `_duplicates` 並有含 seat／source 的 meta。
- 路徑與權限：非在學座號回「不在在學名單」；路徑穿越（`..`）、任意路徑（fixture 原圖）都回「不在允許的 _unmatched 資料夾內」；空選取回「請先選取至少一張」。
- UI：匯入佇列有「未匹配照片」按鈕；面板可開、有縮圖卡片、在學學生下拉（2 人）、全選／清除、指定按鈕與「來源會刪除」確認文字；preload 的 `listUnmatched`／`unmatchedThumbnail`／`assignUnmatched` 皆存在（隱藏視窗煙霧）。
- `npm run match:check` 21/21；回歸 `typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`spike` 全數通過。

### F2 整班批次回饋單驗收（2026-11-20）

- 測試資料：5 位學生。S07／S08／S09 為正常 `done`，其中 S09 姓名含 `/`、`:`、`?` 用來驗證檔名清洗；S10 為 `grading`；S11 為 `done` 但總評超長（約 9,000 字）造成溢頁。另建取消、重複啟動與空作業三份測試作業。
- 批次結果：total 5、exported 3、skipped 1、failed 1，流程未因 S11 溢頁中斷。S10 原因為「批閱中，尚未完成」，S11 原因為「回饋單內容超過一頁，請縮短總評或減少批注」。
- Canonical PDF：S07／S08／S09 都存在 `S{座號}/S{座號}_feedback.pdf`，皆 1 頁、135–136 KB；S10、S11 不產生 canonical PDF。
- `_feedback/`：3 份 PDF，`S07_王小明_回饋單.pdf`、`S08_陳怡君_回饋單.pdf`、`S09_林_小_美__回饋單.pdf`；`report.json` 的 jobId、統計與每筆欄位和報告一致；`report.csv` 約 725 bytes、UTF-8 BOM、CRLF、6 列，S11 列為 failed。
- 進度 callback：5 筆依序為 `1/5 S07 exported`、`2/5 S08 exported`、`3/5 S09 exported`、`4/5 S10 skipped`、`5/5 S11 failed`，completed 由 1 累加到 5。
- 取消：第 1 份完成後觸發，結果 total 3、exported 1、cancelled 2，S08／S09 沒有 canonical PDF，`_feedback/` 只有 1 份 PDF。
- 重複啟動：第一個批次尚未結束時再啟動會回「已有批次回饋單正在進行」，第一個批次仍正常完成 2 份。
- UI：匯入佇列有「批次回饋單」按鈕；面板顯示已批 4 份、未完成 1 份、`_feedback` 輸出路徑、開始／取消／開啟資料夾與進度條；空作業時開始按鈕停用；preload 的 `batchInfo`／`batchStart`／`batchCancel`／`batchReveal`／`onBatchProgress` 皆存在（隱藏視窗煙霧）。
- 打包：以同版號 0.1.0 重新產出 `EssayGrader-0.1.0-Setup.exe`（134,137,825 bytes）與 `EssayGrader-0.1.0-Portable.exe`（120,788,287 bytes），已確認 app.asar 內含批次 IPC。
- `npm run batch:check` 17/17；回歸 `typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`spike` 全數通過。

### 已知限制（M3–M7＋Drive inbox＋E6＋未匹配分配＋F2）

- 10 分鐘連續操作 soak 尚未執行，目前只有 `m3:check`、`m4:check`、`m5:check` 的短時間 UI 煙霧與 45 份批次檢查。
- 量規預設採用均衡版（40／30／30），之後可調整；三組配分、扣分 0.5／0.5、上限 10 與等第門檻仍為預設值，尚未經老師確認。
- 量規或等第門檻變更不會自動重算既有作品的 `scores`；已批作品若需要新量規的分數與等第，仍要重新開啟該份並完成批閱。
- 等第名稱只檢查去空白後不可為空、不可重複，未限制長度；最低分只接受 0–100，未限制級距間隔。
- 內建評語庫只有高中職版 126 條；國中版尚未補。
- 成績寫回以單一作業、單一工作表為範圍；ExcelJS 可能微調樣式，含圖表／樞紐／巨集的檔案改走匯出新檔，不直接改原檔。整班批次回饋單已於 F2 補上，但仍以單一作業為範圍。
- 批次回饋單逐份開啟隱藏視窗，份數多時需要時間；失敗或跳過的份數要修正後重跑整批，尚未提供只重跑失敗項。
- 批次取消只在下一份開始前生效，正在產生的那一份會完成；已輸出的 PDF 不會因取消而刪除。
- 批次報告含學生姓名與輸出路徑，屬老師要求的輸出；程式日誌仍不記錄姓名或總評全文。
- 統計只計已批（`done`）作品；批閱中與未匯入不進班級摘要、排行與常錯字，避免數字隨批閱進度跳動。
- G1 佔比以「弱項批注總數」為分母，不含佳句與一般評語；同一份作品多次標記會累計。
- 統計目前只做單一作業，尚未跨作業比較（G4 趨勢／G5 個人進退步未做）。
- CSV 為 UTF-8 BOM＋CRLF，Excel 可直接開啟；尚未做 Excel 格式（欄寬、樣式、多工作表）。
- 回饋單只用系統字型（Microsoft JhengHei、標楷體／PMingLiU fallback），未內建 Noto Serif TC；換到沒有這些字型的電腦需再確認。
- 回饋單摘要有上限（錯字 12 種、詞句 6 句、佳句 4 句），超出只顯示前 N 筆；完整內容仍在 `work.json` 與批閱畫面。
- 回饋單溢頁採自動降字級（10pt→9.2pt→8.4pt），仍放不下就阻擋匯出；目前不支援自動續頁或含原圖版本。
- 批次檢查以單一作業為範圍，不跨作業比對重複；頁面檔案只確認存在，不重新驗證圖片內容。
- 批次檢查的「乾淨」只代表沒有阻擋完成的問題；`pending`／`grading` 仍會以提醒列出。
- UI 自動驗收已涵蓋批次檢查按鈕、面板、前往批閱與返回重查、回饋單按鈕與預覽頁，但未逐項模擬完整鍵盤批閱流程，也未自動按下列印對話框。
- 安裝檔目前只做 Windows x64；未提供 macOS／Linux 版。
- 備份是完整快照，尚未做增量、排程或雲端備份；zip 未加密，請自行保管。
- 還原只能進新的空資料夾，不會自動合併或覆寫既有資料庫。
- 日誌只保留目前檔與 `app.1.log` 一份輪替檔，沒有長期歸檔。
- portable 的設定與日誌仍寫在使用者 `%APPDATA%`，不隨 exe 攜帶；資料庫位置由使用者選擇。
- Google Drive 外部 inbox 依賴 Google Drive for desktop 的本機同步；未安裝、未登入或資料夾不存在時無法監看。
- 外部 inbox 只支援 JPG／JPEG／PNG；PDF 會移到 `_unmatched`，不支援轉檔。
- 外部 inbox 沒有全域「最近匯入」清單；事件只保留最近 100 筆，成功後來源即刪除，雲端版本紀錄與垃圾桶仍可能暫時保留。
- 扁平模式沒有 sidecar 一律進 `_unmatched`；子資料夾模式若檔名沒有座號也不猜。
- 未匹配照片手動分配沒有復原功能：指定成功後來源即刪除，老師需在按下前確認學生與頁序。
- 未匹配照片只處理目前作業的內部 `_unmatched` 與全域 Drive `_unmatched`；其他作業的內部失敗檔需切換到該作業再處理。
- 手動分配會逐張等待 watcher 消化以維持頁序；一次選取大量照片時，IPC 回應時間會隨張數增加。
- 沒有 meta 的舊 `.meta.json` 之前檔案仍可列出，但無法還原原本班級／作業／座號，只能指定給目前作業。
- 手機端 App（M8）尚未實作；目前需用手機 Google Drive App 手動上傳圖片與 sidecar。

---

## 六、施工順序（建議）

1. **能批一份**：資料夾結構 → 批閱介面 → 標記 → 評分
2. **能批一班**：手機掃描 → 自動匯入 → 佇列 → 回饋單
3. **能看出問題**：統計 → 常錯字 → 趨勢
