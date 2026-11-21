# Essay Grader

紙本作文掃描 → 桌機批閱 → 評分 → 一頁回饋單 → 分數寫回 Excel。

- 技術棧：**Electron + React + TypeScript**（2026-11-19 定案）
- 版本：**0.1.0（M7 打磨＋交付＋Google Drive 外部 inbox＋成績寫回 Excel＋整班批次回饋單＋10 分鐘 soak＋G4 與上次比較）**
- 手機端：Kotlin + ML Kit（第二階段，只寫 inbox）；現階段可先用手機 Google Drive App 上傳照片
- 資料庫：本地資料夾，全 ASCII，中文只存在 JSON
- 外部 inbox：Google Drive 本機同步資料夾，只搬圖片，資料庫不進雲端
- 隱私：不連網、不埋 telemetry、照片移除 GPS

使用方式、安裝版／portable 差異、批閱流程與常見問題請看 **[docs/使用說明.md](docs/使用說明.md)**。

## 目錄

```
apps/desktop/        Electron 桌機端（main / preload / renderer）
packages/core/       schema（zod）、資料夾命名、匯入規則
fixtures/            3 位學生 × 2 頁的測試專案
docs/                使用說明（安裝、批閱、備份、日誌、FAQ）
features.md / plan.md / progress.md  需求、方案與進度
tools/               圖示與 fixture 產生器
```

## 指令

```powershell
npm install          # 第一次
npm run dev          # 開發模式（electron-vite）
npm run build        # 打包 renderer / main / preload
npm run typecheck    # 兩份 tsconfig 都檢查
npm run spike        # 自動驗證 Canvas／PDF／監看／記憶體
npm run m1:check     # 資料層驗收（建檔、名單、壞檔還原、鎖、主畫面）
npm run m2:check     # 匯入驗收（10 檔配對、去重、unmatched、Excel 名單）
npm run m3:check     # 批閱驗收（EXIF／縮圖、評語庫、量規與等第、計分、驗證、work 存取、UI 煙霧）
npm run m4:check     # 批次檢查驗收（45 人、44 份作品、重複／缺頁／未匯入、UI 煙霧）
npm run m5:check     # 回饋單驗收（資料推導、檔名、單頁 PDF、溢頁阻擋、UI 煙霧）
npm run m6:check     # 統計驗收（G1／G2／G3、分數摘要、CSV 四檔、UI 煙霧）
npm run m7:check     # 交付驗收（備份／還原、zip slip、日誌輪替、ErrorBoundary、打包設定）
npm run drive:check  # Google Drive 外部 inbox 驗收（兩種擺法、去重、PDF、錯誤路徑、UI）
npm run excel:check  # 成績寫回 Excel 驗收（副本、座號、驗證、重複、匯出模式、CSV、UI）
npm run match:check  # 未匹配照片驗收（內外清單、meta、縮圖、指定座號、去重、路徑防護、UI）
npm run batch:check  # 整班批次回饋單驗收（輸出、跳過、溢頁失敗、報告、取消、重複啟動、UI）
npm run compare:check # G4 與上次比較驗收（狀態、平均、弱項、排行、拒絕情境、UI）
npm run junior:render  # 由 junior.draft.json 產生國中版評語庫 Markdown（草稿）
npm run junior:validate # 國中版草稿檢查（條數、id、字數、標籤、與高中職版重複）
npm run junior:check   # 國中版草稿完整檢查，含 Markdown 與 JSON 一致與用語引號檢查
npm run junior:readability # 國中版評語可讀性檢查（抽象術語、過長句子）
npm run library:wording # 兩套評語庫用語檢查（總評／佳句／結構不得用引號）
npm run library:structure # 兩套總評五面向詞彙、引號、字數與重複檢查
npm run library:coverage # 五面向最低條數、19 類結構覆蓋率與 ID 對應檢查
npm run soak         # 10 分鐘連續操作壓力測試（可用 --soak-minutes=1 縮短）
npm run dist         # 同上，產出 NSIS 安裝檔與 portable（apps/desktop/release）
npm run dist:win     # 建置後打包 Windows x64：Setup＋Portable
npm run dist:portable # 只產出 portable
npm run validate:fixtures
```

打包產物（2026-11-20 重新打包，含 F2 批次回饋單）：

- `apps/desktop/release/EssayGrader-0.1.0-Setup.exe`：134,137,825 bytes（約 127.9 MB）
- `apps/desktop/release/EssayGrader-0.1.0-Portable.exe`：120,788,287 bytes（約 115.2 MB）

打包設定在 `apps/desktop/electron-builder.yml`：appId `tw.edu.essaygrader`、win x64、NSIS（可選安裝路徑＋桌面捷徑）與 portable、asar、sharp／@img asarUnpack、`npmRebuild: false`。設定使用已安裝的 Electron runtime（`electronDist`），避免每次重新下載；第一次打包仍可能需要下載 NSIS／7zip，離線環境會失敗，但不影響開發與驗收。

## 固定 M: 磁碟

專案路徑約定為 `M:\dev\projects\essay-grader`。若把專案磁碟接到新主機後拿到其他代號，
先關閉使用該磁碟的程式，再以**系統管理員**開啟 PowerShell 執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\fix-m-drive.ps1
```

腳本會把專案所在磁碟區改成 `M:`；已在 `M:` 時不會變更，`M:` 已被其他磁碟占用時會停止並提示先釋放。
變更磁碟代號需要系統管理員權限，完成後請重新開啟終端機與編輯器。

匯入流程：在作業上按「開啟 inbox」放入圖片＋sidecar，watcher 會自動配對；
「模擬 10 檔」可在沒有手機的情況下測試匯入。

Google Drive 外部 inbox：在匯入佇列表按「設定／變更」選擇 Google Drive 本機同步資料夾，
桌機就會遞迴監看。支援 `<root>/<classId>/<assignmentId>/` 子資料夾（可無 sidecar，靠檔名座號）
與 `<root>/` 扁平模式（一定要 sidecar）。成功匯入後刪除雲端來源圖片與 sidecar；
重複檔移到 `_duplicates/`，失敗檔移到 `_unmatched/` 並附 `.reason.txt`。
只支援 JPG／JPEG／PNG，PDF 會進 `_unmatched`。資料庫仍只放本機，不進雲端。

量規預設採用**均衡版**（40／30／30），之後可調整。另外提供內容導向 45／25／30、
語言導向 35／30／35；扣分皆為錯字 0.5／標點 0.5、上限 10，等第門檻相同。
數值仍為預設值，可再調整。建立作業時可改選其他 preset；進入批閱後、評分前也可按
「調整量規」修改 preset、自訂配分，以及新增／刪除等第並編輯名稱與最低分。
等第至少一筆、名稱不可空白或重複、最低分須為 0–100 且不可重複，儲存時由高到低排序；
表單會即時顯示目前總分落在哪一級。若該作業已有評分，變更前會先確認；只影響之後的計算，
已儲存的分數與等第不會自動改寫，目前這份的預覽會用新量規重算，完成批閱時才寫入。

### 國中版評語庫（草稿，依學制自動選用）

`packages/core/src/library/junior.draft.json` 與根目錄 `comment-library-junior.md` 是國中版
138 條草稿，分類與子類數量比照高中職版，語氣與題材改以七～九年級、國中教育會考寫作測驗為主。
runtime 已同時載入國中版與高中職版：預設 `auto` 會依班級學制的 `grade` 自動選用，
`junior` 用國中版，`senior`／`vocational` 用高中職版。批閱畫面的評語庫面板可手動切換
「自動（依學制）／國中版／高中職版」，切換會立即重新載入清單，但不會動到目前批注、分數或已插入文字；
偏好會寫入 `settings.json` 的 `libraryMode`，重開程式仍保留。要回到高中職版，選「自動（依學制）」
或「高中職版」即可。

**國中版仍是草稿**（`library_version` 為 `2026.2-draft`）：面板會顯示「草稿」標籤與
「國中版為草稿，建議校閱後使用」提示，校閱完成前請留意用語。

草稿的 JSON 是唯一來源，修改後執行 `npm run junior:render` 重新產生 Markdown；
`npm run junior:validate` 會檢查條數、子類、id、字數、標籤、變數與高中職版重複，
`npm run junior:check` 另外確認 Markdown 與 JSON 完全一致。

國中版用語以平鋪直敘為主，避免抽象術語；`npm run junior:readability` 只掃評語文字，
列出脈絡、層次、張力等難詞的 ID 並以 exit 1 阻擋，單條超過 90 字只警告。
2026-11-21 已全面白話化 95 條，並更換 JE-10、JS-13、JG-01、JG-02 為通用說法。

國中與高中職兩套總評已改以五個面向編寫：結構、立意取材、語言表達、情感體驗、格式應用。
結構只是其中之一，老師可依文章問題選擇合適的評語；非結構評語不硬塞結構詞。覆蓋率與依據見
`docs/評語庫結構依據.md` 與 `packages/core/src/library/comment-coverage.json`。
`npm run library:structure` 會依面向檢查 144 條總評的詞彙、引號、字數與重複情形。

五面向分布：junior 為結構 33、立意取材 21、語言表達 12、情感體驗 20、格式應用 10；
senior 為結構 33、立意取材 25、語言表達 12、情感體驗 18、格式應用 10。
每條 comment 至少屬於一個面向，可跨兩個面向，兩套皆 72/72 條被覆蓋。

結構依據與覆蓋率：`docs/評語庫結構依據.md` 整理國中教育會考寫作測驗、學測國寫的官方結構
描述，以及教學現場歸納的 16 類通用結構症狀，另加 3 類體裁補充（記敘、抒情、議論）。
19 類分類保留為輔助索引，不要求每條 comment 都被結構分類覆蓋；分類與 ID 對應
放在 `packages/core/src/library/comment-coverage.json`。`npm run library:coverage` 會確認
五面向最低條數、每類在 junior 與 senior 都至少 2 條、ID 存在且 category=comment、
同分類不重複，以及兩份 Markdown 同時含五面向分布與結構覆蓋摘要。

體裁補充由使用者提供的 6 張作文評語表掃描檔抽取結構概念改寫，不直接收錄短標籤、特定題材
或學習態度評語；來源摘要、已採用概念與未採用原因見 `docs/評語參考_使用者提供.md`。

批閱流程：匯入佇列每列按「批閱」進入三欄式介面。左側切換同作業作品，
中間滾輪縮放、拖曳平移、PageUp／PageDown 翻頁，點畫布新增批注；
右側編輯批注（1–5 切換類別）、插入評語庫、評分與填總評。
變更會在 600ms 後自動儲存，完成批閱後自動載入下一份待批作品。

批次檢查：匯入佇列面板按「批次檢查」，一次掃描整班在學學生，列出未匯入、
總評不足、總評重複超限、未評分、缺頁檔案與尚未完成；統計 chips 顯示在學／已匯入／
待批／批閱中／已批／問題數。可切「只看有問題／全部」、重新檢查，或按「前往批閱」
直接開啟該份；從批閱返回時若面板開著會自動重查。問題只會標記總評重複超限的那一份
（依座號順序，前 2 次合法），未完成批閱列為提醒、不算錯誤。

回饋單：作品完成批閱後，匯入佇列該列會出現「回饋單」，批閱畫面右下角也有按鈕。
預覽視窗提供列印、匯出 PDF、另存 PDF；匯出固定存到 `S{座號}/S{座號}_feedback.pdf`，
另存預設為中文檔名 `{班級}_{題目}_S{座號}_{姓名}_回饋單_{日期}.pdf`。
一頁 A4 只印分數、等第、扣分、分項、總評、詞句改寫、常錯字與佳句，不印原圖；
內容過長時會自動降到最小字級，仍放不下就阻擋匯出並提示縮短總評或減少批注。

整班批次回饋單：匯入佇列按「批次回饋單」，面板顯示已批／未完成份數與預估輸出位置。
批次依座號逐份輸出，只處理 `done` 且有分數的作品；未完成或未評分列為跳過，單份溢頁或
錯誤列為失敗，皆不中斷整批。每份保留 `S{座號}/S{座號}_feedback.pdf`，另複製一份到作業
資料夾的 `_feedback/`，中文檔名為 `S{座號}_{姓名}_回饋單.pdf`。報告寫入
`_feedback/report.json` 與 `report.csv`（UTF-8 BOM＋CRLF），含每筆座號、姓名、狀態、
路徑、原因與耗時。批次期間可取消，會在下一份開始前停止；同一時間只允許一個批次。

統計：匯入佇列面板按「統計」，可看班級分數摘要、等第分布、分項平均、G1 弱項排行、
G2 常錯字、G3 每人前三弱項與 G4「與上次比較」。G4 可選同班另一份作業，以座號對齊，
顯示進步／退步／持平／新作品／缺資料、平均（只計兩邊都有分數的學生）、進步與退步前 5、
弱項四類每份平均與學生明細；切換作業會重置比較選擇。按「匯出 CSV」會在該作業資料夾的
`_stats/` 產生 `scores.csv`、`weakness-ranking.csv`、`common-typos.csv`、`student-weakness.csv`，
可直接用 Excel 開啟（UTF-8 BOM）。統計只計已批（`done`）作品；未完成與未匯入的學生
仍列在個人表，但標示「不計入」，不影響班級數字。

連續操作壓力測試：`npm run soak` 會建立 1 班 45 位學生的暫存資料庫，每人 1 份
`done` 作品與 1 頁小圖，預設連續跑 10 分鐘。每圈執行批次檢查、統計、45 份批次回饋單，
再輪替 3 位學生做 autosave 並重新載入驗證；批次前後比對視窗數，每分鐘記錄
private bytes、行程數、視窗數與累計 PDF 數。結束後檢查 45 份 `work.json` 仍可讀、
頁數與分數不變，最後一輪 45 份 PDF 仍為 1 頁且大於 20 KB。報告寫到
`spike-out/soak-report.json`；除錯時可縮短，例如 `npm run soak -- --soak-minutes=1`。

備份與還原：資料庫開啟時，右上角「備份資料庫」會把整個資料庫根目錄存成 zip，
預設檔名 `essay-grader-backup-YYYYMMDD-HHmm.zip`；包含 class／assignment／work、圖片、
`_stats`、`.bak`，排除 `.essay-grader.lock` 與所有 `*.tmp`。zip 內一律相對路徑。
「還原備份」選 zip 後只能解到**新的空資料夾**；目的地非空、目前資料庫或含不安全路徑
（zip slip）一律拒絕。還原成功後會直接開啟新資料庫，舊資料不動。

日誌與錯誤處理：主程序日誌寫到 `%APPDATA%\作文批閱\logs\app.log`，每筆含 ISO 時間與
level，超過約 2 MB 輪替為 `app.1.log`。右上角「開啟日誌」可直接開資料夾。主程序未捕捉
例外、未處理 rejection、畫面程序結束與載入失敗都會記錄；React 有 ErrorBoundary，
顯示友善錯誤畫面、重新載入與開啟日誌，不會整個視窗空白。日誌不記錄學生姓名、總評、
批注全文或圖片內容。

Spike 測試頁：主畫面按「開啟 Spike 驗證頁」，可手動縮放、放標記、匯出 PDF。
自動結果寫到 `spike-out/report.json`。

產生測試頁面圖：

```powershell
powershell -ExecutionPolicy Bypass -File tools/make_fixture_pages.ps1
```

## 目前進度

M0 骨架、M1 資料層、M2 匯入與佇列、M3 批閱核心、M4 批次檢查、M5 回饋單、M6 統計、M7 打磨與交付、
Google Drive 外部 inbox、E6 成績寫回 Excel、未匹配照片手動分配座號、F2 整班批次回饋單、
10 分鐘 soak、G4 與上次比較已完成。
國中版評語庫草稿 138 條已接入 runtime，預設依班級學制自動選用，也可在批閱畫面手動切換；
國中版會標示「草稿」，待國中國文老師校閱。
兩套評語庫已完成用語清洗：總評、佳句、結構不再以引號假設特定詞句，改用通用指稱；
`npm run library:wording` 與 `junior:check` 會檢查此規則，違規即失敗。
兩套 144 條總評已改為五面向平衡：結構、立意取材、語言表達、情感體驗、格式應用；
結構不是唯一主軸，兩套各保留 33 條結構評語，其餘分配至立意、語言、情感與格式。
`npm run library:structure` 會依面向檢查詞彙覆蓋、引號、字數與重複，兩套皆 72/72 通過。
另依官方規準與常見結構症狀建立 19 類輔助覆蓋表，並由使用者提供評語表新增 24 條體裁補充；
`npm run library:coverage` 確認五面向皆達最低條數、兩套 comment 皆 72/72 有面向歸屬。
本輪共改寫 junior 23 條、senior 23 條總評，維持 138 條與 comment 72 條不變。
短評（錯字、語句、結構、佳句）也已完成侷限用語清洗：junior 修正 36 條、senior 修正 29 條，
移除特定詞句、段落編號、事件與人物假設，改為條件式與通用描述；
`npm run library:short` 會檢查引號、段落編號、禁用題材與重複，違規即失敗；
其中 sentence 的 word_choice（用詞辨析）可用引號標示具體詞語，其他短評仍禁用。
驗收：`m1:check` 11/11、`m2:check` 13/13、`m3:check` 31/31、`m4:check` 17/17、
`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、
`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、
`junior:check`、`library:wording/structure/coverage/short` 與 `spike` 通過。
量規**預設採用均衡版**，之後可調整；建立作業時可改選、評分前可調整配分與等第門檻，
已有評分不自動改寫。M4 以 45 人、44 份作品驗證批次檢查（問題 14、提醒 11、約 27 ms）；
M5 以單份作品驗證回饋單資料、檔名與單頁 PDF（1 頁、約 150 KB、約 360 ms），
超長內容會被擋下。M6 以 6 人、5 份作品（4 份 `done`）驗證統計：13 個弱項、
常錯字「在→再」×3、平均 81、四份 CSV。M7 驗證備份 zip 內容、排除 lock／tmp、
非空目的地與 zip slip 拒絕、還原後可讀、日誌格式與 2 MB 輪替、敏感內容不落日誌、
ErrorBoundary 與打包設定；安裝檔與 portable 的打包狀態見 `progress.md`。
E6 以合成成績表驗證：座號 `7`／`08`／`S12` 正確寫回、S15 未匹配、S20 批閱中不寫、
原檔位元組不變、副本重新開啟驗證、重複座號中止、`.xlsm` 與含 chart 字樣走匯出、
失敗保留 CSV；報告列出變更前後值。
未匹配照片以內外共 5 張驗證清單、來源、原因與 meta，舊檔無 meta 顯示未指定作業；
縮圖 240×320；3 張依檔案時間指定給 S07 後正確附加 3 頁，來源與附屬檔刪除；
重複照片不新增頁面，非在學座號、路徑穿越、任意路徑與空選取皆被拒絕。
F2 以 5 位學生驗證：3 份正常 `done`、1 份 `grading` 跳過、1 份 `done` 但總評超長造成溢頁失敗；
批次結果 3 輸出／1 跳過／1 失敗，3 份 canonical PDF 均為 1 頁、135–136 KB，
`_feedback/` 有 3 份中文檔名 PDF，報告統計一致且 CSV 有 BOM；取消、重複啟動與 UI 煙霧皆通過。
G4 以 5 位學生、3 份作業（含同日 `-02`）驗證：已比較 3 份，進步 1（S07 +9）、退步 1（S08 −5）、
持平 1、新作品 1、缺資料 1；平均 78.3→79.7（Δ +1.4）；弱項錯字 1.3→1.0、語句 0.7→0.3、
結構 0.3→0.7；換上次作業會重算，同一份、跨班與不存在的作業皆被拒絕；UI 下拉預設與切換重置通過。
soak 以 45 人、每圈 45 份回饋單跑滿 10 分鐘：15 圈、16 次批次、720 份 PDF；private 291→291 MB、
peak 426 MB、growth 0 MB，視窗批次後回到 0，45 份作品與最後一輪 PDF 驗證皆通過。
已知限制見 `progress.md`；下一步為 M8 手機掃描。
