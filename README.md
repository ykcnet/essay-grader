# Essay Grader

紙本作文掃描 → 桌機批閱 → 評分 → 一頁回饋單 → 分數寫回 Excel。

- 技術棧：**Electron + React + TypeScript**（2026-11-19 定案）
- 版本：**0.3.5（名條掃描輔助與匯入、內建使用說明、匯出成績 Excel；Drive inbox 入口在上方、Drive 補掃與來源刪除重試、Android EXIF 轉正與四張縮圖方向確認）**
- 手機端：Kotlin + ML Kit Document Scanner（M8 App 已建置，待實機驗證；只寫 inbox）
- 資料庫：本地資料夾，全 ASCII，中文只存在 JSON
- 外部 inbox：Google Drive 本機同步資料夾，只搬圖片，資料庫不進雲端
- 隱私：不連網、不埋 telemetry、照片移除 GPS

使用方式、安裝版／portable 差異、批閱流程與常見問題請看 **[docs/使用說明.md](docs/使用說明.md)**。

## 目錄

```
apps/desktop/        Electron 桌機端（main / preload / renderer）
apps/android/        Kotlin + ML Kit 手機掃描器（M8）
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
npm run crud:check   # 班級／作業編輯刪除驗收（update/delete、錯誤、watcher、UI 煙霧）
npm run m2:check     # 匯入驗收（10 檔配對、去重、unmatched、Excel 名單）
npm run m3:check     # 批閱驗收（EXIF／縮圖、評語庫與排序釘選停用、量規與等第、計分與快速給分、驗證、work 存取、UI 煙霧）
npm run m4:check     # 批次檢查驗收（45 人、44 份作品、重複／缺頁／未匯入、UI 煙霧）
npm run similarity:check # D19 近似重複驗收（相似度與門檻、countFinalReuse、批次一致、批閱 UI 相近與阻擋）
npm run m5:check     # 回饋單驗收（資料推導、檔名、單頁 PDF、溢頁阻擋、UI 煙霧）
npm run m6:check     # 統計驗收（G1／G2／G3、分數摘要、CSV 四檔、UI 煙霧）
npm run m7:check     # 交付驗收（備份／還原、zip slip、日誌輪替、ErrorBoundary、打包設定）
npm run drive:check  # Google Drive 外部 inbox 驗收（兩種擺法、去重、PDF、錯誤路徑、UI）
npm run manifest:check # 手機 manifest 驗收（欄位、只含在學學生、覆蓋、無 root 錯誤、UI）
npm run android:test # Android JVM 單元測試（:app:testDebugUnitTest）
npm run android:build # Android debug APK（:app:assembleDebug）
npm run m8:check     # Android 測試＋建置
npm run excel:check  # 成績寫回 Excel 驗收（副本、座號、驗證、重複、匯出模式、CSV、UI）
npm run match:check  # 未匹配照片驗收（內外清單、meta、縮圖、指定座號、去重、路徑防護、UI）
npm run batch:check  # 整班批次回饋單驗收（輸出、跳過、溢頁失敗、報告、取消、重複啟動、UI）
npm run compare:check # G4 與上次比較驗收（狀態、平均、弱項、排行、拒絕情境、UI）
npm run praise:check # G6 佳句庫驗收（核心、去重、排序、去識別、Repository、IPC／preload、UI）
npm run library-import:check # D21 評語庫版本更新驗收（只新增、略過重複、版本、舊檔相容、錯誤、UI）
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

打包產物（2026-11-23 0.3.5 重新打包）：

- `apps/desktop/release/EssayGrader-0.3.5-Setup.exe`：134,219,850 bytes（約 128.0 MB）
- `apps/desktop/release/EssayGrader-0.3.5-Portable.exe`：120,864,600 bytes（約 115.3 MB）

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

### Android 掃描器（M8）

`apps/android/` 是 Kotlin + ML Kit Document Scanner 手機 App：從 Drive 根目錄讀 `manifest.json`，
選班級／作業／學生後掃描，寫入 `<root>/<classId>/<assignmentId>/S07__session__001.jpg` 與 sidecar；
沒有網路或上傳失敗時先存本機 pending 佇列，之後可重新上傳。掃描完成會先跳出「確認掃描方向」，
預覽第一頁並選擇 0／90／180／270 度，整批頁面套用同一角度；按「取消」不寫 pending、不上傳，
按「上傳」才先存 pending 再傳到 Drive inbox。ML Kit 需要 Google Play services，
不支援的裝置會顯示繁中提示。

桌機端在「Google Drive inbox」區塊按「產生手機 manifest」，會在外部 inbox 根目錄
（Google Drive 本機同步資料夾）寫入 `manifest.json`，內容只有目前班級、該班全部作業與
在學學生座號／姓名；不含分數、批注、總評、更新時間或作品內容。沒有設定外部 root 時會回繁中錯誤。
manifest 含學生姓名，請把 Drive inbox 放在受控的教師帳號資料夾，不要公開分享。

建置工具鏈優先使用環境變數 `JAVA_HOME`／`ANDROID_HOME`；未設定時使用
`M:\dev\tools\jdk` 與 `M:\dev\tools\android-sdk`。也可直接指定：

```powershell
powershell -ExecutionPolicy Bypass -File tools/android.ps1 -Task ":app:testDebugUnitTest"
powershell -ExecutionPolicy Bypass -File tools/android.ps1 -Task ":app:assembleDebug"
powershell -ExecutionPolicy Bypass -File tools/android.ps1 -Task ":app:assembleRelease"
```

產物：debug 為 `apps/android/app/build/outputs/apk/debug/app-debug.apk`；簽署版為
`apps/android/app/build/outputs/apk/release/app-release.apk`（讀取 `apps/android/keystore.properties`，該檔不進版控）。
Android 建置檔（build/、local.properties、APK）不進版控；wrapper jar 會提交。

量規預設採用**均衡版**（40／30／30），之後可調整。另外提供內容導向 45／25／30、
語言導向 35／30／35；扣分皆為錯字 0.5／標點 0.5、上限 10，等第門檻相同。
數值仍為預設值，可再調整。建立作業時可改選其他 preset；進入批閱後、評分前也可按
「調整量規」修改 preset、自訂配分，以及新增／刪除等第並編輯名稱與最低分。
等第至少一筆、名稱不可空白或重複、最低分須為 0–100 且不可重複，儲存時由高到低排序；
表單會即時顯示目前總分落在哪一級。若該作業已有評分，變更前會先確認；只影響之後的計算，
已儲存的分數與等第不會自動改寫，目前這份的預覽會用新量規重算，完成批閱時才寫入。

### 班級與作業編輯／刪除

主畫面選好班級後，班級標題右側有「編輯班級」與「刪除班級」；作業卡片每列右側有「編輯」與「刪除」。

- **編輯班級**：只能改班級名稱、學制與教師。班級 ID、學年度、學期與資料夾位置不變，學生名單、作業與作品完整保留。
- **刪除班級**：確認後把整個班級資料夾（含名單、作業、作品、批注、分數與統計）移到系統資源回收桶；DB 狀態立即移除該班。可從回收桶自行還原，程式內沒有復原按鈕。
- **編輯作業**：可改題目、題幹、體裁、字數下限與截止日。作業 ID、量規（rubric）與規則（rules）不會改變，既有作品、批注與分數原樣保留；其他作業不受影響。
- **刪除作業**：確認後把該作業資料夾（含作品、批注、分數、回饋單與統計）移到系統資源回收桶；班級與其他作業仍在。
- 兩種刪除都會先停止 inbox／Drive watcher，完成後重新啟動；移到回收桶失敗時會回繁體中文錯誤，資料留在原位。
- 刪除目前選取的作業時，匯入佇列、批次檢查、統計等面板會一併清空，避免顯示已刪除的資料。

### 快速給分

評分卡片上方新增「分項合計」與兩個動作，讓老師先決定總分再回填分項：

- **分配到三項**：輸入 1–100（可到 0.5）後，依目前量規的配分比例分到內容、結構、語言，
  每項以 0.5 分為單位，三項總和等於輸入值；超過量規滿分合計時以滿分為上限。演算法在
  `packages/core/src/review.ts` 的 `distributeScore`，前幾項取比例後向下取到 0.5，最後一項補差額；
  最後一項若超過滿分，多出的 0.5 分會往回分給還有空間的項目。
- **複製上一份**：依座號找同一作業中最近一份已有分數的作品（先往前找、再往後找），只複製
  三個分項與「手動覆寫」，**不複製總評、批注、狀態或等第**。複製後照常標記已修改並 autosave。
- 分項合計與分配結果都會即時顯示「目前分項合計」與「扣分後總分」；沒有可複製來源時會提示。

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

### 常用排序與釘選（D13）

評語庫面板的排序下拉可選「預設」、「常用（累計）」與「本批未用優先」。每條評語會顯示
「本批 N 次、累計 M 次」，可直接按「釘選」固定在清單最前面，再按「已釘選」取消。
釘選條目在三種排序都排在前面；釘選內依累計次數由高到低，同次數保持原順序。

- 常用（累計）：其餘條目依同班所有作業的累計次數由高到低，同次數保持原順序。
- 本批未用優先：本批尚未使用的條目先排，同群組再依累計次數由高到低。
- 切換國中／高中職時只顯示目前版本的條目；舊版本的釘選仍保留在設定中，切回該版本會再生效。

釘選與排序是全域 UI 偏好，寫在 `settings.json` 的 `libraryPins`／`librarySort`，跨作業與重開程式保留；
`pins` 會去重且只留字串，非法排序會回到 `default`。使用次數只讀 `work.json` 的
`annotation.library_id` 與 `final_comment.library_id`，本批只算目前作業、累計掃同班所有作業，
不另維護計數器。從評語庫插入時會寫入來源 `library_id`；手動改寫文字後不再標示來源。

### 跨批冷卻輪替（D22）

排序下拉新增「冷卻輪替（久未用優先）」，用來避免同一批評語反覆出現。選用後會多一個
「冷卻天數」輸入，預設 30 天、可調 1–365 天，並顯示每條評語的「上次使用」日期或「尚未使用」。

- 冷卻群（從未使用，或距上次使用已超過冷卻天數）排在前面；冷卻群內從未使用最前，
  其餘依最後使用時間由舊到新。
- 近期群接在後面，同樣依最後使用時間由舊到新；同時間再依累計次數由少到多，最後保持原順序。
- 釘選條目仍永遠在最前面，釘選內依累計次數由高到低，不受冷卻影響。
- 最後使用時間不另存欄位，直接由 `work.json` 推導：批注用 `annotation.created_at`，
  總評用該作品的 `updated_at`；同一條取最新的時間，缺少或格式錯誤視為從未使用。
- 冷卻輪替只影響評語清單的顯示順序，不會改寫已插入的評語、批注、分數或 autosave 內容。
- 偏好寫在 `settings.json` 的 `librarySort` 與 `libraryCooldownDays`；非法天數一律回到 30。

### 停用與啟用評語（D23）

評語庫面板右上角新增「管理」切換。開啟後每條評語旁會多一個「停用」按鈕，面板也會顯示
「停用不會刪除評語，舊批注仍保留文字。」的說明；再按「完成管理」即可回到一般瀏覽。

- 停用只是把該條從日常清單隱藏，**不會刪除內建評語**，也不會改寫任何已存在的 `work.json`。
- 管理關閉時，停用條目不會出現在清單；開啟管理後才會以淡化樣式顯示，並標上「已停用」與
  「啟用」按鈕。停用期間該條的插入按鈕會停用，避免誤用。
- 已插入作品或已批閱的舊批注只保存當時的文字與 `library_id`；之後停用或重新啟用該條，
  舊作品的總評、批注文字與來源都保持原樣。需要換掉時仍由老師手動改寫。
- 國中版與高中職版的停用清單分開保存，切換版本只會看到該版本自己的停用狀態；
  同一時間只有目前版本受影響。
- 停用清單寫在 `settings.json` 的 `libraryDisabled`（`junior`／`senior` 各一組 id），
  寫入時只留字串並去重，重開程式仍保留；IPC 會驗證版本、評語 id 與 boolean。

### 匯入新版評語庫（D21）

評語庫面板右上角在「管理」模式下新增「匯入新版」，可選擇一份新版內建評語庫 JSON，
把目前缺少的條目補進來。適合老師拿到校閱後的新版評語庫、或同事整理的新條目時使用。

- 只新增目前缺少的 id 與文字：既有 id 一律略過，既有條目的文字不會被覆蓋；
  正規化後（去變數、標點、空白）與現有評語相同的文字也會略過，避免重複條目。
- 不覆蓋自訂評語、D23 停用清單與既有 `work.json`；匯入的條目一律視為內建、
  預設啟用。若來源檔的條目標成 `custom` 或 `disabled`，匯入時會改回
  `builtin`／`false`，避免混淆。
- 只有實際新增條目時才會寫入 `_library/{junior|senior}.json` 並更新版本；
  若沒有新增，版本維持原值，檔案位元組不變。
- 版本規則：目前版本有匯入條目且來源檔帶 `library_version` 時，面板顯示來源檔版本；
  否則顯示內建版本。沒有新增時不會更新版本。
- 只影響目前版本：在國中版匯入只改國中版，高中職版不受影響；反之亦然。
- 匯入結果會顯示新增數、略過既有 id 數、略過重複文字數與版本，並立即重新載入清單；
  管理模式與搜尋條件會保留。
- 檔案不存在、JSON 損壞、schema 不合、沒有條目、檔案內 id 重複、空白 id、
  非法版本或尚未開啟資料庫，都會被拒絕並顯示繁體中文訊息，不會寫入任何檔案。

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

總評近似重複：總評去除 `{變數}`、標點與空白後，以字元 bigram Jaccard 計算相似度，
達 0.85（`FINAL_SIMILARITY_THRESHOLD`）即視為近似。相同與近似一起計入 `final_max_reuse`
（預設 2），第 3 次起阻擋完成；批閱畫面顯示「相同」或「相近＋百分比」，達上限為紅字警告；
批次檢查採用同一套規則，訊息會列出前面的座號。只比對總評，其他批注不在本規則內。

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

### 佳句庫累積（G6）

右上角「佳句庫」會跨作業收集**已完成作品**的佳句批注，去重後依使用次數與最後使用時間排序，
可切換「本班」或「全部班級」、搜尋原文並複製單句或全部篩選結果。每一筆只顯示佳句原文、
使用次數、作品份數與來源作業名稱，不含座號、姓名或任何學生識別欄位；只讀不寫，不會修改
`work.json`。`pending`／`grading` 的佳句與語句、結構、評語等其他類別都不會收錄。
`npm run praise:check` 會用 2 班、3 份作業與數份作品驗證核心、repository、IPC／preload 與 UI。

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
10 分鐘 soak、G4 與上次比較、G6 佳句庫累積、M8 Android 掃描器已完成（App 建置完成，待實機驗證）。
班級與作業已可編輯與刪除：班級只改名稱／學制／教師且 ID 不變；刪除班級或作業會把整個資料夾移到系統資源回收桶，
作業編輯不動量規與規則，刪除後 watcher 自動重啟。
國中版評語庫草稿 138 條已接入 runtime，預設依班級學制自動選用，也可在批閱畫面手動切換；
國中版會標示「草稿」，待國中國文老師校閱。
評語庫已支援常用排序與釘選（D13）：「預設／常用（累計）／本批未用優先」、每條顯示本批與累計次數，
釘選為全域偏好並跨作業保留；使用次數即時由 `work.json` 的 `library_id` 推導。
評語庫另支援跨批冷卻輪替（D22）：「冷卻輪替（久未用優先）」會依每條評語最後使用時間排序，
冷卻天數預設 30 天、可調 1–365 天；時間同樣由 `work.json` 推導，釘選優先且只影響顯示順序。
評語庫也支援停用與啟用（D23）：面板「管理」可暫時隱藏不常用的評語，停用不會刪除條目，
舊批注仍保留當時的文字與來源；國中／高中職停用清單分開保存，重開程式仍保留。
評語庫另支援自訂評語增刪改（D11）：「管理」模式下可新增、編輯、刪除自訂評語，
可填類別、子類、文字與標籤；comment 類至少 30 字，空文字、非法類別／子類與重複文字會被拒絕。
自訂評語依版本存在資料庫的 `_library/junior.json`、`_library/senior.json`，
切換資料庫各自獨立，不寫入 `settings.json`；內建評語只能停用、不能刪除。
自訂評語可停用／啟用、插入、計入使用次數；刪除後舊 `work.json` 的文字與 `library_id` 不受影響。
評語庫也支援匯入新版（D21）：管理模式的「匯入新版」只新增缺少的 id 與文字，
不覆蓋自訂、停用或既有條目；重複文字會略過，沒有新增時不改版本、不寫檔，
國中／高中職版本各自獨立。匯入條目存於同一份 `_library/*.json` 的 `imported`
並記錄 `imported_version`，舊檔沒有這兩個欄位仍可正常讀取。
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
驗收：`m1:check` 11/11、`m2:check` 13/13、`m3:check` 77/77、`m4:check` 17/17、
`m5:check` 19/19、`m6:check` 17/17、`m7:check` 25/25、`drive:check` 23/23、
`excel:check` 25/25、`match:check` 21/21、`batch:check` 17/17、`compare:check` 15/15、
`praise:check` 15/15、`library-import:check` 19/19、`manifest:check` 11/11、`similarity:check` 15/15、
`crud:check` 24/24、`junior:check`、
`library:wording/structure/coverage/short` 與 `spike` 通過；Android JVM 測試 16/16、debug APK 建置通過。
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
G6 以 2 班、3 份作業、6 份作品（含 `grading`／`pending`）驗證：本班 4 句 7 次、全部 5 句 8 次，
P1 經 normalize 後 3 次／3 份、來源作業依 id 排序，缺 `created_at` 時退回 `work.updated_at`；
序列化不含測試姓名、座號與 `seat`／`name` 欄位；壞掉的 assignment 會被跳過，UI 與 preload 通過。
soak 以 45 人、每圈 45 份回饋單跑滿 10 分鐘：15 圈、16 次批次、720 份 PDF；private 291→291 MB、
peak 426 MB、growth 0 MB，視窗批次後回到 0，45 份作品與最後一輪 PDF 驗證皆通過。
M8 以 1 班（2 位在學、1 位不在學）、2 份作業驗證 manifest：classes 1、assignments 2、
students 只含在學 2 人，欄位只有 10 個必要 key；覆蓋舊檔、無外部 root 錯誤與 UI 提示皆通過。
Android JVM 16/16 測試通過，`app-debug.apk` 6,629,853 bytes；實機掃描、ML Kit、SAF 與 Drive 上傳仍待驗證。
已知限制見 `progress.md`；下一步為 M9 與真機測試。
