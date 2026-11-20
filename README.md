# Essay Grader

紙本作文掃描 → 桌機批閱 → 評分 → 一頁回饋單 → 分數寫回 Excel。

- 技術棧：**Electron + React + TypeScript**（2026-11-19 定案）
- 版本：**0.1.0（M7 打磨＋交付＋Google Drive 外部 inbox＋成績寫回 Excel）**
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
npm run dist         # 同上，產出 NSIS 安裝檔與 portable（apps/desktop/release）
npm run dist:win     # 建置後打包 Windows x64：Setup＋Portable
npm run dist:portable # 只產出 portable
npm run validate:fixtures
```

打包產物（2026-11-20 重新打包，含 E6）：

- `apps/desktop/release/EssayGrader-0.1.0-Setup.exe`：134,125,323 bytes（約 127.9 MB）
- `apps/desktop/release/EssayGrader-0.1.0-Portable.exe`：120,775,376 bytes（約 115.2 MB）

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

統計：匯入佇列面板按「統計」，可看班級分數摘要、等第分布、分項平均、G1 弱項排行、
G2 常錯字與 G3 每人前三弱項。按「匯出 CSV」會在該作業資料夾的 `_stats/` 產生
`scores.csv`、`weakness-ranking.csv`、`common-typos.csv`、`student-weakness.csv`，
可直接用 Excel 開啟（UTF-8 BOM）。統計只計已批（`done`）作品；未完成與未匯入的學生
仍列在個人表，但標示「不計入」，不影響班級數字。

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
Google Drive 外部 inbox、E6 成績寫回 Excel、未匹配照片手動分配座號已完成。
驗收：`m1:check` 11/11、`m2:check` 13/13、`m3:check` 25/25、`m4:check` 17/17、
`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、
`excel:check` 25/25、`match:check` 21/21。
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
已知限制見 `progress.md`；下一步為 M8 手機掃描。
