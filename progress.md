# Essay Grader — Progress

> 最後更新：2026-11-19
> 階段：**M0–M7 完成（備份、日誌、錯誤處理、安裝檔與 portable）；下一步 M8 手機**

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
| `apps/desktop/src/main/import/` | M2 匯入：inbox watcher、sidecar 配對、去重、Excel 名單、sharp 前處理 |
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
- [ ] 補「成績寫回 Excel」規格（欄位對應、覆寫保護、失敗處理）
- [ ] 量規分項／權重／等第預設數值（老師確認）
- [x] 回饋單版面：一頁 A4、只印文字與統計、不印原圖（2026-11-19）
- [ ] 回饋單整班批次 PDF
- [ ] 決定跨裝置搬檔方式（Syncthing／OneDrive／Google Drive／USB）
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
- 打包產物：`EssayGrader-0.1.0-Setup.exe` 134,107,847 bytes（約 127.9 MB）、`EssayGrader-0.1.0-Portable.exe` 120,756,573 bytes（約 115.2 MB）、`EssayGrader-0.1.0-Setup.exe.blockmap` 141,021 bytes；`win-unpacked` 以 `--user-data-dir` 啟動成功，packaged 版日誌正常寫入。第一次打包因 GitHub 下載 Electron 卡住，改用本機已安裝的 `electronDist` 後完成；快取中的 NSIS／7zip 可重用。
- 完整回歸：`typecheck`、`build`、`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`spike` 全通過（FPS 60.0、A4 PDF 178 KB／105 ms、監看 10/10 78 ms、private 446 MB）。

### 已知限制（M3–M7）

- 10 分鐘連續操作 soak 尚未執行，目前只有 `m3:check`、`m4:check`、`m5:check` 的短時間 UI 煙霧與 45 份批次檢查。
- 量規預設採用均衡版（40／30／30），之後可調整；三組配分、扣分 0.5／0.5、上限 10 與等第門檻仍為預設值，尚未經老師確認。
- 量規或等第門檻變更不會自動重算既有作品的 `scores`；已批作品若需要新量規的分數與等第，仍要重新開啟該份並完成批閱。
- 等第名稱只檢查去空白後不可為空、不可重複，未限制長度；最低分只接受 0–100，未限制級距間隔。
- 內建評語庫只有高中職版 126 條；國中版尚未補。
- 成績寫回 Excel 尚未實作；回饋單目前只支援單份，尚未做整班批次 PDF。
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

---

## 六、施工順序（建議）

1. **能批一份**：資料夾結構 → 批閱介面 → 標記 → 評分
2. **能批一班**：手機掃描 → 自動匯入 → 佇列 → 回饋單
3. **能看出問題**：統計 → 常錯字 → 趨勢
