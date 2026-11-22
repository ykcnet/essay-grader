# Essay Grader — Progress

> 最後更新：2026-11-22
> 階段：**M0–M7＋Google Drive 外部 inbox＋E6 成績寫回＋未匹配分配＋F2 整班批次回饋單＋10 分鐘 soak＋G4 與上次比較＋G6 佳句庫累積＋D11 自訂評語增刪改＋D12 國中／高中職雙評語庫＋D13 常用排序與釘選＋D21 評語庫版本更新＋D22 跨批冷卻輪替＋D23 停用取代刪除＋M8 Android 掃描器完成（App 建置完成、桌面 manifest 完成，待實機驗證）；下一步 M9／真機測試**

---

## 一、檔案

| 檔案 | 內容 |
|---|---|
| `features.md` | 功能清單 77 項，含優先級與不做清單 |
| `comment-library-senior.md` | 內建評語 138 條，含更新與輪替機制 |
| `comment-library-junior.md` | 國中版評語庫草稿 138 條；由 JSON 產生，已接入 runtime，**國中版仍待國中國文老師校閱** |
| `packages/core/src/library/junior.draft.json` | 國中版草稿資料（`2026.2-draft`）；`JUNIOR_LIBRARY` 由 `LibrarySchema` 驗證載入 |
| `docs/評語庫結構依據.md` | 五面向定義與最低條數、官方結構規準摘述、19 類結構輔助索引（16 類通用＋3 類體裁補充）、來源與檢索日期 |
| `docs/評語參考_使用者提供.md` | 使用者提供 6 張評語表的整理、已採用概念對照、未採用原因與待校閱事項 |
| `packages/core/src/library/comment-coverage.json` | 五面向 junior／senior comment ID 與最低條數，另保留 19 類結構輔助索引；覆蓋率唯一來源 |
| `tools/validate_comment_coverage.mjs` | 覆蓋率檢查：五面向 minimum 與 ID、每條 comment 至少一個面向、19 類各 ≥2、Markdown 含五面向分布與結構摘要 |
| `tools/render_junior_library.mjs` | 由草稿 JSON 產生 Markdown，確保五面向分布、結構摘要與條數一致 |
| `tools/validate_junior_library.mjs` | 草稿檢查：138 條、分類／子類、id、字數、標籤、變數與高中職版重複 |
| `tools/validate_library_wording.mjs` | 兩套評語庫用語檢查：總評／佳句／結構不得使用引號，錯字／語句不受限 |
| `tools/validate_library_structure.mjs` | 兩套總評五面向詞彙檢查：依 dimensions 驗證所屬面向用語、引號、字數與正規化重複 |
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
| `packages/core/src/compare.ts` | G4 比較純函式：座號對齊、六種狀態、只計 compared 的平均、進步／退步前 5、弱項四類每份平均 |
| `apps/desktop/src/main/data/compare-check.ts` | G4 驗收：5 人×3 份作業（含同日 -02）、狀態／平均／弱項、換 previousId、拒絕情境與 UI 煙霧 |
| `packages/core/src/praise.ts` | G6 佳句庫純函式：只收 `done` 的 `praise`、`normalizeComment` 去重、次數／作品數、來源作業、首末時間與排序，輸出不含學生識別 |
| `apps/desktop/src/main/data/praise-check.ts` | G6 驗收：2 班／3 份作業／6 份作品、核心去重與排序、去識別、Repository 範圍與壞作業跳過、IPC／preload、UI 煙霧 |
| `apps/desktop/src/main/data/m6-check.ts` | M6 驗收：統計範圍、G1／G2／G3、CSV 內容與 UI 煙霧、統計截圖 |
| `apps/desktop/src/renderer/src/App.tsx`（StatsPanel） | M6 統計面板：摘要、等第／分項平均、G1／G2／G3、匯出 CSV、開啟資料夾；G4 比較區塊：上次作業下拉、摘要、排行、弱項表、學生表 |
| `apps/desktop/src/main/data/backup.ts` | M7 備份／還原：archiver 相對路徑 zip、排除 lock／tmp、yauzl 串流解壓、zip slip 與非空目的地防護 |
| `apps/desktop/src/main/logger.ts` | M7 主程序日誌：時間／level、2 MB 輪替、未捕捉例外與 renderer crash、開啟日誌資料夾 |
| `apps/desktop/src/main/data/m7-check.ts` | M7 驗收：備份內容、還原可讀、zip slip、日誌輪替與敏感內容、UI API、打包設定 |
| `apps/desktop/src/renderer/src/ErrorBoundary.tsx` | M7 React 錯誤邊界：友善畫面、重新載入、開啟日誌，不讓視窗空白 |
| `apps/desktop/electron-builder.yml` | M7 打包：appId、NSIS／portable、asar、sharp asarUnpack、ASCII 產物名稱 |
| `docs/使用說明.md` | M7 使用者說明：安裝／portable、資料庫、匯入、批閱、評分、回饋單、統計、備份、日誌、隱私與 FAQ |
| `tools/fix-m-drive.ps1` | 把專案所在磁碟區固定為 `M:`；需系統管理員，已在目前主機驗證 |
| `apps/desktop/src/main/import/` | M2 匯入：inbox watcher、sidecar 配對、去重、Excel 名單、sharp 前處理；Drive 外部 inbox watcher 與驗收 |
| `apps/desktop/src/main/import/external.ts` | Google Drive 外部 inbox：遞迴監看、子資料夾／扁平路由、grace、PDF 擋下、去重、來源清理與 `_unmatched`／`_duplicates` |
| `apps/desktop/src/main/import/manifest.ts` | 手機 manifest：目前班級、全部作業、在學學生；外部 root 原子寫入，不含分數／批注／總評 |
| `apps/desktop/src/main/import/manifest-check.ts` | Manifest 驗收：欄位、在學篩選、覆蓋、無 root 錯誤、UI 與 preload |
| `tools/android.ps1` | Android 建置：尋找 JDK／SDK、設定環境變數、執行 gradlew |
| `apps/android/` | Kotlin + ML Kit 手機掃描器：manifest 讀取、SAF、掃描、pending 佇列、inbox 上傳 |
| `apps/desktop/src/main/import/drive-check.ts` | Drive 驗收：兩種擺法、sidecar 優先、PDF、錯誤路徑、設定持久化與 UI 煙霧 |
| `apps/desktop/src/main/import/unmatched.ts` | 未匹配照片：內外清單、`.meta.json` 解析、320px 縮圖、路徑 realpath 防護、複製到 `_inbox` 與來源清理 |
| `apps/desktop/src/main/import/match-check.ts` | 未匹配照片驗收：meta／reason、舊檔、縮圖、指定 3 張頁序、去重、拒絕情境與 UI 煙霧 |
| `apps/desktop/src/main/feedback/batch.ts` | F2 整班批次：逐份輸出、跳過未完成、單份失敗不中斷、進度／取消、`_feedback/` 中文檔名與 JSON／CSV 報告 |
| `apps/desktop/src/main/feedback/batch-check.ts` | F2 驗收：5 人輸出／跳過／溢頁失敗、報告、進度順序、取消、重複啟動與 UI 煙霧 |
| `apps/desktop/src/main/soak.ts` | 10 分鐘 soak：45 人暫存資料庫、每圈批次檢查／統計／45 份回饋單／autosave、private bytes 與視窗數取樣、結束資料驗證 |
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
| 1 | 使用對象 | 國中、高中職（國中版草稿完成，待校閱與接入） |
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
| 86 | soak 驗收 | `npm run soak` 預設 10 分鐘，可用 `--soak-minutes` 縮短；1 班 45 人、每圈 45 份批次回饋單；暖機後記 baseline，每分鐘記 private bytes／行程／視窗／PDF，批次後視窗須回 baseline；門檻 final < 700 MB、peak < 800 MB、growth < 180 MB；報告 `spike-out/soak-report.json`，失敗 exit 1 並保留報告 |
| 87 | G4 對齊與狀態 | 以**座號**對齊兩份作業所有在學學生；進步／退步／持平只比較兩邊都有 `done` 分數者；本次有、上次沒有為新作品，上次有、本次沒有為缺資料，兩邊都沒有為資料不足 |
| 88 | G4 平均母體 | 班級平均只以 compared（兩邊都有分數）學生計算；先各自四捨五入到一位小數，Δ 再由兩個平均相減，避免新作品或缺考扭曲 |
| 89 | G4 弱項比較 | 只比錯字／語句／結構／其他四類，使用 `StudentStatsRow.counts`；以 compared 人數為分母算每份平均次數；Δ 為本次－上次，負值代表改善、正值代表變多 |
| 90 | G4 排行 | 進步前 5、退步前 5 依 Δ 排序，Δ 相同依座號；不把新作品或缺資料列入排行 |
| 91 | G4 預設上次作業 | UI 依作業 id 字串由小到大排序（`E{日期}` 與同日 `-02` 皆正確），預設選目前作業之前最近的一份；沒有其他作業顯示「這是第一份作業，尚無可比較資料」；切換目前作業以 key 重置選擇與結果 |
| 92 | G4 驗收 | `npm run compare:check` 15/15：5 人、上次 S07 70／S08 85／S12 80／S15 60，本次 S07 79／S08 80／S12 80／S20 75／S15 缺；compared=3、平均 78.3→79.7（Δ +1.4）、弱項 1.3→1.0／0.7→0.3／0.3→0.7；換 previousId、同份、跨班、不存在、純函式不改來源與 UI 皆通過 |
| 93 | 評語庫結構覆蓋 | 依官方規準、教學歸納與使用者提供評語表建立 19 類（16 類通用＋3 類體裁補充）；每類至少 2 條、實際 3–5 條；每個 comment 至少被一類覆蓋；`library:coverage` 納入驗收 |
| 94 | 體裁補充評語 | 由使用者提供的 6 張評語表抽取結構概念，兩套庫各新增 12 條（記敘 4、抒情 4、議論 4）；不直接收錄短標籤、特定題材、修辭標籤或學習態度評語 |
| 95 | 總評五面向平衡 | 總評改以結構、立意取材、語言表達、情感體驗、格式應用編寫；結構只是其中之一。junior 33／21／12／20／10、senior 33／25／12／18／10，兩套各改寫 23 條，維持 138 條與 comment 72 條；非結構評語不硬塞結構詞 |
| 96 | 手機 manifest 內容 | `schema_version` 1、`generated_at` ISO；只含目前班級 id／name／grade、該班全部作業 id／title、`active !== false` 學生 seat／name；**不含分數、批注、總評、updated_at 或作品內容** |
| 97 | 手機 manifest 位置 | 寫在 `settings.externalInboxRoot/manifest.json`；未設定外部 root 或資料夾不存在時回繁中錯誤；用 `.tmp`→fsync→rename 原子覆蓋 |
| 98 | 手機 manifest 入口 | IPC `import:write-manifest(classId)`、preload `imports.writeManifest(classId)`；ImportPanel 的 Google Drive inbox 區塊加「產生手機 manifest」，成功顯示路徑與班級／作業／學生數 |
| 99 | Android 建置工具鏈 | `tools/android.ps1` 預設 `:app:assembleDebug`；優先 `JAVA_HOME`／`ANDROID_HOME`，否則 `M:\dev\tools\jdk`、`M:\dev\tools\android-sdk`；缺工具鏈回繁中錯誤；npm 腳本不硬編碼路徑 |
| 100 | M8 驗收邊界 | 桌面 manifest 以 `manifest:check` 11/11 驗收；Android 以 13 個 JVM 測試與 debug APK 建置驗收；ML Kit、SAF、Drive 上傳與端到端仍待實機 |

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
- [x] 10 分鐘連續操作 soak（`npm run soak`，2026-11-20 完成）
- [x] **E6 成績寫回 Excel：`excel:check` 25/25 通過**（2026-11-20）
- [ ] 量規分項／權重／等第預設數值（老師確認）
- [x] 回饋單版面：一頁 A4、只印文字與統計、不印原圖（2026-11-19）
- [x] **F2 整班批次回饋單：逐份輸出、跳過未完成、溢頁不中斷、進度／取消與報告**（2026-11-20）
- [x] **G4 與上次比較：座號對齊、進步／退步、只計 compared 平均、弱項類別 Δ、UI 與 `compare:check` 15/15**（2026-11-20）
- [x] 決定跨裝置搬檔方式：**Google Drive 本機同步資料夾（僅 inbox，資料庫不進雲端）**（2026-11-19）
- [x] 國中版評語庫草稿 138 條完成（原 126 條，後增 12 條體裁補充）；D12 已接入並可依學制自動選用（2026-11-21）；仍待國中國文老師校閱
- [x] **M8 Android 掃描器 App 建置完成**（2026-11-22）：Kotlin＋ML Kit、manifest 選單、SAF、多頁掃描、pending 佇列、Drive inbox 上傳；13 個 JVM 測試通過
- [x] **M8 桌面 manifest 產生完成**（2026-11-22）：IPC／preload／UI、原子覆蓋、只在學學生、`manifest:check` 11/11
- [ ] M8 實機驗證：ML Kit 掃描與裁切、SAF 權限保存、Drive 上傳、離線補傳、桌機端到端 3 頁流程
- [ ] M8 後續：多頁拖拉排序（B2）、送出後自動回相機（B6）、已拍清單與重拍刪除（B7）
- [x] 兩套評語庫用語清洗：移除總評／佳句／結構的特定詞句引號，新增 `library:wording` 檢查（2026-11-20）
- [x] 兩套 120 條總評改以文章結構為主，新增 `library:structure` 檢查（2026-11-20）
- [x] 建立 `docs/評語庫結構依據.md` 與 16 類結構覆蓋表（初始版）；junior 修正 18 條、senior 修正 5 條；新增 `library:coverage`（2026-11-20）
- [x] 收入使用者提供評語表：整理 6 張掃描檔、新增參考文件，兩套庫各加 12 條體裁補充，覆蓋分類擴為 19 類（2026-11-20）
- [x] 總評改為五面向平衡：結構 33 條為上限主軸，另補立意取材、語言表達、情感體驗、格式應用；更新 coverage JSON、兩個驗證腳本、Markdown、文件與 README（2026-11-20）
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

### 10 分鐘 soak 驗收（2026-11-20）

- 指令與資料：`npm run soak` 預設 10 分鐘，`--soak-minutes` 可縮短；暫存資料庫在 `spike-out/soak/db`，1 班 45 位在學學生、1 份作業、45 份 `done` 作品。每份 1 頁小 JPG，分數 62–90，總評皆不同且 ≥30 字，另有錯字×2、語句、結構、佳句共 5 個批注。
- 每圈流程：`auditAssignment` 確認 done=45、問題與提醒皆 0；`getAssignmentStats` 確認 done=45；整班批次回饋單 45 份，確認 exported=45、failed=0；輪替 3 位學生 `loadWork` → 固定長度總評 → `saveWork` → 重讀驗證；等待 700–850ms；批次後比對視窗數。
- 正式結果：15 圈、16 次批次（含暖機 1 次）、720 份 PDF、15 次批次檢查、15 次統計、45 次 autosave；實際歷時 10.78 分鐘（含暖機 37.7 秒）。
- 記憶體：以 `app.getAppMetrics()` 逐行程加總 `memory.privateBytes`。baseline 291 MB、final 291 MB、peak 426 MB、growth 0 MB；全部低於 final 700／peak 800／growth 180 MB 門檻，無逐圈累積。
- 視窗：baseline 0；批次進行中最多 1 個隱藏視窗；每圈批次結束後最多 0、結束時 0，沒有泄漏。行程數在批次中最多 4–5 個，批次結束回到 3 個。
- 結束驗證：45/45 份 `work.json` 可讀、頁數仍為 1、分數與初始值相同；最後一輪 `_feedback/` 45/45 份 PDF 皆 1 頁且 >20 KB；沒有未捕捉例外、沒有 failed；關閉資料庫後程序正常結束，exit code 0。
- 吞吐量：暖機 37.7 秒；各圈 36.0–65.8 秒，多數約 37 秒。第 14–15 圈升至 52.7／65.8 秒；同期 private bytes 與視窗數沒有上升，前一次 10 分鐘測試也在少數圈數出現類似升幅後回落，研判為主機 I/O／防毒掃描等外部因素，非程式累積泄漏，列為已知限制。
- 回歸：`typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`spike` 全數通過（spike private 462 MB）。
- 報告：`spike-out/soak-report.json`（25 筆記憶體取樣、逐圈耗時、視窗統計、結束驗證與門檻結果）。

### G4 與上次比較驗收（2026-11-20）

- 測試資料：1 班 5 位在學學生（S07／S08／S12／S15／S20）、3 份作業；`E20261110` 與 `E20261110-02` 為同日作業，`E20261120` 為本次。上次採用 `-02`，另有更早的 `E20261110` 用來驗證切換 previousId。
- 上次：S07 70 B+、S08 85 A+、S12 80 A、S15 60 C；本次：S07 79 B++、S08 80 A、S12 80 A、S20 75 B++、S15 缺資料。
- 核心比較：在學 5、已比較 3、進步 1（S07 +9）、退步 1（S08 −5）、持平 1（S12）、新作品 1（S20）、缺資料 1（S15）、資料不足 0。
- 平均：只計 compared 3 人，上次 78.3、本次 79.7、Δ +1.4；若把新作品或缺資料算進去會變成 73.8→78.5，因此不採用。進步前 5 第一名 S07、退步前 5 第一名 S08。
- 弱項每份平均（compared 3 人）：錯字 1.3→1.0（Δ −0.3）、語句 0.7→0.3（Δ −0.4）、結構 0.3→0.7（Δ +0.4）、其他 0.0→0.0（Δ 0）。UI 以一位小數呈現。
- 純函式：`compareAssignmentStats` 不改來源 `AssignmentStats`（JSON 前後相同），可注入 `generatedAt`；回傳 current／previous id 與標題。
- 換 previousId：改用 `E20261110` 後平均 73.3→79.7（Δ +6.4）、進步第一 S07 +19、退步第一 S08 −10，結果確實改變。
- 拒絕情境：currentId＝previousId 回「目前作業與上次作業不能是同一份」；跨班作業回「找不到上次作業」；不存在的作業分別回「找不到目前作業／上次作業」。
- UI：統計面板有「與上次比較（G4）」、上次作業下拉（預設 `E20261110-02`，同日 `-02` 排序正確）、摘要 chips、進步／退步前 5、弱項類別表、5 列學生明細表；改選 `E20261110` 後摘要變 73.3→79.7；切換目前作業後下拉重置為 `E20261110`。preload `stats.compare` 存在（隱藏視窗煙霧）。
- `npm run compare:check` 15/15；回歸 `typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`soak --soak-minutes=1` 8/8、`spike` 全數通過。

### 國中版評語庫草稿驗收（2026-11-20）

- `junior.draft.json`：126 條，typo 10、sentence 23、structure 23、praise 10、comment 60；各子類數量全數比照高中職版。
- 編號 JE-01…10、JS-01…23、JT-01…23、JG-01…10、JC-01…60；與 `senior.json` 的 126 個 id 完全不重複。
- 每條 tags 至少含「國中」，source 一律 `builtin`、disabled `false`；未使用大括號變數。
- comment 60 條去除標點與空白後 45–60 字，全部 ≥30；其餘類別不設下限。
- 與 `senior.json` 比對：126 條正規化文字全部不同，沒有直接複製高中職版。
- `comment-library-junior.md` 由 JSON 產生，表格、條數與統計一致；`npm run junior:check` 17/17。
- 用語清洗：junior 修正 20 條、senior 修正 7 條；總評／佳句／結構移除「」與『』，改用抽象形容詞、感受、場景、人物、事件、段落、例子等通用指稱，錯字與語句仍保留引號標示具體錯誤。
- 新增 `npm run library:wording`，同時檢查 junior 與 senior；`junior:check` 已串接此檢查，兩套庫皆 PASS。
- 當時（2026-11-20）草稿未接入 runtime；已於 2026-11-21 接入 `JUNIOR_LIBRARY` 並可依學制自動選用，見下節「D12」。
- 待校閱：語氣是否適合七～九年級、會考知性／情意題對應、是否保留文言與應用文、七年級適用性、句型重複感。
- 回歸：`typecheck`、`build`、`m3:check` 通過。

### 總評結構改寫驗收（2026-11-20）

- 國中 60 條（JC-01…60）、高中職 60 條（C-01…60）全部改寫，ID、分類與子類維持不變。
- 改寫方向：以主旨、段落功能、順序、過渡、例證、首尾、比例與連貫為主；知性題談論點—理由—例證—反駁—結論，情意題談情感線、場景、節奏與轉折，應用文談格式、資訊順序與收信人需求。
- 不再綁定特定題材、人物關係、地點或事件，也不引用特定詞句；總評不含引號。
- 字數：junior 45–60 字、senior 45–57 字，全部落在建議的 45–90 字區間。
- 新增 `npm run library:structure`：檢查結構詞覆蓋、引號、字數與正規化重複；兩套皆 60/60 通過。
- 文件同步：兩份評語庫開頭加入結構導向規則，README／progress／plan 記錄本次改寫。
- 回歸：`junior:render`、`junior:check` 17/17、`library:wording`、`library:structure`、`m3:check`、`typecheck`、`build` 通過；runtime 仍只載入 `senior.json`。

### 評語庫結構依據與覆蓋率驗收（2026-11-20）

- 研究依據：整理國中教育會考寫作測驗評分規準（四向度、結構組織六至一級分、零級分）、會考寫作測驗問與答（引導寫作、審題與任務回應）、114／115 學測國寫評分原則（知性題結構嚴謹、層次井然；情意題結構完整、情感深刻；低分結構鬆散、結尾無法收束）、國教院知性寫作教材，以及四項教學資源；來源與檢索日期 2026-11-20 見 `docs/評語庫結構依據.md`。
- 分類：建立 16 類，涵蓋切題與主旨、段落功能與分段、段落比例與重心、順序與脈絡、過渡與連貫、主題句與段落重心、例證與論據、例證與論點連結、首尾與呼應、結尾收束、重複與精簡、知性題論證層次、情意題情感線與場景、應用文格式與資訊順序、完整度、文體與任務回應。
- 依據標示：官方規準只提供向度與級分描述，16 類是教學歸納；文件中逐類標示「官方／教學歸納」，沒有把教學分類冒充官方分類。
- 覆蓋資料：`comment-coverage.json` 記錄每類的 key、label、依據摘要、junior 與 senior 的 comment ID；同一條可支援多類。
- 覆蓋結果：junior 60/60、senior 60/60 條 comment 至少被一類覆蓋；每類在兩套庫皆 3–5 條；分類對應次數 junior 64、senior 60，沒有孤立條目。
- 內容校正：junior 修正 18 條（JC-02、12、20、22、29、32、36、37、40、41、43、46、48、55、56、57、59、60），senior 修正 5 條（C-27、31、48、53、60）；ID、條數與 subtype 皆未變動。
- 特別檢查：知性題 10 條覆蓋立場（JC-36、40、32）、理由層次（JC-26、31、34、39）、例證（JC-33、35、37）、反駁（JC-34）、結論（JC-32、36）；情意題 10 條覆蓋情感線、場景、轉折、節奏、首尾；應用文 10 條覆蓋格式、資訊順序、對象、重點、收束；strength／weakness／混合型區段 30 條覆蓋主旨、段落、比例、順序、過渡、主題句、例證、首尾、重複、完整度。
- 文件：兩份 Markdown 開頭加入 `docs/評語庫結構依據.md` 連結與編寫依據，並加入 16 類「結構覆蓋摘要」表；junior 由 render 工具產生，senior 由 converter 保留表格。
- 新指令：`npm run library:coverage` 檢查每類 ≥2、ID 存在且 category=comment、同分類不重複 ID、每個 comment 至少被一類覆蓋、兩份 Markdown 摘要與 JSON 一致；不足即 exit 1。
- 回歸：`junior:render`、`junior:check` 17/17、`library:wording`、`library:structure` 60/60、`library:coverage`、`m3:check`、`typecheck`、`build` 通過；runtime 仍只載入 `senior.json`。
- 待校閱：senior 情意題目前 8 條、混合型區段 12 條（原庫結構），子類在 JSON 記為 general；本次依指示未動 subtype，建議校閱時一併決定是否改為 mixed 或調整為 10／10。junior 知性與情意題各 10 條。

### 體裁補充評語驗收（2026-11-20）

- 來源：使用者提供的 7z 內含 6 張作文評語表掃描圖；逐張整理為立意／結構／修辭示例、分體裁分級短語、通用優缺點與老師期望、友情與成長題材、成長與學習態度清單。整理文件為 `docs/評語參考_使用者提供.md`。
- 新增條數：國中 `junior.draft.json` 新增 JC-61～JC-72；高中職 `comment-library-senior.md` 新增 C-61～C-72，並由 converter 產生 `senior.json`。兩套各 12 條，合計 24 條。
- 體裁分配：記敘 4 條（JC-61～64／C-61～64）、抒情 4 條（JC-65～68／C-65～68）、議論 4 條（JC-69～72／C-69～72）；四條分別覆蓋不同結構點，不是同句型換詞。
- 分類與標籤：國中新條 subtype 為 emotional 或 intellectual，tags 含國中、記敘／抒情／議論、結構補充、使用者提供；高中職放在情意題與知性題小節，tags 另含高中、通用、體裁與來源。
- 總數：junior 138 條（comment 72、emotional 18、intellectual 14）；senior 138 條（comment 72）。兩套 comment 正規化後皆 45–64 字，沒有引號與大括號變數。
- 覆蓋：`comment-coverage.json` 由 16 類增為 19 類，新增記敘結構、抒情結構、議論結構各 4 條；新 ID 也對應到順序、比例、完整度、主旨、段落功能、重複、首尾、文體任務、主題句、論證與例證連結等既有分類。junior／senior 皆 72/72 條被覆蓋，分類對應次數 88／84，沒有孤立條目。
- 用語與獨立性：抽樣 junior 6 條、senior 6 條，均以結構為主、可獨立使用，未假設特定人物、物件、地名或事件；同體裁四條的症狀與調整策略有明顯區隔。
- 驗收：`junior:render`、`junior:check` 17/17、converter（138 條，comment 72）、`library:wording`、`library:structure` 72/72、`library:coverage` PASS、`m3:check` 25/25、`typecheck`、`build` 全數通過。
- 未採用：友情、青春、家庭等特定題材；結構完整、層次井然等短標籤；字體、標點、整潔、訂正等格式或作業管理；願意改變、責任感、毅力、自省等學習態度與品格評語；以及與現有 60 條重複的概念。原因與代表性詞語見參考文件。
- 待校閱：記敘是否需補倒敘與多線敘事、抒情是否保留更多直說空間、議論是否再補資料取捨與圖表判讀、高中職體裁補充是否獨立成區段、國中用語是否適合七至九年級。

### D12 國中／高中職雙評語庫驗收（2026-11-21）

- Core：`SENIOR_LIBRARY` 維持 `2026.1`，新增 `JUNIOR_LIBRARY`（`2026.2-draft`），兩者皆由 `LibrarySchema` 驗證；`BUILTIN_LIBRARY` 仍指向高中職版以維持相容。兩套皆 138 條、comment 72 條。
- `LibraryId` 為 `junior`／`senior`，`LibraryMode` 為 `auto`／`junior`／`senior`；`libraryForGrade` 在 auto 下 junior→國中版、senior／vocational→高中職版，顯式模式可覆寫學制，非法模式會拋錯。
- `LibraryPayload` 回傳 `id`、`mode`、`grade`（有效學制時）與完整 `library`（含 `library_version`）。
- Settings：新增 `libraryMode`，預設 `auto`；讀取時非法值正規化為 `auto`，切換後寫入 `settings.json`，重開保留。
- IPC／preload：`library:get(classId?)` 會讀班級 `grade` 後回傳 payload；`library:set-mode(mode)` 驗證後儲存並回傳 `{ mode }`。未給 classId 時使用 auto 的高中職版或手動模式。
- ReviewView：評語庫面板新增版本下拉（自動／國中版／高中職版）、目前版本與 `library_version`；國中版顯示「草稿」標籤與「國中版為草稿，建議校閱後使用」。切換後立即重新載入，分類與搜尋保留；載入或切換失敗會顯示錯誤並保留既有清單。
- 隔離：切換只重載評語庫，不動目前批注、分數或已插入文字；隱藏視窗驗證切換前後畫面的總評與總分一致，資料庫批注數與 `scores` 不變。
- `m3:check` 擴充至 31/31：雙庫條數／schema、`libraryForGrade` 四種學制與覆寫／非法模式、payload 版本、IPC senior→junior→senior、UI 下拉與草稿提示、切換後清單 ID 由 `E-` 變 `JE-` 再回 `E-`。
- 回歸：`typecheck`、`build`、`m1:check` 11/11、`m3:check` 31/31、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`junior:check` 17/17、`library:wording`、`library:structure`、`library:coverage`、`spike` 通過。

### 短評侷限用語清洗驗收（2026-11-21）

- 範圍：只動 sentence／structure／praise；comment 內容與 typo 的必要字詞規則不動。junior 修正 36 條（typo 4、sentence 18、structure 9、praise 5），senior 修正 29 條（sentence 20、structure 8、praise 1）。
- 語句：不再引用具體詞句，近義詞改寫成「強調取用／隨身攜帶」這類對比，因果與並列改用連接詞類型描述；口語詞、句尾語氣詞、文白語體改以條件式說明，保留拆句、補主語、換詞、刪贅字等修改方向。
- 結構：固定段落編號改為「這一段／有一段／開頭／結尾」；移除事件、人物、地點與數量假設，保留段落功能、比例、順序、過渡、首尾與完整度等可操作建議。
- 佳句：只描述文本技巧，例如具體畫面、動作承載情緒、對比、對話、節奏、首尾呼應、留白與引用自然，不假設特定物件、身體反應或場景。
- 檢查：新增 `npm run library:short`，只掃 sentence／structure／praise；禁止引號、結構類段落編號、20 個特定事件／人物詞、過短與正規化重複，違規列出 ID 並 exit 1；typo 不在此限。
- 文件：兩份評語庫開頭加入短評清洗規則；README／progress／plan 同步記錄。
- 驗收：`junior:render`、`junior:check` 17/17、converter（138 條，comment 72）、`library:wording`、`library:structure`、`library:coverage`、`library:short`、`m3:check`、`typecheck`、`build` 通過；junior／senior 各 138 條，子類數量不變。
- 抽樣：junior 10 條、senior 10 條，均未假設特定詞句、段落編號、事件或人物，且仍可獨立使用並保有具體修改方向。

### 國中評語庫白話化驗收（2026-11-21）

- 範圍：只改 `junior.draft.json` 的 text；ID、分類、subtype、tags、disabled、source 與五面向歸屬不變。維持 junior 138 條、comment 72 條。
- 指定更換：JE-10 改為通用錯字提醒，不再寫特定字詞；JS-13 改為通用重複提醒，不假設親眼看見；JG-01 改為通用佳句讚美，不假設身體反應；JG-02 改為通用開頭讚美，不假設聲音描寫。
- 全面白話化：共修正 95 條（typo 1、sentence 19、structure 8、praise 6、comment 61）。脈絡、層次、張力、論證、收束、鋪陳、留白等抽象詞改為前後順序、一步一步、對比清楚、說理、收尾、先寫清楚等日常說法；長句拆短，避免命令語氣。
- 檢查：新增 `npm run junior:readability`，只掃 junior 評語文字，出現 31 個抽象術語即列出 ID 並 exit 1，單條去標點超過 90 字只警告；`validate_library_structure.mjs` 詞彙表加入先後、重點、收尾、各段等白話同義詞。
- 文件：`comment-library-junior.md` 開頭加入平鋪直敘原則；README／progress／plan 同步記錄。
- 驗收：`junior:render`、`junior:check` 17/17、`junior:readability`、`library:wording`、`library:structure`、`library:coverage`、`library:short`、`m3:check`、`typecheck`、`build` 通過。
- 抽樣：junior 15 條（typo 3、sentence 3、structure 3、praise 3、comment 3），均為國中生可懂的日常說法，未見抽象術語、特定題材假設，並保留具體修改方向。

### 國中用詞辨析評語重寫驗收（2026-11-21）

- 範圍：只改 `junior.draft.json` 的 JS-08～JS-11 四條 word_choice；ID、分類、subtype、tags、disabled、source 與五面向不變。
- 改寫：直接寫出「哪個詞用在哪裡」，例如拿是取過來、帶是帶著走；參加是加入活動、參觀是到現場看；發現是後來看到或找到、發明是做出以前沒有的東西；JS-11 指出「很棒」「很好」擠在一起卻沒說好在哪裡。
- 檢查：`library:short` 調整為 sentence 的 word_choice 可用引號標示具體詞語，其他 sentence、structure、praise 仍禁用；輸出訊息會標明此例外，其餘段落編號、禁用題材、字數與重複檢查不變。
- 文件：`comment-library-junior.md` 短評規則加入用詞辨析引號例外；README／progress／plan 同步記錄。
- 驗收：`junior:render`、`junior:check` 17/17、`junior:readability`、`library:wording`、`library:structure`、`library:coverage`、`library:short`、`m3:check`、`typecheck`、`build` 通過；junior 維持 138 條、comment 72 條。

### D13 常用排序與釘選驗收（2026-11-21）

- Core：新增 `LIBRARY_SORTS`／`LibrarySort`、`normalizeLibrarySort`、`LibraryUsage`、`LibraryPrefs` 與 `sortLibraryEntries`。排序一律回傳新陣列；釘選條目永遠在前，釘選內依累計次數由高到低、同次數保持原順序；`default` 其餘依原順序、`usage` 依累計、`unused` 先排本批 0 次再依累計；未知 pin 忽略、缺少 usage 視為 0。
- 使用次數：`getLibraryUsage(classId, assignmentId)` 只讀 `work.json`，annotation 的 `library_id` 每出現一次算 1 次、`final_comment.library_id` 算 1 次；`current` 只算目前作業，`overall` 掃同班所有作業。損壞檔案以 `WorkSchema` 驗證後略過並寫 warning，不影響其他作品，也不改寫任何檔案。
- Settings：新增 `librarySort`（預設 `default`）與 `libraryPins`（預設空陣列）；讀寫都會正規化，非法排序回 `default`、pins 去空白去重且只留字串。切換版本時未知 id 仍保留，切回原版本會再生效。
- IPC／preload：新增 `library:usage`、`library:get-prefs`、`library:set-prefs`，preload 對應 `library.usage`、`library.getPrefs`、`library.setPrefs`；非法 sort 由 `set-prefs` 拒絕。
- ReviewView：排序下拉「預設／常用（累計）／本批未用優先」、每條釘選／已釘選按鈕與「本批 N 次、累計 M 次」；搜尋與分類照常運作。排序與釘選即時套用，寫入 settings，重開面板與重新載入視窗後仍保留。從評語庫插入會記錄 `library_id`／`library_version`；手動改寫後清除來源，不影響插入、批注、分數或 autosave。
- 驗收：`m3:check` 擴充至 38/38，涵蓋三種排序、釘選優先與同次數穩定、未知 pin、兩份作品＋另一份作業的本批／累計計數、損壞 work.json 略過與只讀檢查、settings 寫入／重讀／非法值／去重、三支 IPC、UI 排序／釘選／次數標示、收合再展開與重新載入後保留。
- 回歸：`typecheck`（desktop＋core）、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 38/38、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、`junior:check` 17/17、`library:wording/structure/coverage/short`、`spike` 通過。
- 已知限制：累計需掃描同班所有作業，作品或作業很多時會顯示「使用次數統計中」，但清單仍可操作；沒有 `library_id` 的舊作品或手動改寫過的評語不列入次數；釘選與排序是使用者層級的全域偏好，不分班級或資料庫。

### D22 跨批冷卻輪替驗收（2026-11-21）

- Core：`LIBRARY_SORTS` 加入 `rotation`，標籤「冷卻輪替（久未用優先）」；新增 `DEFAULT_COOLDOWN_DAYS = 30`、`isCooldownDays`／`normalizeCooldownDays`（1–365 整數，非法值一律回 30）、`LibraryUsage.currentLastUsed`／`overallLastUsed`、`LibraryPrefs.cooldownDays`；`sortLibraryEntries` 新增 `lastUsed`／`cooldownDays`／`now` 選項。
- 排序規則：非釘選先分冷卻群（從未使用或超過天數）與近期群，冷卻群在前；冷卻群內從未使用最前，其餘依最後使用時間由舊到新；近期群亦由舊到新；同時間再依累計次數由少到多，最後保持原順序。釘選仍固定最前，釘選內依累計次數。
- Repository：`getLibraryUsage` 的時間由 `work.json` 推導，批注用 `annotation.created_at`、總評用該作品 `updated_at`，同一條取最新；缺少或無效時間忽略，損壞檔案照舊略過，仍不寫檔。
- Settings／IPC／preload：新增 `libraryCooldownDays`，讀寫皆正規化；`library:set-prefs` 與 `library.setPrefs` 接受 `cooldownDays`，非 1–365 整數會拒絕。
- ReviewView：排序下拉改由 `LIBRARY_SORTS` 產生並含冷卻輪替；選用後出現冷卻天數輸入（1–365）與「上次使用：YYYY-MM-DD／尚未使用」；偏好排隊寫入，重開面板與重新載入視窗仍保留。
- 驗收：`m3:check` 擴充至 46/46。rotation 實測順序 `A,B,E,D,C`（A 從未使用、B 40 天、E 31 天、D 20 天、C 5 天，冷卻天數 30）；釘選 C、D 後為 `C,D,A,B,E`；邊界 1／365 合法，0／366／3.5／字串／null 皆回 30，寫入非法值會被拒絕。
- `getLibraryUsage` 實測：sentence 本批 4 次、comment 本批 3 次、另一作業的 comment 只進 overall；批注時間取自 `created_at`，總評時間取自 `updated_at`，`current` 與 `overall` 分開且取最新。
- UI 實測：下拉含 rotation、天數預設 30 → 改 45 並寫入 settings、尚未使用排前、上次使用文字出現、重新載入後排序與天數皆保留。
- 文件：README／`docs/使用說明.md`／features／plan／progress 同步記錄。
- 回歸：`typecheck`、`build`、`m1:check`、`m2:check`、`m3:check` 46/46、`m4:check`、`m5:check`、`m6:check`、`m7:check`、`drive:check`、`excel:check`、`match:check`、`batch:check`、`compare:check`、`junior:check`、`library:wording／structure／coverage／short`、`spike` 通過。

### G6 佳句庫累積驗收（2026-11-21）

- Core：`packages/core/src/praise.ts` 的 `buildPraiseBank(works, assignments, generatedAt?)` 為純函式，只掃 `status === 'done'` 且 `category === 'praise'` 的批注；以 `normalizeComment` 去變數、標點、空白後合併，保留第一次出現的原文。
- 欄位：每筆含 `text`、`normalized`、`count`、`workCount`、`assignments`（id／title／dueAt，去重且依 id 排序）、`firstAt`／`lastAt`；時間取 `annotation.created_at`，缺漏時退回 `work.updated_at`。排序為 count 高→低、lastAt 新→舊、最後才依原文。
- 去識別：輸出型別完全沒有座號、姓名欄位；`getPraiseBank` 只回傳彙整後的佳句，不帶任何作品或班級名單。
- Repository：`getPraiseBank(classId?)` 只讀；給 classId 時只掃該班，省略時掃根目錄下所有合法班級與作業。`assignment.json` 無法讀取或 `work.json` 損壞的項目會記 warning 後跳過，不讓整次查詢失敗。
- IPC／preload：`praise:bank(classId?)` 與 `window.electronAPI.praise.bank`；另有 `clipboard:write`／`clipboard.writeText`，只在使用者按複製時寫入。
- UI：右上角「佳句庫」開啟覆蓋式面板，顯示「N 句、M 次使用」；可切本班／全部班級、搜尋原文、複製單筆或全部篩選結果，並有載入、空白、錯誤與關閉狀態。
- `npm run praise:check` 15/15：2 班、3 份作業、6 份作品（含 `grading`／`pending`）。本班 4 句 7 次、全部 5 句 8 次；P1 經正規化後 3 次／3 份、來源作業 `E20261101`、`E20261115` 依 id 排序；P1 首末時間 `2026-11-01`→`2026-11-18`（最後一筆缺 `created_at`，正確退回 `work.updated_at`）；排序為 P1（3 次）→ P2（2 次）→ P4（1 次、`11-18`）→ P3（1 次、`11-01`）。
- 去識別實測：序列化 1,154 bytes，不含測試姓名（測試甲生等 5 人）、`S71`／`S72`、`seat`／`name` 欄位；`grading`／`pending` 的佳句、語句與總評批注皆未收錄。
- Repository 實測：本班查詢 4 句／7 次且不含他班；全部查詢 5 句／8 次；插入損壞的 `assignment.json` 後仍為 5 句／8 次，沒有拋錯。
- UI／preload 實測：主畫面有「佳句庫」、面板預設顯示「4 句、7 次使用 · 高中302」、切全部變 5 句／8 次、搜尋「口袋」由 5 筆縮為 1 筆再清除、清單不含姓名／座號、單筆與全部複製按鈕及關閉按鈕皆存在、關閉後面板消失；`praise.bank` 本班／全部與 `clipboard.writeText` 型別皆正確。
- 回歸：`typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 46/46、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、`praise:check` 15/15、`junior:check` 17/17、`library:wording/structure/coverage/short`、`spike` 通過。
- 已知限制：佳句庫一次掃描指定範圍內所有作業與作品，資料量大時開啟面板需等待；沒有分頁或虛擬列表。只以文字正規化去重，不會判斷語意相近的改寫句。範圍只有「本班／全部班級」，沒有單一作業或日期區間篩選。面板不提供編輯或停用佳句，來源仍是 `work.json`。複製全部會以空行串接目前篩選結果，尚未提供 CSV／Markdown 匯出。

### D23 停用取代刪除驗收（2026-11-22）

- Core：新增 `applyLibraryDisabled(payload, disabledIds)`，依停用清單把條目標記 `disabled=true`，回傳新 payload；仍保留所有條目供管理與重新啟用，且不改動內建常數。清單會忽略非字串與空字串並去重。
- Settings：新增 `libraryDisabled`（`junior`／`senior` 各一組 id）；讀寫皆經 `normalizeLibraryDisabled`，缺少或格式錯誤一律補成空陣列，寫入時只留字串並去重。另有 `readLibraryDisabled(libraryId)`／`writeLibraryDisabled(libraryId, ids)`，只改指定版本。
- IPC／preload：`library:get` 依目前版本套用該版本停用清單；新增 `library:set-disabled`，驗證 `libraryId`（`junior`／`senior`）、`entryId`（非空且存在於該版本）與 `disabled`（boolean），非法值直接拒絕。preload 對應 `library.setDisabled`。
- ReviewView：面板右上角新增「管理／完成管理」切換；管理開啟時顯示停用說明、淡化停用條目、標示「已停用」並提供「停用／啟用」按鈕；管理關閉時停用條目從清單隱藏。停用期間插入按鈕停用，避免誤用。
- 舊批注快照：停用只改設定與清單，不寫 `work.json`。已插入或已批閱的作品仍保留當下的文字與 `library_id`，停用或重新啟用都不會改寫。
- 驗收：`m3:check` 擴充至 59/59。settings 預設 `junior`／`senior` 皆空陣列；寫入重複與非字串後為 `JC-01`／`C-01,C-05`，只改 senior 不影響 junior；非法值（版本、空 id、不存在 id、非 boolean）4 種皆拒絕。
- IPC 實測：停用 `C-05` 後 `library:get(senior 班)` 仍回 138 條且 `C-05 disabled=true`；重新啟用後 `disabled` 回到原值、停用清單回到空。停用 junior `JC-01` 時 senior payload 不受影響，切到 junior 才看到 `JC-01 disabled=true`。
- UI 實測：有「管理」與停用說明；停用 `C-01` 後關閉管理即消失，重新載入仍停用；開啟管理顯示「已停用」與「啟用」，按啟用後恢復可插入；停用 `C-01` 後切國中版 `JC-01` 仍啟用，停用 `JC-01` 再切回高中職 `C-01` 仍停用，兩份清單互不影響。
- 舊批注快照實測：停用 `C-05` 後 `S07/work.json` 位元組完全不變，總評文字與 `library_id`（`C-05`）、批注「此句可再精簡」與來源 `S-01` 全部保留。
- 文件：README／`docs/使用說明.md`／features／plan／progress 同步記錄。
- 回歸：`typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 59/59、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、`praise:check` 15/15、`junior:check` 17/17、`library:wording／structure／coverage／short`、`spike` 通過。
- 已知限制：停用是全域 UI 設定，不分班級或資料庫；切換版本只顯示該版本清單。停用不會改寫既有作品，也不會自動替換舊批注，老師仍需手動調整已批內容。停用清單只存 id，若未來版本移除該 id，設定會保留但不再有對應條目。

### D11 自訂評語增刪改驗收（2026-11-22）

- Core schema／library：新增 `CustomLibrarySchema`／`CustomLibraryFile`，只存自訂條目（`source` 一律 `custom`）；新增 `normalizeCustomTags`、`validateCustomLibraryEntry`、`mergeLibraryEntries`。驗證涵蓋類別、子類（typo／praise／other 固定 general）、去空白後非空、comment 以 `countFinalChars` 至少 30 字、與內建或其他自訂文字正規化後不可重複；合併時內建 id 優先，自訂不覆蓋內建。
- 儲存：`main/data/library-custom.ts` 的 `readCustomEntries`／`writeCustomEntries` 存 `<db>/_library/{junior|senior}.json`，使用原子寫入與 `.bak` 回復；無資料庫或檔案不存在回空清單，不視為錯誤。`writeCustomEntries` 另擋重複 id，避免檔案出現兩筆同 id。
- IPC／preload：`library:get` 合併目前版本的自訂條目後再套用停用清單；`library:save-custom` 新增時產生 `CUSTOM-*` id，編輯時只接受既有自訂 id；`library:delete-custom` 只刪自訂，內建 id 回「內建評語不可刪除，請改用停用」。preload 對應 `library.saveCustom`／`library.deleteCustom`。
- ReviewView：管理模式新增「新增評語」；表單可選類別／子類、輸入文字與逗號分隔標籤，comment 顯示字數與 30 字提示；自訂條目顯示「自訂」標籤與「編輯／刪除」，刪除前確認。表單錯誤訊息留在表單內，不關閉清單。
- CSS：新增 `.rv-custom-form`、`.rv-custom-form-title`、`.rv-custom-form-row`、`.rv-custom-form-actions`、`.rv-lib-tag-custom`、`.rv-lib-edit`、`.rv-lib-delete`；表單在面板內不溢出，textarea 可垂直捲動，長評語與長標籤會換行，刪除使用 danger 色。
- 驗收：`m3:check` 擴充至 72/72。自訂檔案實測 `_library/senior.json` 為 schema 1、`library_id=senior`、1 條，合併後 139 條；空文字、comment <30、非法類別、非法子類、與內建重複、與自訂重複 6 種皆被拒，合法輸入通過，tags 去空白去重。
- 健壯性：重複 id 寫入被拒且既有檔案位元組不變；關閉再重開資料庫後仍讀回 `CUSTOM-D11-1`；自訂列入使用次數（本批 1 次），刪除後 `S11/work.json` 位元組不變、總評文字與 `library_id` 保留。
- UI／IPC 實測：新增後 `library:get` 出現 `CUSTOM-*`、`source=custom`、tags 正確並顯示「自訂」；編輯文字與標籤後重讀一致；comment <30 顯示錯誤且可取消；重新載入後仍在；可停用（payload `disabled=true`、插入停用）再啟用；插入後總評含自訂文字且 `library_id` 正確、本批次數 1；刪除後清單與 API 皆消失，內建 `C-05` 刪除被拒並提示停用；空文字、短評語、非法類別／子類、重複內建／自訂文字、重複內建 id、非自訂 id 共 8 種皆拒絕。
- 文件：README／`docs/使用說明.md`／features／plan／progress 同步記錄。
- 回歸：`npm run typecheck -w @essay-grader/core`、`npm run typecheck`、`npm run build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 72/72、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、`praise:check` 15/15、`junior:check` 17/17、`library:wording／structure／coverage／short`、`spike` 通過。
- 已知限制：自訂評語存在各資料庫內，換資料庫或搬移資料庫時需連同 `_library/` 一起備份；目前沒有匯入／匯出或跨資料庫複製。刪除自訂後，`settings.json` 可能保留已不存在的停用 id，但不影響清單。重複文字只做正規化比對，不判斷語意相近的改寫。既有作品的 `library_id` 不會因自訂評語刪除而清除，仍可在統計中看到歷史次數。

### D21 評語庫版本更新驗收（2026-11-22）

- Core：`CustomLibrarySchema` 新增 `imported`（預設空陣列）與 `imported_version`（選填），舊檔缺少時可正常讀取；新增 `mergeLibraryLayers(base, imported, custom)`，依序合併並略過撞 id 的後層條目，回傳 `duplicateIds` 供記錄。
- 儲存：`main/data/library-custom.ts` 改以 `readLibraryAdditions`／`writeLibraryAdditions` 讀寫同一份 `_library/{junior|senior}.json` 的 `entries`（自訂）與 `imported`（匯入）；寫入時自訂一律 `source=custom`、匯入一律 `source=builtin`、`disabled=false`，並保留 `imported_version`。
- 匯入：`main/data/library-import.ts` 的 `importLibraryFile(libraryId, path)` 先驗證版本、讀檔與 `LibrarySchema`，再檢查空白 id、檔案內重複 id、空條目；比對 base＋imported＋custom 的 id 與 `normalizeComment` 文字，只把缺少的條目寫入。沒有新增時直接回報，不寫檔、不改版本。
- IPC／preload：`library:get` 以 base→imported→custom 合併，版本在有匯入條目時改用 `imported_version`，最後套用 D23 停用；`library:set-disabled` 也接受 imported id。新增 `library:import`（JSON 檔案選擇器，取消回 `canceled`）與 preload `library.importFile`。
- ReviewView：管理模式新增「匯入新版」按鈕，匯入中顯示「匯入中…」；成功後顯示「匯入完成：新增 N 條、略過既有 N 條、略過重複文字 N 條、版本 …」，並立即重新載入清單；管理模式與搜尋條件保留。
- 驗收：新增 `library-import:check` 19/19。匯入檔 5 條（2 條全新文字、1 條既有內建 id、1 條新 id 但文字正規化後重複、1 條 `source=custom` 的新 id）→ 新增 3、`skippedExistingId` 1、`skippedDuplicateText` 1、版本 `2099.1-test`、總數 142（base 138＋imported 3＋custom 1）。
- 合併與版本實測：順序為 base→imported→custom（前三筆 imported 依檔案順序、自訂最後）、`duplicateIds` 空、版本 `2099.1-test`；內建 `E-01` 文字不變、3 條新評語可見；`source=custom` 的匯入條目變成 `builtin`、`disabled=false`。
- 保留實測：匯入前後自訂 1 條（`CUSTOM-D21-1`）與 D23 停用清單（`E-03`、自訂 id）完全一致；把 `D21-NEW-1` 加入停用清單後 payload `disabled=true`，自訂也停用，未列入的 `D21-NEW-2` 仍為 `false`。
- 重複與版本實測：再次匯入同檔 → 新增 0、略過既有 4、略過重複文字 1、版本與總數不變、檔案位元組完全不變；只含略過項目的 `2099.2-no-new` → 新增 0、版本維持 `2099.1-test`、位元組不變。
- 版本隔離實測：國中版匯入 1 條 → 139 條／版本 `2099.1-junior`，高中職仍 3 條／`2099.1-test`。
- 相容與還原實測：移除 `imported`／`imported_version` 的舊檔可讀（自訂 1 條、imported 0、版本回到內建 `2026.1`）；主檔損壞後由 `.bak` 還原，自訂 1 條、imported 4 條、版本 `2099.3-ui`。
- 錯誤實測：檔案不存在、JSON 損壞、schema 不合（皆「評語庫檔案格式不正確」）、沒有條目、檔案內 id 重複、空白 id、無資料庫（「尚未開啟資料庫」）、非法 libraryId（「評語庫版本不合法」）皆被拒且訊息繁中；錯誤匯入不改寫 `_library`。
- UI 實測：管理模式有「匯入新版」、preload `library.importFile` 存在；以替換回傳值的系統選擇器模擬匯入 `2099.3-ui` 1 條 → 搜尋「介面匯入」由 0→1 條、版本文字更新為 `高中職版 · 2099.3-ui`、`library:get` 143 條、管理模式與搜尋字串保留、匯入條目 `source=builtin`、`disabled=false`。
- 文件：README／`docs/使用說明.md`／features／plan／progress 同步記錄。
- 回歸：`typecheck`、`build`、`library-import:check` 19/19、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 72/72、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、`praise:check` 15/15、`junior:check` 17/17、`library:wording／structure／coverage／short`、`spike` 通過。
- 已知限制：只支援 JSON 評語庫檔，沒有 CSV 交換（D15 另計）；匯入採整檔驗證，檔案內任一空白／重複 id 會整份拒絕，不做部分匯入；只記錄一份 `imported_version`，沒有逐條來源版本或衝突比對介面；匯入條目在清單中不另標「匯入」，與內建條目外觀相同，只能由 `_library` 檔的 `imported` 陣列辨識；系統檔案選擇器無法自動化，驗收以替換回傳值模擬。

### M8 Android 掃描器與桌面 manifest 驗收（2026-11-22）

- 桌面 manifest：新增 `main/import/manifest.ts`、IPC `import:write-manifest(classId)`、preload `imports.writeManifest(classId)` 與 ImportPanel 的「產生手機 manifest」按鈕。內容為 `schema_version` 1、ISO `generated_at`、目前班級 id／name／grade、該班全部作業 id／title，以及 `active !== false` 學生的 seat／name；不含分數、批注、總評、`updated_at` 或作品內容。
- 寫入位置與安全：寫在 `settings.externalInboxRoot/manifest.json`，使用 `.tmp`→fsync→rename 原子覆蓋，舊檔先留 `.bak`；沒有外部 root 或資料夾不存在時回繁體中文錯誤。manifest 含學生姓名，文件已提醒放在受控的 Drive 資料夾，不要公開分享。
- `manifest:check` 11/11：建立 1 班（S07／S08 在學、S12 不在學）與 2 份作業（E20261110、E20261120）；結果 classes 1、assignments 2、students 2（只含 07、08）。JSON 只有 10 個必要 key，無分數／批注／總評／`updated_at`；`generated_at` 是有效 ISO。寫入無效內容後重新產生可覆蓋，無 `.tmp` 殘留且有 `.bak`；清除 root 後回「尚未設定 Google Drive inbox…」。UI 按鈕、preload 與成功提示（路徑、1 班級、2 份作業、2 位在學學生）皆通過。
- Android 專案：`apps/android/`，AGP 8.7.3、Kotlin 2.0.21、Gradle 8.9、compileSdk 35、minSdk 24、JDK 17。App 從 Drive 根目錄讀 `manifest.json`，缺檔／格式錯／空清單皆有繁中錯誤；只列在學學生；以 SAF 選資料夾並保存權限；ML Kit Document Scanner 多頁掃描（上限 20 頁）；輸出 `S07__session__001.jpg`＋同名 sidecar 到 `<root>/<classId>/<assignmentId>/`；上傳失敗或離線時寫入 App 私有 pending 佇列，可「重新上傳待上傳」。
- 工具鏈：新增 `tools/android.ps1`，預設 `:app:assembleDebug`，優先使用 `JAVA_HOME`／`ANDROID_HOME`，否則 `M:\dev\tools\jdk` 與 `M:\dev\tools\android-sdk`，同時設定 `ANDROID_SDK_ROOT`；缺少工具鏈或 `gradlew.bat` 時回繁中錯誤。`package.json` 新增 `android:test`、`android:build`、`m8:check`（測試＋建置）與 `manifest:check`。
- Android 測試：`npm run android:test` 通過，13 個 JVM 測試（Filenames 5、ManifestParser 4、PendingMeta 2、Sidecar 2），XML 顯示 failures 0、errors 0、skipped 0。
- APK：`npm run android:build` 通過，`apps/android/app/build/outputs/apk/debug/app-debug.apk` 存在，6,629,853 bytes（約 6.3 MB）。`npm run m8:check` 測試與建置皆成功。
- 回歸：`typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 72/72、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23（未破壞既有 23 項）、`manifest:check` 11/11、`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、`praise:check` 15/15、`library-import:check` 19/19、`junior:check`、`junior:readability`、`library:wording`、`library:structure`、`library:coverage`、`library:short`、`validate:fixtures`、`spike` 全數通過。
- 待實機驗證：ML Kit 掃描／裁切與多頁品質、Google Play services 缺失時的提示、SAF 權限保存與撤銷、Google Drive 上傳與離線補傳、桌機端「manifest → 手機掃描 3 頁 → Drive → 自動匯入」端到端流程。B2 拖拉排序、B6 自動回相機、B7 逐頁清單／重拍刪除尚未實作。

### D19 近似重複偵測驗收（2026-11-22）

- 核心：`packages/core/src/review.ts` 新增 `FINAL_SIMILARITY_THRESHOLD = 0.85`、`commentSimilarity`（`normalizeComment` 後取字元 bigram 的 Jaccard；單字元改用 unigram；任一方為空回 0）、`findSimilarFinalComments`（門檻以上才列入，依相似度高到低、座號小到大，`exact` 表示正規化後完全相同）與 `FinalReuseMatch`／`FinalReuseResult`。`validateWork` 訊息改為「同批已用 N 次（含相同或近似）」。
- Repository：`countFinalReuse` 回傳 `count`／`seats`／`matches`，排除自己與空文字；`work:reuse` IPC 沿用。
- 批次檢查：`packages/core/src/audit.ts` 的 `final_reuse` 改為依座號逐一比對前面已處理作品，相同或近似（同一門檻）計入；前 `final_max_reuse` 次合法，超過才標記；訊息為「相同或近似的總評已用於座號 …（N 次），這是第 N+1 次，超過上限 M 次」。仍只比對 `final_comment.text`，不用姓名、不改 `work.json`。
- ReviewView：顯示「同批已有 N 份使用相同總評」或「同批有 N 份相近總評（座號 百分比）」，近似計入 `final_max_reuse`；達上限紅字阻擋。
- 測試資料：`m4:check` 的 29 份合法作品（加上 S43、S44 共 31 份）改為各自獨立的總評，不再只改座號；未評分與總評不足各 5 份也各自不同。實測 44 份作品兩兩最高相似度 0.085（`valid5` 與 `valid30`），遠低於門檻，因此未放寬門檻。
- 新增 `npm run similarity:check`（`apps/desktop/src/main/data/similarity-check.ts`，`--similarity-check`）13/13。
  - 相似度實測：完全相同 1（exact=true）；改「段落之間→段落間」0.9348、「銜接→連接」0.9149，皆 ≥0.85 且非 exact；明顯不同 0.0317；只多一個「再」0.8421，低於門檻不計入；空字串與僅標點皆 0；單字元「好」vs「好！」=1、「好」vs「的」=0。
  - findSimilar 排序：`02,09,07,04`（前兩筆 exact，後兩筆近似，相似度 0.9348 排在 0.9149 前）；exact 與近似不重複；門檻等於相似度時列入，高於則排除。
  - countFinalReuse（座號 01）：count 3、seats `02,03,04`、exact `true,false,false`；排除自己與空白，門檻外的 06 與不同的 05 不列入；空白查詢回 0。
  - 批次檢查：標記 `03,04`，與獨立以相似度計算的結果 7/7 一致；訊息列出 01、02 並說明「相同或近似」與第 3 次超限；S01、S02、S05、S06、S07 無誤標。
  - 批閱 UI（獨立資料庫）：API `work:reuse` 回傳 1 筆近似（非 exact）；輸入近似文字後顯示「相近 01 93%」；加入第二份相同總評後顯示「已用 2 次（01 93%、03 93%）、已達上限」紅字（背景 rgba(192, 57, 43, 0.09)）；改為完全相同文字後顯示「（01、03）」，確認相同與近似一起計入。
- m4 驗收：`m4:check` 17/17；在學 45、已匯入 44、待批 0、批閱中 11、已批 33、未匯入 1；問題 14、提醒 11、合計 25 不變；重複組 S40／S41 合法，只標 S42。
- 已知限制：只比對 `final_comment.text`，其他批註的近似重複不在本輪；字元 bigram 無法判斷語意改寫，換句話說或語序大幅改變時相似度會下降；短總評（約 20 字以下）的 bigram 數量少，兩三字差異就可能明顯改變相似度；僅限同一作業；批閱畫面計數的是同批所有其他作品，批次檢查則只看座號在前的作品（兩者同門檻，但第 N 份的計數基準不同）；門檻 0.85 為固定值，未開放設定。

### 已知限制（M3–M7＋Drive inbox＋E6＋未匹配分配＋F2＋soak＋G4＋G6＋M8）

- soak 以「1 班 45 人、每圈 45 份回饋單」為主，未同時模擬批閱 UI、匯入 watcher、Excel 寫回與備份還原的並行負載；批閱 autosave 只做單份讀寫驗證。
- soak 期間批次吞吐量多數約 37 秒／圈，但曾數次升至約 53–66 秒／圈；前一次 10 分鐘測試在後段回落，本次則在最後兩圈升高。記憶體與視窗數同期沒有累積，研判與主機 I/O／防毒掃描有關，尚未在乾淨機器上重現或排除。
- soak 的記憶體門檻（final 700 MB、peak 800 MB、growth 180 MB）以本機暖機後 baseline 約 290 MB 訂定，換到記憶體較大或顯示卡不同的電腦仍需重跑確認。
- `m2:check` 的 10 張 2600px 匯入時序檢查在原主機約 1–2 秒；目前主機負載下量到 4.6–4.8 秒，已把門檻調整為 8 秒（與既有等待上限一致），功能與配對仍為 13/13。
- 量規預設採用均衡版（40／30／30），之後可調整；三組配分、扣分 0.5／0.5、上限 10 與等第門檻仍為預設值，尚未經老師確認。
- 量規或等第門檻變更不會自動重算既有作品的 `scores`；已批作品若需要新量規的分數與等第，仍要重新開啟該份並完成批閱。
- 等第名稱只檢查去空白後不可為空、不可重複，未限制長度；最低分只接受 0–100，未限制級距間隔。
- 內建評語庫同時載入國中版與高中職版；auto 依班級學制選用，也可手動切換。國中版仍為草稿，尚未經國中國文老師校閱，語氣與題材仍可能調整。
- 高中職總評的混合型區段為 C-21–C-32 共 12 條、情意題 C-43–C-50 共 8 條；`senior.json` 的混合型子類目前記為 general，尚未改為 mixed，待老師校閱時一併確認。國中版六個子類皆為 10 條。
- 成績寫回以單一作業、單一工作表為範圍；ExcelJS 可能微調樣式，含圖表／樞紐／巨集的檔案改走匯出新檔，不直接改原檔。整班批次回饋單已於 F2 補上，但仍以單一作業為範圍。
- 批次回饋單逐份開啟隱藏視窗，份數多時需要時間；失敗或跳過的份數要修正後重跑整批，尚未提供只重跑失敗項。
- 批次取消只在下一份開始前生效，正在產生的那一份會完成；已輸出的 PDF 不會因取消而刪除。
- 批次報告含學生姓名與輸出路徑，屬老師要求的輸出；程式日誌仍不記錄姓名或總評全文。
- 統計只計已批（`done`）作品；批閱中與未匯入不進班級摘要、排行與常錯字，避免數字隨批閱進度跳動。
- G1 佔比以「弱項批注總數」為分母，不含佳句與一般評語；同一份作品多次標記會累計。
- G4 已可比較同班兩份作業，但一次只比一組（目前 vs 一份上次作業），沒有多份趨勢圖、全班長期走勢或題目間整體比較（G5 未做）；比較平均只涵蓋兩邊都有 `done` 分數的學生。
- G4 弱項只比類別層級（錯字／語句／結構／其他），不細分到子類或前三名；新作品與缺資料不列入平均與排行，但學生明細表仍會列出。
- G4 比較結果目前只在 UI 顯示，沒有匯出 CSV／PDF；需要的話可從學生明細表自行截圖或另外複製。
- 佳句庫一次掃描指定範圍內所有作業與作品，資料量大時面板需等待，尚未做分頁或虛擬列表；只以文字正規化去重，不判斷語意相近的改寫句，也沒有單一作業／日期區間篩選或 CSV／Markdown 匯出。
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
- M8 目前只完成建置與 JVM 測試，尚未在實機驗證 ML Kit 掃描／裁切、Google Play services 缺失提示、SAF 權限保存、Drive 上傳與離線補傳；桌機端 manifest 已用合成資料驗收。
- Android 輸出檔名為 `S07__session__001.jpg`＋sidecar，與 features 原規劃的 `S07_王小明/原圖_1.jpg` 不同；桌面端靠 sidecar 與資料夾路由，不依賴姓名資料夾。
- 手機 App 沒有多頁拖拉排序、送出後自動回相機、逐頁已拍清單或重拍刪除；目前依 ML Kit 回傳順序輸出，需重新掃描才能修正。
- manifest 是手動產生的快照，名單或作業變更後不會自動更新；需回桌機重新按「產生手機 manifest」，再到手機重新讀取。
- manifest 含學生姓名與座號，必須放在受控的 Google Drive 資料夾；成功匯入後桌機會刪除來源圖片與 sidecar，但雲端版本紀錄與垃圾桶仍可能保留。
- Android 目前只有 debug APK，未提供正式簽署的發行檔或 Google Play 上架設定。
- 連續執行多個 Electron 驗收時，`m3:check` 與 `library-import:check` 的隱藏視窗 UI 步驟曾出現時序性失敗（分別 70/72、18/19），單獨重跑皆回到 72/72、19/19；功能資料檢查無誤，測試穩定性仍可改善。

---

## 六、施工順序（建議）

1. **能批一份**：資料夾結構 → 批閱介面 → 標記 → 評分
2. **能批一班**：手機掃描 → 自動匯入 → 佇列 → 回饋單
3. **能看出問題**：統計 → 常錯字 → 趨勢
