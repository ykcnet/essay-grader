# Essay Grader — 製作方案（草案）

> 版本 v1.0 ｜ 2026-11-22 ｜ 狀態：**M0–M7＋Google Drive 外部 inbox＋E6 成績寫回＋未匹配照片手動分配＋F2 批次回饋單＋10 分鐘 soak＋G4＋G6 佳句庫累積＋評語庫結構覆蓋＋體裁補充＋D11 自訂評語增刪改＋D12 國中／高中職雙評語庫＋D13 常用排序與釘選＋D21 評語庫版本更新＋D22 跨批冷卻輪替＋D23 停用取代刪除＋M8 Android 掃描器完成（App 建置完成，待實機驗證）；下一步 M9／真機測試**
>
> 需求本體仍以 `features.md` 為準；本檔整理技術棧比較、架構、資料模型、里程碑與待決事項。
> 「已定」代表本次確認；「建議」代表尚未拍板。

---

## 0. 本次已定事項

| 項目 | 決定 |
|---|---|
| 施工順序 | **先桌機，手機後補** |
| 最低系統 | **Windows 10 22H2 以上（x64）** |
| 手機端 | 第二階段再做；建議 Kotlin + ML Kit Document Scanner |
| 桌機技術棧 | **已定案：Electron + React + TypeScript**（2026-11-19） |
| 手機技術棧 | Kotlin + ML Kit Document Scanner（第二階段） |
| Excel 成績 | 讀既有 `.xlsx`、依座號寫入指定欄、另存副本（原檔不動） |
| 資料庫 | 本地資料夾為唯一資料庫；**Google Drive 本機同步資料夾僅作外部 inbox，資料庫不進雲端** |
| 手機角色 | 只寫 inbox，不直接寫 `work.json` |
| 第一版核心 | 批一份 → 批一班 → 出回饋單 |
| 評語庫五面向 | 總評分為結構、立意取材、語言表達、情感體驗、格式應用；結構**不是唯一主軸**。每條至少屬於一個面向，可跨兩個；各面向最低條數與 19 類結構輔助索引由 `library:coverage` 驗收 |

---

## 一、現況判讀

### 已具備

| 項目 | 狀態 |
|---|---|
| 功能清單 | 77 項：P0 39／P1 22／P2 16 |
| 核心主線 | 拍照匯入 → 批注 → 評分 → 回饋單 |
| 資料夾契約 | 全 ASCII、中文存 JSON |
| 評語庫 | 高中職 138 條與國中 138 條皆已接入；預設依學制自動選用，可手動切換，國中版標示草稿；兩套總評已改為五面向平衡，各含 12 條體裁補充 |
| 圖示 | Windows ICO、各尺寸 PNG、Android mipmap |
| 工具 | `tools/make_icon.py`、`tools/trace_circle.py` |

### 會擋施工的缺口

| # | 缺口 | 影響 |
|---|---|---|
| 1 | 量規分項、權重、等第換算沒有數值 | 評分 UI、PDF、統計無法做 |
| 2 | 回饋單只有描述，沒有版面 | F1 無法估工，也無法確認「一頁」是否放得下 |
| 3 | 手機與桌機的檔案交換方式未定 | B1–B7、C1 全部受影響 |
| 4 | 常錯字表需要結構化欄位 | G2 目前只能算次數，生不出「常錯字」 |
| 5 | 錯字扣分與分項評分可能重複計算 | 需要在量規中明確定義 |

### 文件內的不一致

| 位置 | 問題 | 建議 |
|---|---|---|
| B4 | 寫 `S07_王小明/原圖_1.jpg` | 統一成 `S07/p1.jpg`，中文只存 JSON |
| 作業資料夾 | `E{日期}` 同日會撞，`-01` 規則未進 progress | 固定 `E{YYYYMMDD}`，碰撞時加 `-02` |
| F1 vs F3 | F1 說一頁、F3 可含原圖 | 明確定義含原圖時是一頁縮圖或兩頁 |
| A3 | 座號／姓名變更要重新命名資料夾 | 建議不改名，只改 JSON；換座號再做遷移 |
| G2 | 常錯字只有評語文字 | 錯字標記增加 `wrong`／`correct` 欄位 |
| 總評 30 字 | 沒說標點、空白算不算 | 建議「去空白與標點後 ≥30 字」 |

---

## 二、技術棧比較

> 只比較桌機。手機端另外用 Kotlin，不列入四方案。

### 2.1 總表

分數 1–5，5 最好；加權分數只是把取捨具象化，不是精確預測。

| 項目 | 權重 | Electron + React | Tauri 2 + React | Flutter | C# WPF |
|---|---:|---:|---:|---:|---:|
| 開發速度／熟悉度 | 25% | **5** | 3.5 | 3 | 2.5 |
| A4 中文 PDF | 20% | **5** | 2.5 | 3 | 4.5 |
| Canvas 批閱互動 | 15% | **5** | **5** | 3.5 | 4 |
| Excel／檔案／影像 | 10% | **5** | 3.5 | 3.5 | 4.5 |
| 安裝檔／記憶體 | 10% | 2 | **5** | 4 | 4 |
| 測試／長期維護 | 10% | **4** | 3 | 3.5 | 3 |
| Android 程式重用 | 5% | 1 | 2 | **5** | 1 |
| 生態／部署 | 5% | **5** | 3.5 | 4 | 3 |
| **加權總分** | 100% | **4.40** | 3.55 | 3.43 | 3.48 |

> 最大變數是「開發者最熟哪個語言」。若 C# 熟悉度為 5，WPF 總分約 4.1，會成為 Electron 的強力對手。

### 2.2 各方案摘要

#### Electron + React + TypeScript

**強項**

- PDF 用同一份 React 元件排版，螢幕預覽與 `webContents.printToPDF` 共用 CSS，所見即所得。
- `react-konva` 處理縮放、平移、標記與 hit testing，生態成熟。
- `exceljs`、`sharp`、`chokidar`、`write-file-atomic`、`electron-builder` 都是即戰力。
- Playwright 可直接驅動 Electron，適合自動化批閱流程。
- 與既有 JS/Electron 專案經驗一致。

**弱項**

- 安裝檔約 150–250MB，冷啟動 2–4 秒。
- 開 2600px 圖片時記憶體約 250–400MB；4GB 學校電腦可跑，但不算輕。
- 需要自行做好 `contextIsolation`、`sandbox`、CSP、自訂檔案協定。
- 未簽章會有 SmartScreen 警告。

**結論**

作文批閱的核心是「圖片 + 大量文字輸入 + A4 輸出」，Electron 是三者最短路徑。

#### Tauri 2 + React

**強項**

- 安裝檔 5–15MB，記憶體略低。
- React 前端可沿用，權限模型乾淨。
- Rust 端處理檔案、影像、Excel 很穩。

**弱項**

- PDF 是最大風險：Tauri 沒有 Electron 的直接 `printToPDF`；需呼叫 WebView2 `PrintToPdfAsync` 或用 Rust PDF 庫重寫版面。
- WebView2 是系統共用元件，渲染與字型結果可能因電腦版本不同。
- UI 自動化測試比 Electron 麻煩。
- 需要 Rust／MSVC 工具鏈，CI 與除錯多一層。
- 記憶體優勢沒有想像大：WebView2 本質仍是 Chromium，主要省安裝檔。

**結論**

若「安裝檔小於 20MB」是硬需求才值得；否則 PDF 與工具鏈成本會超過省下的下載量。

#### Flutter（Windows + Android）

**強項**

- 唯一能真正重用桌機與 Android 的選項。
- Canvas 效能好，`CustomPainter`／`InteractiveViewer` 可做縮放平移。
- 安裝檔約 30–50MB，記憶體比 Electron 低。
- Android 有 `google_mlkit_document_scanner` 外掛。

**弱項**

- 桌面三欄式 UI、右鍵選單、多面板拖曳要自己堆，迭代比 HTML/CSS 慢。
- PDF 要用手寫版面：`pdf` 套件不是 CSS，一頁 A4、中文換行、溢出偵測、字型子集都要自己處理。
- Windows 中文 IME 穩定度必須先實測；批閱時要不斷打中文評語。
- 檔案監看、原子寫入、Excel、列印靠外掛，生态比 JS 小。
- 需學 Dart，與現有 JS 專案無法共用。

**結論**

手機只是一小部分工作量；用 80% 的桌機體驗換 20% 的程式重用，通常不划算。

#### C# WPF（WinUI 3 不建議起步）

**強項**

- Windows 原生，中文 IME、列印、檔案系統最穩。
- Canvas + `MatrixTransform` 成熟；2600px 圖片效能好。
- QuestPDF 做 A4 中文 PDF 很強；ClosedXML 讀 Excel 成熟。
- 記憶體與啟動速度比 Electron 好；自包含安裝檔約 80–120MB。
- 若本來就寫 C#，開發速度快。

**弱項**

- 沒有 Android 重用，手機仍要另寫 Kotlin。
- XAML 排版與樣式迭代比 HTML/CSS 慢。
- WinUI 3 的 MSIX 打包與部分桌面情境不如 WPF 成熟。
- 與現有 JS 專案完全分家。

**結論**

若「Windows 原生、長期只做 Windows、且熟 C#」才優先；目前沒有理由放棄 JS 生態。

### 2.3 定案

**定案（2026-11-19）：Electron + React + TypeScript**，理由：

1. PDF 最穩，回饋單是每天要用的輸出。
2. Canvas 與檔案周邊最成熟。
3. 既有 JS 經驗可直接反映在 6–8 週 MVP。
4. 手機端只負責「拍照→寫入 `_inbox`」，不需要共用程式碼，Flutter 的唯一優勢不成立。

React 前端可移植；若日後真的不能接受安裝檔大小，可再搬到 Tauri，主要重寫 IPC 與 PDF。

**未採用**：Tauri（PDF 風險）、Flutter（桌機 UI／PDF 成本高於程式重用效益）、C# WPF（與既有 JS 生態分家）。

### 2.4 1 天 Spike 驗收條件

在正式 scaffolding 前，先用最小程式驗證：

1. 開一張 2600×3466 JPEG，400% 縮放、平移順暢。
2. 放 50 個標記，關閉重開後位置完全一致。
3. 輸出一頁 A4 中文 PDF，字型不缺字、不溢頁，Edge／Acrobat 開啟正常。
4. 監看資料夾，丟 10 個檔案＋sidecar，3 秒內全部匯入或正確標錯。
5. 連續操作 10 分鐘，記憶體低於 500MB。

通過才鎖定技術棧；不通過則改評估 Tauri／Flutter／WPF。

**Spike 結果（2026-11-19 實測，`npm run spike`）**

| 驗收項 | 結果 | 判定 |
|---|---|---|
| 2600×3466、400% 縮放 | 60.5 fps；錨點誤差 0.00 px | 通過 |
| 50 標記關閉重開 | 50/50；最大位移 0 | 通過 |
| 一頁 A4 中文 PDF | 1 頁、179 KB、1182ms；Microsoft JhengHei 子集內嵌 | 通過 |
| 10 檔＋sidecar 監看 | 10/10 配對、373ms | 通過 |
| 記憶體 | private 343 MB；working set 加總 573 MB | 通過 |

> working set 是各行程相加，會重複計算共用 DLL；工作管理員對應的是 private bytes。
> 10 分鐘 soak 已於 2026-11-20 以 `npm run soak` 補上：45 人、每圈 45 份批次回饋單，
> 15 圈、720 份 PDF，private 291→291 MB、peak 426 MB、視窗回到 0，資料驗證全數通過。

---

## 三、建議架構

### 3.1 資料流

```text
┌──────────────┐  Google Drive App 上傳  ┌──────────────────────────┐
│ Android 手機 │ ───────────────────────> │ Google Drive「inbox」資料夾 │
└──────────────┘                          └──────────────────────────┘
                                                          │ Google Drive for desktop
                                                          v 本機同步資料夾
┌─────────────────────────────────────────────────────────────────────┐
│ Windows 桌機                                                         │
│  Drive 外部 watcher → 匯入/配對 → essay-grader-data（本地唯一資料庫） │
│                              ├─ 批閱 / 評分                         │
│                              ├─ 回饋單 PDF / 列印                   │
│                              └─ 統計 / 備份                         │
│                                                                     │
│  manifest.json ──> 共用資料夾（單向，給手機讀班級/作業/名單）        │
└─────────────────────────────────────────────────────────────────────┘
```

**關鍵原則**

- 桌機是唯一 writer，資料庫不放在即時雲端同步資料夾裡。
- 手機只寫 `inbox`，不碰資料庫。
- 跨裝置搬檔固定採 **Google Drive 本機同步資料夾**；雲端只放手機上傳的 inbox 與桌機備份，資料庫與 `work.json` 不進雲端。
- 手機靠桌機產生的 `manifest.json` 取得班級、作業、名單。

### 3.2 目錄

```text
essay-grader/
  apps/
    desktop/          # Electron
      src/main/
      src/preload/
      src/renderer/
    android/          # Kotlin + Compose
  packages/
    core/             # schema、評分、去重、命名、migration
    library/          # 評語庫 JSON + 轉換腳本
  docs/
  fixtures/           # 3 位學生、2 頁的測試專案
```

### 3.3 建議套件

| 用途 | 套件 |
|---|---|
| 桌面殼 | Electron（現行穩定版） |
| UI | React 19 + TypeScript + Vite + electron-vite |
| Canvas | react-konva |
| 狀態／復原 | zustand + immer + zundo |
| Schema | zod |
| 檔案監看 | chokidar |
| 影像 | sharp |
| Excel | exceljs |
| 原子寫入 | write-file-atomic |
| PDF | 隱藏 BrowserWindow + `webContents.printToPDF` |
| 圖表 | recharts |
| UI 元件 | Tailwind CSS + Radix UI |
| 打包 | electron-builder（NSIS + portable） |

---

## 四、資料模型草案

### 4.1 三個關鍵決定

1. `work.json` 是唯一事實來源；評語使用次數、最後使用時間、同批重複全部即時推導，不另維護計數器。
2. 批注座標用 0–1，基準是 EXIF 轉正後的圖片；每個批注記 `page_id`，不記頁碼 index。
3. 從第一版就寫 `schema_version`，日後遷移成本最低。

### 4.2 `class.json`

```json
{
  "schema_version": 1,
  "id": "C302-2025F",
  "name": "國中302",
  "grade": "junior",
  "academic_year": "114",
  "semester": 1,
  "teacher": "王老師",
  "students": [
    { "seat": "07", "name": "王小明", "active": true }
  ]
}
```

### 4.3 `assignment.json`

```json
{
  "schema_version": 1,
  "id": "E20250107",
  "title": "我的母親",
  "prompt": "……",
  "genre": "narrative",
  "word_limit": 800,
  "due_at": "2025-01-14T23:59:00+08:00",
  "rubric": {
    "id": "balanced-default",
    "items": [
      { "id": "content",   "name": "內容與思想", "max": 40 },
      { "id": "structure", "name": "結構與組織", "max": 30 },
      { "id": "language",  "name": "語言與表達", "max": 30 }
    ],
    "deduction": { "typo_per": 0.5, "punct_per": 0.5, "cap": 10 },
    "grades": [
      { "label": "A++", "min": 90 },
      { "label": "A+",  "min": 85 }
    ]
  },
  "rules": {
    "final_min_chars": 30,
    "final_max_reuse": 2
  }
}
```

> 建議「分項加總 100，錯字／標點另外扣，最多扣 10 分」，避免重複計算。實際數值待確認。
>
> 量規預設三組：均衡版 40／30／30、內容導向 45／25／30、語言導向 35／30／35；
> 三組扣分皆為錯字 0.5／標點 0.5、上限 10，等第門檻相同（皆為預設值，待老師確認）。
> 建立作業時可選 preset，評分前可再調整配分、扣分與等第門檻；`assignment.json` 的 `rubric` 是最終依據。
> 等第門檻至少一筆，名稱去空白後不可空白或重複，最低分須為 0–100 且不可重複，儲存時由高到低排序；
> UI 與 main 共用同一套驗證，錯誤訊息為繁體中文。
> 舊 id `junior`／`senior`／`vocational` 保留為 `balanced` 別名。
> 已儲存的 work 分數與等第不會因量規或等第門檻變更自動改寫，只影響之後的計算。

### 4.4 `work.json`

```json
{
  "schema_version": 1,
  "class_id": "C302-2025F",
  "assignment_id": "E20250107",
  "seat": "07",
  "name": "王小明",
  "status": "grading",
  "pages": [
    { "id": "p1", "file": "p1.jpg", "width": 2600, "height": 3466, "sha256": "…" }
  ],
  "annotations": [
    {
      "id": "01J…",
      "page_id": "p1",
      "anchor": { "x": 0.42, "y": 0.31 },
      "category": "sentence",
      "subtype": "word_choice",
      "text": "「影響」在此為中性詞……",
      "library_id": "S-09",
      "library_version": "2026.1",
      "meta": { "wrong": "在", "correct": "再", "original": "", "revised": "", "reason": "" },
      "created_at": "2026-11-19T14:30:00+08:00"
    }
  ],
  "scores": {
    "items": { "content": 32, "structure": 24, "language": 25 },
    "deduction": { "typo": 2, "punct": 0.5, "override": null },
    "total": 78.5,
    "grade": "B+"
  },
  "final_comment": {
    "text": "……",
    "library_id": "C-21",
    "library_version": "2026.1"
  },
  "updated_at": "2026-11-19T14:35:00+08:00"
}
```

### 4.5 評語庫

```json
{
  "schema_version": 1,
  "library_version": "2026.1",
  "locale": "zh-TW",
  "entries": [
    {
      "id": "S-09",
      "category": "sentence",
      "subtype": "word_choice",
      "text": "「影響」在此為中性詞……",
      "tags": ["general"],
      "min_chars": 0,
      "disabled": false,
      "source": "builtin"
    }
  ]
}
```

- 不存 `used_count`／`last_used_at`；由所有 `work.json` 推導。
- 內建條目可改寫、可停用、不刪除；舊批注存文字快照。
- 匯入新版只新增缺少的 id 與正規化後不重複的文字，不覆蓋 base、自訂、停用或既有 `work.json`；匯入條目存在 `_library/*.json` 的 `imported`、版本記在 `imported_version`，沒有新增時不改版本也不寫檔。
- 總評五面向由 `packages/core/src/library/comment-coverage.json` 管理，依據見 `docs/評語庫結構依據.md`；`npm run library:coverage` 檢查五面向 minimum 與 ID、每條 comment 至少屬於一個面向、19 類各至少 2 條、同分類不重複，並核對兩份 Markdown 的五面向分布與結構摘要。

### 4.6 手機產出

手機把圖片與可選 sidecar 上傳到 Google Drive 的 inbox；桌機透過本機同步資料夾監看。建議擺在 `<root>/<classId>/<assignmentId>/`：

```text
<drive>/inbox/C302-2025F/E20250107/
  S07__20261119T143012__001.jpg
  S07__20261119T143012__001.json   ← 可選；沒有時由檔名解析座號
```

也支援扁平 `<root>/`，此時必須有 sidecar，靠 `class_id`／`assignment_id` 路由：

```text
<drive>/inbox/
  S07__20261119T143012__001.jpg
  S07__20261119T143012__001.json
```

```json
{
  "schema_version": 1,
  "class_id": "C302-2025F",
  "assignment_id": "E20250107",
  "seat": "07",
  "seq": 1,
  "session_id": "20261119T143012",
  "captured_at": "2026-11-19T14:30:12+08:00"
}
```

桌面 watcher 有 sidecar 時以 sidecar 為準並驗證班級／作業；沒有 sidecar 才退回檔名解析，只接受 `S07…` 或開頭正好 `07`，不猜。成功匯入後刪除 Drive 來源圖片與 sidecar；重複檔移到 `_duplicates/`，失敗檔移到 `_unmatched/` 並附原因。PDF 不支援。

### 4.7 成績寫回 Excel

**狀態：已實作（E6，2026-11-20）。**

老師的成績表是既有 `.xlsx`，程式只負責「按座號填分數」，不重新排版。

```json
{
  "schema_version": 1,
  "gradebook": {
    "path": "D:/teaching/114-1/成績.xlsx",
    "sheet": "作文",
    "header_row": 1,
    "seat_column": "B",
    "name_column": "C",
    "score_column": "D",
    "grade_column": "E",
    "seat_format": "{seat}"
  }
}
```

**規則**

1. 讀 `header_row` 以下，用 `seat_column` 建「座號 → 列號」索引；`7`／`07`／`S07` 都視為 07；對不到就列入報告，不猜姓名。
2. **先複製成 `成績.graded-{timestamp}.xlsx` 再寫入**，原檔永不覆蓋；檔名碰撞加 `-02`。
3. 寫入後重新開啟驗證：該列分數正確、列數未變、座號與姓名未被改。
4. `.xlsm`、含圖表／樞紐／巨集的檔案，`exceljs` 可能破壞內容 → 偵測到就改走「匯出新檔」模式並提示。
5. 同一份作業重複寫入 → 每次建立新的 graded 副本，報告列出變更前後值；原檔仍不變。
6. 失敗一律保留可用的匯出檔（CSV／乾淨 xlsx），不讓分數卡在程式裡。

**實作與驗收（2026-11-20）**

- `gradebook.json` 使用既有 `GradebookConfigSchema`；設定可存、可重讀、可修改，切換作業各自載入。
- UI 在匯入佇列加「成績寫回」按鈕；面板提供選擇成績表、自動偵測、儲存設定、寫回成績、匯出 CSV、開啟輸出資料夾，並顯示成功數、未匹配、未完成、重複座號、變更前後、驗證結果與輸出路徑。
- 自動偵測在前 10 列找「座號」「姓名」「分數／成績／總分」「等第」；分數欄找不到時改挑下方多為數值的欄（可辨識「作文一」）。main 端以 ExcelJS 讀寫，renderer 不載入整份成績表。
- `npm run excel:check` 25/25：測試表「作文」（編號／座號／姓名／作文一／等第，座號含 7、08、S12、99）；寫回 S07／S08／S12，S15 unmatched、S20 grading 不寫；原檔 6,655 bytes 完全未變；副本列數 5、分數 81／74／90、等第 A-／B++／A++ 且座號姓名未改；重複寫回與檔名碰撞（`-02`）各自產生新副本；重複座號 07（第 2、3 列）中止；另外驗證欄位格式、檔案不存在、工作表不存在、座號欄空白四種繁中錯誤；`.xlsm` 與含 `xl/charts/` 字樣走匯出模式；失敗保留 CSV；設定 296 bytes 可重讀；隱藏視窗確認按鈕、面板與七個 preload API。
- 已知限制：單一作業、單一工作表；ExcelJS 可能微調樣式，故含圖表／樞紐／巨集一律匯出新檔；不支援一次寫回多份作業或整班批次 PDF。

---

## 五、關鍵設計決策

| 主題 | 建議做法 |
|---|---|
| 匯入 | 監看 `_inbox`，忽略 `.tmp`、`.crdownload`、`~$`、`desktop.ini`；檔案大小穩定 2 秒才處理 |
| 重複匯入 | 用 SHA-256 比對，已匯入就跳過 |
| 配對失敗 | 移到 `_unmatched/`，UI 顯示原因 |
| 圖片處理 | EXIF 轉正、移除 GPS／中繼資料、長邊上限 2600px、產生 WebP 縮圖 |
| 原子寫入 | `work.json.tmp` → fsync → rename；保留 `.bak`；壞檔降級讀 `.bak` |
| 鎖檔 | 資料庫根目錄放 `.essay-grader.lock`；偵測另一台機器寫入就警告 |
| 批注 | 點擊放置 pin；可拖曳成 underline／box；五類顏色固定；自訂類型歸「其他」統計 |
| 詞句批改 | 「語句」類拖曳標記範圍，輸入建議改寫（D25）；`meta.original`／`revised` 存前後對照，回饋單以「原句 → 建議」呈現；原句可留空（紙本無 OCR） |
| 快捷鍵 | 1–5 切類型、Enter 下一份、Ctrl+Z/Y、Del 刪除、+/- 縮放、PageUp/Down 翻頁；輸入框聚焦時停用全域快捷鍵 |
| 復原 | 以 command／patch 為單位，保留 100 步；切換學生不清除，關閉程式才清 |
| 自動儲存 | 變更後 500ms debounce；切換學生、關閉視窗、匯出前強制 flush |
| 重複檢查 | 正規化：去 `{變數}`、標點、空白；P0 精確比對，D19 已加相似度 ≥0.85（字元 bigram Jaccard），相同與近似一起計入上限，批次檢查同規則 |
| 總評 30 字 | 去空白與標點後計算；顯示剩餘字數；未達不可完成批閱 |
| 等第門檻 | 評分前可編輯等第名稱與最低分；至少一筆、名稱去空白不重複、最低分 0–100 不重複；儲存時由高到低排序，既有 `scores` 不改寫 |
| 完成檢查表 | 列出總評不足、總評重複第 3 次、未評分、缺頁；可點擊跳轉 |
| PDF | 同一個 React 回饋單元件，螢幕預覽與 `printToPDF` 共用；A4、`@page { margin: 0 }` |
| 回饋單內容 | 只印分數、等第、扣分、分項、總評、詞句前後對照、常錯字、佳句；**不印原圖** |
| 一頁溢出 | 依序套 10pt → 9.2pt → 8.4pt；仍溢出就顯示警告並阻止匯出，不產生被裁切的 PDF |
| 中文字型 | 內建 Noto Serif TC（或系統標楷體 fallback） |
| 批次 PDF | 逐份產生，避免同時開 45 個 hidden window；清洗 Windows 非法字元 |
| 統計 | 全部從 annotation 推導；G2 需要 `meta.wrong`／`correct` |
| Excel 成績 | 先寫副本再原子替換；座號對不到只報告不猜；`.xlsm`／圖表檔改走匯出模式 |
| 備份 | 一鍵 zip 整個資料庫根目錄，排除 lock／暫存；還原＝解壓後直接開啟 |
| 隱私 | 不連網、不埋 telemetry；移除照片 GPS；日誌不寫學生姓名與評語全文 |

---

## 六、施工順序與里程碑

| 階段 | 時間（單人全職） | 產出 | 驗收 |
|---|---:|---|---|
| M0 規格補齊＋Spike | 0.5–1 週 | 3 張畫面草圖、量規數值、JSON schema、測試資料、PDF/Canvas/檔案監看 spike | 規格簽核；PDF 中文一頁可輸出；2600px 圖片可縮放＋標記不跑位 |
| M1 資料層＋專案 | 1 週 | 開啟／建立資料庫、班級、名單、作業、schema 驗證、原子寫入 | 手動改 JSON 不會壞；壞檔可從 `.bak` 恢復 |
| M2 匯入＋佇列 | 1–1.5 週 | 資料夾監看、座號配對、`_unmatched`、待批／批閱中／已批、Excel 名單 | 丟 10 張圖進 inbox，全部正確配對或明確標錯 |
| M3 批閱核心 | 2.5–3 週 | 三欄式介面、縮放／平移／翻頁、五類標記、評語庫、編輯刪除、復原、快捷鍵、autosave、作業量規選擇、評分前調整配分與等第門檻 | 連續批 3 份不用滑鼠也能完成；關閉重開内容一致；調整量規或等第不覆寫既有分數 |
| M4 評分＋防重複 | 1 週 | 分項給分、自動扣分、總分／等第、總評 30 字、同批重複提示／阻擋、完成檢查表 | 45 份批次檢查不會漏；第 3 次總評被擋 |
| M5 回饋單 | 1–1.5 週 | 一頁 A4 預覽、單份 PDF、列印、檔名規則 | 中文不缺字、不溢頁；PDF 開啟正常 |
| M6 統計（已完成） | 1 週 | G1 弱項排行、G2 常錯字、G3 個人弱項、CSV | 數字與批注一致；可匯出 |
| G4 與上次比較（已完成） | 0.5 週 | `compare.ts` 純函式、`stats:compare` IPC、StatsPanel 比較區塊 | `compare:check` 15/15：狀態、平均、弱項、排行、拒絕與 UI |
| G6 佳句庫累積（已完成） | 0.5 週 | `praise.ts` 純函式、`praise:bank` IPC、佳句庫面板與複製 | `praise:check` 15/15：去重、排序、去識別、範圍、壞作業跳過與 UI |
| M7 打磨＋交付（已完成） | 1 週 | 安裝檔、portable、備份／還原、日誌與錯誤處理、使用者說明 | 乾淨 Windows 10/11 可安裝、可批完一班 |
| Drive 外部 inbox（已完成） | 0.5 週 | 監看 Google Drive 本機同步資料夾、子資料夾／扁平擺法、去重、`_unmatched`／`_duplicates`、UI 與設定 | `drive:check` 23/23；成功匯入刪除雲端來源；資料庫不進雲端 |
| M8 Android 掃描器（App 建置完成，待實機驗證） | 3–4 週 | 選班級／作業／學生、ML Kit 掃描、多頁排序、重拍、離線佇列、Google Drive inbox 寫入；桌面端 manifest 產生 | 手機拍 3 頁 → 桌機 10 秒內出現在佇列 |
| M9 P1 | 4–6 週 | 批次 PDF、含原圖、冷卻輪替、匯出 CSV、備份排程、遷移工具 | 依 P1 清單逐項驗收 |

**粗估**：桌機 MVP 6–8 週；桌機 P0 約 9–11 週；加 Android 與 QA 約 14–17 週。需求不再變動的估算，誤差約 ±30%。

> 進度：M0（骨架）、M1（資料層）、M2（匯入佇列）、M3（批閱核心）、M4（批次檢查）、M5（回饋單）、M6（統計）、M7（打磨＋交付）、Drive 外部 inbox、E6（成績寫回 Excel）、未匹配照片手動分配、F2（整班批次回饋單）、10 分鐘 soak、G4（與上次比較）、G6（佳句庫）與 M8（Android 掃描器 App）已完成建置；M1 11/11、M2 13/13、M3 77/77、M4 17/17、M5 19/19、M6 17/17、M7 25/25、drive 23/23、manifest 11/11、excel 25/25、match 21/21、batch 17/17、compare 15/15、praise 15/15、Android JVM 16/16、soak 通過。M3 已含基本分項評分、自動扣分、總評字數、同批重複阻擋、建立作業可選量規、評分前調整配分與等第門檻；M4 補上作業層級批次檢查與 45 份流程驗收；M5 補上一頁 A4 回饋單、單份 PDF、列印與溢頁阻擋；M6 補上 G1 弱項排行、G2 常錯字、G3 個人弱項、分數摘要與 CSV 四檔匯出；M7 補上備份／還原、日誌與錯誤處理、ErrorBoundary、使用者說明、electron-builder 設定與 NSIS／portable 打包；Drive 外部 inbox 補上 Google Drive 本機同步資料夾監看、兩種上傳擺法、sidecar／檔名座號、去重、PDF 擋下、來源清理、狀態與 UI；E6 補上成績表設定與自動偵測、座號索引、graded 副本、重新開啟驗證、重複座號中止、圖表／巨集匯出模式、失敗 CSV 與 UI 面板；G4 補上座號對齊、進步／退步／持平／新作品／缺資料、只計 compared 的班級平均、弱項四類每份平均、進步／退步前 5 與比較 UI。

**M3 驗收備註**

- `npm run m3:check` 涵蓋：EXIF 轉正與長邊 2600、600px 縮圖、評語庫 138 條分類、`normalizeComment`、三組量規配分與舊 id 相容、`computeScore`、`validateWork` 三種情境、work 存取（含 D25）、量規更新（拒絕非 100、`balanced` → `content`、既有分數不變）、等第門檻（自訂三級排序、88／72／65 對應優／甲／乙、重複最低分與空白名稱被拒、既有分數不變）、主畫面與批閱介面載入、量規編輯器載入。
- m2 匯入改走 sharp 前處理後仍為 13/13，10 檔實測約 2 秒。
- 量規規則：建立作業可選均衡／內容導向／語言導向；評分前可再調整 preset、自訂三項配分與等第門檻。若已有任何 work 帶分數或 `status === 'done'`，UI 先確認才寫入，且不自動改寫既有 `scores`；目前這份的預覽以新量規重算，完成批閱時才落盤。
- 等第規則：至少一筆；名稱去空白後不可空白或重複；最低分須為 0–100 數字且不可重複；儲存時由高到低排序，main 與 UI 共用 core 的驗證，錯誤訊息為繁體中文。
- 已知限制：量規三組數值與等第門檻仍為預設值，待老師確認；等第名稱未限制長度、門檻未限制級距；只有高中職評語庫；成績寫回已於 E6 補上；UI 自動驗收只確認進站、載入與量規編輯器出現，未逐項模擬完整鍵盤流程。

**M4 驗收備註**

- **量規預設採用均衡版（`balanced-default`，40／30／30）**：建立作業不帶 `rubricPreset` 時由 schema 預設 `balanced`，建立表單的下拉也預設均衡版。之後仍可在建立作業時改選內容導向／語言導向，或進批閱後按「調整量規」修改。
- `npm run m4:check` 17/17：以 1 班 45 人、1 份均衡版作業，產生 44 份作品（S45 刻意未匯入），涵蓋 29 份合法 `done`、5 份總評不足、5 份未評分、3 份共用總評、2 份缺頁檔案。
- 批次檢查統計：在學 45、已匯入 44、待批 0、批閱中 11、已批 33、未匯入 1；問題 14 條、提醒 11 條。重複規則只標第 3 份（S42），前兩份（S40、S41）合法；缺頁檔案 2 份與未匯入 1 人均被抓到；執行約 32 ms（門檻 < 2 秒）。
- 批次檢查實作：`packages/core/src/audit.ts` 的純函式 `auditWorks`／`appendMissingPageIssues`，重用 `normalizeComment`、`countFinalChars`、`computeScore`；repository 的 `auditAssignment` 補 fs 缺頁檢查；IPC `assignment:audit`；preload `window.electronAPI.assignment.audit`。
- UI：匯入佇列面板的「批次檢查」按鈕，結果以同卡片面板呈現（統計 chips、問題表格、只看有問題／全部、重新檢查、前往批閱）；從批閱返回時若面板開著會自動重查。
- 已知限制：批次檢查目前只掃描單一作業，不做跨作業重複；頁面檔案只確認存在，不重新驗證圖片內容；Excel 寫回已於 E6 補上（回饋單與統計已於 M5／M6 補上）。

**M5 驗收備註**

- **回饋單資料由 `class.json`＋`assignment.json`＋`work.json` 即時推導**：`packages/core/src/feedback.ts` 的 `buildFeedbackSheet` 產生分項、扣分、錯字聚合、詞句改寫、佳句與檔名；分數與等第優先使用 `work.scores` 的完成快照，量規事後調整不會改寫已批結果。
- **一頁 A4 內容**：只印分數／等第／扣分、分項、總評、詞句前後對照、常錯字、佳句；不印原圖。摘要上限為錯字 12 種、詞句 6 句、佳句 4 句，超出僅截顯示，完整資料仍在 `work.json`。
- **PDF 實作**：隱藏 BrowserWindow 載入同一個 React 頁面，等 `document.fonts.ready` 與版面量測完成後 `printToPDF`（A4、0 邊界、`preferCSSPageSize`）；數頁數必須為 1 才寫檔。中文使用 Microsoft JhengHei，標題 fallback 標楷體／PMingLiU。
- **溢頁**：normal（10pt）→ compact（9.2pt）→ tiny（8.4pt）；最小字級仍超過 297mm 就標示並阻擋匯出。S08 約 7,600 字總評成功被擋下。
- **檔名**：程式固定 `S{座號}_feedback.pdf`（存在學生資料夾）；另存用中文 `{班級}_{題目}_S{座號}_{姓名}_回饋單_{日期}.pdf`，Windows 非法字元與多餘空白皆清洗。
- **入口**：匯入佇列只有 `done` 的列有「回饋單」；批閱畫面右下角也有按鈕。預覽工具列提供列印、匯出 PDF、另存 PDF 與開啟資料夾。
- `npm run m5:check` 19/19：S07 回饋單資料（81 扣 2 = 79、B++）、錯字聚合、詞句只收 revised、檔名清洗、1 頁 150 KB（約 360 ms）、JhengHei 子集、超長內容與未完成批閱被擋、預覽視窗可開啟且重複使用、主畫面與回饋單頁煙霧。
- 已知限制：只支援單份、無整班批次 PDF；列印對話框未自動化；回饋單只用系統字型；Excel 寫回已於 E6 補上；整班批次 PDF 已於 F2 補上。

**M6 驗收備註**

- **統計範圍固定為已批作品**：`packages/core/src/stats.ts` 的 `buildAssignmentStats` 只把 `status === 'done'` 的作品計入班級摘要、G1 排行與 G2 常錯字；`pending`／`grading` 與未匯入仍列在 G3 個人表，但標示「不計入」。
- **G1 弱項排行**：以「類別＋子類」為一列，依次數排序；佔比分母為全部弱項批注總數（不含佳句與一般評語），另顯示涉及人數與類別合計 chips。
- **G2 常錯字**：跨學生聚合 `meta.wrong`／`meta.correct`，同一組錯字合併次數並列出座號；未填結構化欄位者不列入常錯字表。
- **G3 個人弱項**：每人取前三項弱項；未完成或未匯入不顯示弱項，避免把批閱中的資料當成結果。
- **分數摘要**：平均、中位、最高、最低、等第分布與分項平均；分數與等第沿用 `work.scores` 快照，量規事後調整不影響已批結果。
- **CSV**：固定輸出 `scores.csv`、`weakness-ranking.csv`、`common-typos.csv`、`student-weakness.csv` 到作業資料夾的 `_stats/`；UTF-8 BOM＋CRLF，Excel 可直接開，逗號與引號正確轉義，重新匯出覆寫同名檔。
- **UI**：匯入佇列面板加「統計」按鈕；面板含摘要、等第／分項平均、G1／G2／G3、匯出 CSV 與開啟統計資料夾。`spike-out/m6-stats.png` 已能完整拍到四個區塊。
- `npm run m6:check` 17/17：6 人、5 份作品、4 份 `done`、13 個弱項批注、在→再×3、平均 81、四份 CSV（`scores.csv` 633 bytes）、統計 UI 與匯出皆通過。
- 已知限制：只做單一作業的 G1／G2／G3，跨作業比較已於 G4 補上（G5 題目間整體比較未做）；G1 佔比以弱項批注總數為分母；CSV 未做 Excel 樣式；成績寫回已於 E6 補上；整班批次 PDF 已於 F2 補上；10 分鐘 soak 已於 2026-11-20 補上。

**G4 驗收備註**

- **核心**：`packages/core/src/compare.ts` 的 `compareAssignmentStats(current, previous, generatedAt?)` 為純函式，以座號對齊兩份 `AssignmentStats` 的所有在學學生，不改來源。
- **狀態**：兩邊都有 `done` 分數才比進步／退步／持平；本次有、上次沒有為新作品，上次有、本次沒有為缺資料，兩邊都沒有為資料不足。每筆含 previousScore／currentScore、delta、grades、counted 與 status。
- **平均**：`averagePrevious`／`averageCurrent` 只以 compared（兩邊都有分數）學生為母體；兩個平均各自四捨五入到一位小數後再相減得到 `averageDelta`，避免新作品或缺考造成假進步。
- **弱項**：只比 typo／sentence／structure／other，使用 `StudentStatsRow.counts`；以 compared 人數為分母計算每份平均次數。Δ 為本次－上次，負值代表改善、正值代表變多。
- **排行與 UI**：進步／退步前 5 依 Δ 排序（同分依座號）。UI 在統計面板加「與上次比較（G4）」，下拉依作業 id 由小到大列出同班其他作業，預設目前作業之前最近的一份（同日 `-02` 正確）；沒有其他作業顯示「這是第一份作業，尚無可比較資料」。摘要 chips、排行、弱項表、可滾動學生表與載入／失敗／無資料狀態皆有；切換作業以 key 重置。
- **IPC／preload**：`stats:compare(classId, currentId, previousId)`；preload `stats.compare`。repository 會驗證班級存在、兩份作業都在同班、id 格式正確且 currentId ≠ previousId。
- `npm run compare:check` 15/15：5 人、3 份作業（含同日 -02）；compared=3、improved=1（S07 +9）、declined=1（S08 −5）、same=1、new=1（S20）、missing=1（S15）；平均 78.3→79.7（Δ +1.4）；弱項 1.3→1.0、0.7→0.3、0.3→0.7；換 previousId 後 73.3→79.7（Δ +6.4）；同份、跨班、不存在皆被拒絕；純函式不改來源；UI 下拉預設、摘要、表格、切換重置與 preload API 通過。
- 已知限制：一次只比一組（目前 vs 一份上次作業），沒有多份趨勢；弱項只到類別層級；比較結果未匯出 CSV／PDF；G5 題目間整體比較未做。

**G6 驗收備註**

- **核心**：`packages/core/src/praise.ts` 的 `buildPraiseBank` 只收 `status === 'done'` 且 `category === 'praise'` 的批注；以 `normalizeComment` 去重，保留第一次出現的原文，統計 `count`／`workCount` 與來源 `assignments`，時間用 `annotation.created_at`、缺則 `work.updated_at`；排序為 count 高→低、lastAt 新→舊。
- **去識別**：輸出型別與序列化結果都沒有座號、姓名或 `seat`／`name` 欄位，只保留佳句原文、次數、作品份數與作業標題。
- **Repository**：`getPraiseBank(classId?)` 只讀；本班或全部班級掃描，`assignment.json` 讀不到與 `work.json` 損壞會跳過並記 warning。
- **IPC／preload／UI**：`praise:bank` 與 `praise.bank`；右上角「佳句庫」面板提供本班／全部、搜尋、單筆與全部複製、空白／錯誤／載入與關閉；複製走 `clipboard.writeText`。
- `npm run praise:check` 15/15：2 班、3 份作業、6 份作品；本班 4 句 7 次、全部 5 句 8 次；P1 正規化後 3 次／3 份；來源 `E20261101`、`E20261115` 依 id 排序；缺 `created_at` 正確退回 `work.updated_at`；序列化 1,154 bytes 不含測試姓名、座號或 `seat`／`name`；壞掉的 assignment 不影響結果；UI 與 preload 通過。
- 已知限制：一次掃描指定範圍內所有作業與作品，量大時需等待，沒有分頁；只做文字正規化去重，沒有語意相似判斷、單一作業／日期篩選或 CSV／Markdown 匯出。

**M7 驗收備註**

- **備份**：`createBackupZip` 以 archiver 串流寫入 zip，entry 一律資料庫根目錄的相對 POSIX 路徑；排除 `.essay-grader.lock` 與所有 `*.tmp`／`*.restore.tmp`，保留班級、作業、work、圖片、`_stats` 與 `.bak`。預設檔名 `essay-grader-backup-YYYYMMDD-HHmm.zip`，不含姓名。
- **還原**：`restoreBackupZip` 先以 yauzl 列出並驗證所有 entry，再用串流解壓；拒絕絕對路徑、磁碟代號、`..`、ADS、符號連結、重複路徑與非資料庫 zip。目的地非空一律拒絕；解壓失敗會清掉本次寫入內容。還原成功後由 IPC 以新資料夾 `openDatabase`，舊資料庫不動。
- **日誌**：`apps/desktop/src/main/logger.ts` 寫 `app.getPath('userData')/logs/app.log`，格式為 ISO timestamp＋level＋訊息；`app.log` 超過 2 MB 輪替為 `app.1.log`。只記錄事件與錯誤，不記錄學生姓名、總評、批注全文或圖片。`uncaughtException`、`unhandledRejection`、`render-process-gone`、載入失敗皆入日誌；嚴重錯誤顯示「開啟日誌／結束」視窗。
- **ErrorBoundary**：React 根層包 `ErrorBoundary`，顯示友善錯誤畫面、重新載入與開啟日誌，並把錯誤名稱／訊息寫入日誌（不含 props 或作品內容）。
- **打包**：`apps/desktop/electron-builder.yml`，appId `tw.edu.essaygrader`、productName「作文批閱」、win x64、nsis（非 oneClick、可選路徑、桌面捷徑）＋portable、asar、sharp／@img asarUnpack、`npmRebuild: false`；產物 `EssayGrader-0.1.0-Setup.exe`（134,137,825 bytes）、`EssayGrader-0.1.0-Portable.exe`（120,788,287 bytes），F2 完成後於 2026-11-20 以同版號重新打包，輸出 `apps/desktop/release`。指令：`npm run dist`、`npm run dist:win`、`npm run dist:portable`。設定以 `electronDist` 使用已安裝的 Electron runtime；第一次打包可能需要下載 NSIS／7zip。
- `npm run m7:check` 25/25：備份內容與排除規則、相對路徑、非空目的地、zip slip、還原後可讀、日誌格式與輪替、敏感內容、ErrorBoundary、UI 入口、preload API、打包設定、版本與產物檢查。
- 已知限制：只提供 Windows x64 安裝檔；備份為完整快照且未加密；還原只能到新的空資料夾；日誌只留一份輪替檔；portable 的設定與日誌仍在 `%APPDATA%`。

**F2 驗收備註**

- **批次範圍**：只處理目前作業 `status === 'done'` 且有 `scores` 的作品；`pending`、`grading`、已批未評分列為 skipped，內容溢頁或其他錯誤列為 failed，單份失敗不中斷整批。依座號排序、逐份開啟隱藏視窗輸出，避免同時占用量測資源。
- **輸出位置**：保留 `S{座號}/S{座號}_feedback.pdf`；另複製到作業資料夾 `_feedback/S{座號}_{姓名}_回饋單.pdf`，姓名空白退回 `S{座號}_回饋單.pdf`，沿用 `sanitizeFileName`。重跑覆蓋同名 PDF 與報告，不動原始作品。
- **報告**：`_feedback/report.json` 與 `report.csv`（UTF-8 BOM＋CRLF）；含 generatedAt、總數、成功／跳過／失敗／取消、每筆座號／姓名／狀態／輸出路徑／原因／耗時。CSV 正確轉義逗號與引號。
- **進度與取消**：`feedback:batch-progress` 每份完成送出 jobId、index／total、seat／name、status、message、completed；同一時間只允許一個批次；`feedback:batch-cancel(jobId)` 在下一份開始前停止，已完成保留，未處理標 cancelled，回傳完整報告。主流程接受 `onProgress`／`shouldCancel` callback，自動驗收不經 IPC。
- **UI**：匯入佇列新增「批次回饋單」；面板顯示已批／未完成份數、預估輸出位置、開始／取消／開啟資料夾、進度條與目前座號姓名，完成後顯示統計與明細表。空作業停用開始；切換作業以 key 重置面板。
- `npm run batch:check` 17/17：5 位學生（3 份正常 `done`、1 份 `grading`、1 份 `done` 但總評超長），結果 exported=3、skipped=1、failed=1；canonical PDF 皆 1 頁、135–136 KB；`_feedback/` 3 份中文檔名 PDF；`report.json` 與 `report.csv`（約 725 bytes、BOM、6 列）一致；進度順序、取消（1 exported＋2 cancelled）、重複啟動拒絕與 UI 煙霧皆通過。
- 已知限制：批次以單一作業為範圍；失敗或跳過後需重跑整批，尚未提供只重跑失敗項；取消不刪除已完成 PDF；份數多時需等待逐份輸出。
- 已以同版號 0.1.0 重新打包，Setup 134,137,825 bytes、Portable 120,788,287 bytes。

**soak 驗收備註**

- **入口**：`npm run soak`（`electron apps/desktop --soak`），預設 10 分鐘，支援 `--soak-minutes=1` 等短版；測試資料庫與輸出路徑都在 `spike-out/soak/`，報告 `spike-out/soak-report.json`。
- **資料**：1 班 45 位在學學生、1 份作業、45 份 `done` 作品；每人 1 頁小 JPG、分數 62–90、總評皆不同且 ≥30 字、5 個批注，避免批次檢查被 `missing_page`／`final_short`／`final_reuse` 誤標。
- **每圈**：批次檢查（done=45、問題 0）、統計（done=45）、整班批次回饋單 45 份（exported=45、failed=0）、3 位輪替學生 autosave（固定長度總評，重讀驗證）、等待 700–850ms、比對批次後視窗數。
- **記憶體**：暖機 45 份後記 baseline；每 60 秒與每圈結束以 `app.getAppMetrics()` 逐行程加總 `memory.privateBytes`（Electron 45 執行時欄位；型別宣告為 `private`，程式兩者都接受），必要時退回 working set／resident set。正式 10 分鐘：15 圈、16 次批次、720 份 PDF、45 次 autosave；baseline 291 MB、final 291 MB、peak 426 MB、growth 0 MB。
- **視窗**：baseline 0、批次中最多 1、批次後最多 0、結束 0；沒有逐圈增加。
- **結束驗證**：45/45 份作品可讀、1 頁、分數不變；最後一輪 45/45 份 `_feedback` PDF 皆 1 頁且 >20 KB；無未捕捉錯誤、無 failed；關閉資料庫後 exit code 0。
- **吞吐量**：暖機 37.7 秒；各圈 36.0–65.8 秒，多數約 37 秒。第 14–15 圈升至 52.7／65.8 秒；同期記憶體與視窗數沒有累積，前一次 10 分鐘測試也在少數圈數出現類似升幅後回落，研判為主機 I/O／防毒掃描，非程式泄漏，列為已知限制。
- **門檻**：final < 700 MB、peak < 800 MB、growth < 180 MB；本機 baseline 285 MB，保留明顯餘裕。換電腦仍應重跑確認。

---

## 七、P0 建議再瘦身

### 0.1 版（先跑通閉環）

- A1／A2／A5／A6／A7：名單、作業、量規、扣分（A4／A5 已支援班級與作業編輯刪除，2026-11-22）
- C1／C2／C3／C5：監看、配對、佇列、狀態
- D1／D2／D4／D5／D6／D7／D10／D11／D12／D13／D17／D18／D21／D23／D25：批閱、評語庫、總評、重複檢查、快照、詞句改寫（D11 自訂評語增刪改已完成，2026-11-22；D12 國中／高中職雙評語庫與自動選用已完成，2026-11-21；D13 常用排序與釘選已完成，2026-11-21；D21 評語庫版本更新已完成，2026-11-22；D23 停用取代刪除已完成，2026-11-22）
- E1／E2／E3／E6：分項、扣分、總分／等第、寫回 Excel
- F1：一頁回饋單
- H1／H2／H3／H4：資料夾、原子寫入、正規化座標、備份

### 0.2 版

- G1／G2／G3 統計
- G4 與上次比較（已完成，2026-11-20）
- G6 佳句庫累積（已完成，2026-11-21）
- F2 全班批次 PDF（已完成，2026-11-20）
- 匯入／匯出 CSV
- 完整錯誤處理與安裝檔

### 先不要做

- AI（J1–J4）、語音、手機輕批、手寫塗鴉
- 多租戶、學生帳號、家長通知
- 線上稿紙編輯器
- 即時協作、雲端資料庫

---

## 八、主要風險與對策

| 風險 | 對策 |
|---|---|
| 77 項功能造成範圍失控 | 以 0.1／0.2／1.0 三段交付；每段結束才開下一段 |
| 量規沒定，評分做不下去 | M0 先產出一頁量規表，數值由使用者確認 |
| PDF 中文缺字／溢頁 | Spike 先驗證；內建字型；自動降字級＋溢出警告 |
| 雲端同步造成壞檔／衝突 | 資料庫不放即時雲端；手機只寫 inbox；原子寫入＋hash 去重＋lock |
| 學校電腦老舊 | 確認最低 Windows 與螢幕解析度；縮圖、2600px 上限、虛擬列表 |
| 手機沒有 Google Play Services | ML Kit 不可用時退回系統相機；或改用內建掃描 App＋手動匯入 |
| 資料遺失 | `.bak`、每日／手動 zip、匯入前不刪原檔 |
| 隱私 | 不連網、去 EXIF、日誌去識別；可選 app 鎖（P1） |
| 批次反覆開關隱藏視窗造成記憶體或視窗累積 | `npm run soak` 連續 10 分鐘、每圈 45 份回饋單；批次後視窗須回 baseline，private bytes 記 baseline／final／peak／growth；結束再驗證 45 份作品與 PDF |
| 注音／中文輸入與快捷鍵衝突 | 快捷鍵依 focus scope 停用；Enter 在輸入框內只儲存不跳下一份 |

---

## 九、待決事項

- [x] 桌機技術棧定案：Electron + React + TypeScript（2026-11-19）
- [x] 手機技術棧：Kotlin + ML Kit（第二階段）
- [x] 1 天 Spike 通過（PDF／Canvas／監看／記憶體，2026-11-19）
- [x] 成績寫回 Excel 的欄位對應與失敗處理（見 4.7，E6 已完成 2026-11-20）
- [x] 量規預設採用均衡版（40／30／30），之後可調整；另提供內容導向與語言導向，建立作業時可選
- [x] 評分前可調整量規；已有評分時先確認，且不自動改寫既有分數
- [x] A4／A5 班級與作業編輯刪除：班級只改 name／grade／teacher 且 id 不變，作業只改 title／prompt／genre／word_limit／due_at 且保留 rubric／rules；刪除移到系統資源回收桶並重啟 watcher；`crud:check` 24/24（2026-11-22）
- [ ] 三組量規的最終配分與等第預設值（目前均衡版為預設，數值可於評分前修改，待老師確認）
- [ ] 錯別字／標點的扣分單位與上限（目前 0.5／0.5、上限 10）
- [x] 回饋單只印文字與統計、不印原圖；一頁 A4、單份 PDF、列印與檔名規則已完成（2026-11-19）
- [x] 統計範圍：只計已批（`done`）作品；未完成與未匯入列個人表但不計入（2026-11-19）
- [x] CSV 格式：四檔、UTF-8 BOM＋CRLF、寫入作業資料夾 `_stats/`（2026-11-19）
- [x] 跨裝置搬檔方式：**Google Drive 本機同步資料夾（僅 inbox，資料庫不進雲端）**（2026-11-19）
- [x] 未匹配照片可手動指定座號，複製到 `_inbox` 交由既有 watcher 匯入；來源刪除、重複去重、無復原（2026-11-20）
- [x] 整班批次回饋單：逐份輸出、跳過未完成、溢頁不中斷、進度／取消、`_feedback/` 報告（2026-11-20）
- [x] 10 分鐘 soak：45 人、每圈 45 份回饋單、記憶體／視窗／資料驗證（2026-11-20）
- [ ] 是否先產出三張畫面草圖再進程式
- [x] 國中版評語庫草稿 138 條完成（2026-11-20；原 126 條，後增 12 條體裁補充）；D12 已於 2026-11-21 接入 runtime
- [x] 評語庫用語清洗：junior 20 條、senior 7 條；總評／佳句／結構改用通用指稱，`library:wording` 與 `junior:check` 納入標準流程（2026-11-20）
- [x] 總評結構改寫：junior 60 條、senior 60 條改以主旨／段落／順序／過渡／例證／首尾為主，新增 `library:structure` 檢查（2026-11-20）
- [x] 評語庫結構依據與覆蓋率（初始版）：16 類、junior／senior 各 60/60 覆蓋，新增 `library:coverage`（2026-11-20）
- [x] 體裁補充：整理使用者提供 6 張評語表，兩套庫各新增 12 條（記敘／抒情／議論各 4），分類擴為 19 類、comment 72/72 覆蓋（2026-11-20）
- [x] 總評五面向平衡：結構／立意取材／語言表達／情感體驗／格式應用；junior 33／21／12／20／10、senior 33／25／12／18／10，各改寫 23 條，維持 138 條與 72 條 comment（2026-11-20）
- [x] 短評侷限用語清洗：junior 36 條、senior 29 條；語句／結構改通用與條件式描述，結構不再寫死段落編號，佳句只談文本技巧；新增 `library:short`（2026-11-21）
- [x] 國中評語庫白話化：junior 95 條改寫，更換 JE-10、JS-13、JG-01、JG-02；新增 `junior:readability` 檢查抽象術語，維持 138 條、comment 72 條與五面向歸屬（2026-11-21）
- [x] D13 常用排序與釘選：三種排序、釘選跨作業保留、本批／累計次數由 `library_id` 即時推導；設定寫入 `librarySort`／`libraryPins`；`m3:check` 擴充至 38/38（2026-11-21）
- [x] D22 跨批冷卻輪替：記錄每條評語最後使用時間（annotation 用 `created_at`、final 用 `updated_at`），新增「冷卻輪替（久未用優先）」排序，可調冷卻天數（預設 30、1–365），久未用／從未用優先；`m3:check` 擴充至 46/46（2026-11-21）
- [x] D23 停用取代刪除：評語庫面板新增「管理」與停用／啟用；停用只隱藏條目、不刪除，舊批注保留文字與 `library_id`；`settings.json` 的 `libraryDisabled` 依國中／高中職分開保存；`library:get` 套用停用、`library:set-disabled` 驗證版本／id／boolean；`m3:check` 擴充至 59/59（2026-11-22）
- [x] D11 自訂評語增刪改：管理模式下新增／編輯／刪除自訂評語，表單填類別／子類／文字／標籤；存 `<db>/_library/{junior|senior}.json`，切換資料庫各自獨立；空文字、comment <30、非法類別／子類、重複文字、重複／非自訂 id 皆拒絕；內建只能停用；自訂可停用／啟用、插入、計入次數，刪除後舊 work 快照不變；`m3:check` 擴充至 72/72（2026-11-22）
- [x] D21 評語庫版本更新：管理模式「匯入新版」選 JSON，只新增缺少 id 與正規化後不重複的文字；不覆蓋 base／自訂／停用，`source=custom` 匯入後改 `builtin`、`disabled=false`；版本改用 `imported_version`，沒有新增不寫檔；國中／高中職各自獨立；`library-import:check` 19/19，涵蓋重複匯入、舊檔相容、`.bak` 還原、8 類錯誤與 UI 重新載入（2026-11-22）
- [x] 國中用詞辨析重寫：JS-08～JS-11 改為直接說明詞語用法；`library:short` 允許 word_choice 用引號標示詞語，其餘短評仍禁用（2026-11-21）
- [x] E1 快速給分：`distributeScore` 依量規比例分配 0–100 到各分項（0.5 步進、最後一項補差額、溢位回推），批閱評分卡片新增「分項合計／分配到三項／複製上一份」；複製只帶分項與手動覆寫，不動總評、批注、狀態；`m3:check` 擴充至 77/77（2026-11-22）
- [x] Android 掃描方向確認：掃描完成先預覽第一頁並選 0／90／180／270 度，整批套用；取消不留 pending、不上傳，上傳才先存 pending；0° 原檔複製、其餘逐頁旋轉重編碼 JPEG 92；`ImageRotation` 純函式與 JVM 測試（0/90/180/270、尺寸交換、取樣），Android JVM 16/16（2026-11-22）
- [ ] 目標電腦螢幕解析度（1366×768 是否為最低）

---

## 十、下一步

1. Spike 已完成，結果見 2.4。
2. M1、M2、M3、M4、M5、M6、M7 已完成。M3 交付三欄式批閱介面、縮放／平移／翻頁、五類批注、評語庫、復原、快捷鍵、autosave、基本評分與總評重複提示；M4 交付作業層級批次檢查（未匯入、總評不足、重複超限、未評分、缺頁檔案、尚未完成）與 45 份流程驗收；M5 交付一頁 A4 回饋單、單份 PDF、列印、另存中文檔名與溢頁阻擋；M6 交付統計面板（分數摘要、G1／G2／G3）與 CSV 四檔匯出；M7 交付備份／還原、zip slip 防護、日誌輪替、錯誤處理、ErrorBoundary、使用說明與 NSIS／portable 打包設定。
3. 圖片前處理（EXIF 轉正、移除 GPS／中繼資料、長邊 2600、縮圖）已隨 M3 完成。
4. 量規預設採用均衡版，建立作業可改選其他 preset、評分前可調整配分與等第門檻；變更只影響之後的計算，已有分數不自動改寫。
5. Google Drive 外部 inbox 已完成：設定持久化、子資料夾／扁平兩種擺法、sidecar 優先、檔名座號、SHA-256 去重、PDF 擋下、成功刪除來源、`_unmatched`／`_duplicates`、UI 四個按鈕與 `drive:check` 23/23。E6 成績寫回 Excel 已完成：`gradebook.json` 設定、自動偵測、座號索引、graded 副本、重新開啟驗證、重複座號中止、圖表／巨集匯出模式、失敗 CSV、`excel:check` 25/25。未匹配照片手動分配已完成：`.meta.json` 結構化資訊、內外清單、320px 縮圖、realpath 路徑防護、選取學生後複製到 `_inbox` 並產生 sidecar、依 mtime／檔名排序、來源與附屬檔刪除、重複去重、`match:check` 21/21。F2 整班批次回饋單已完成：逐份輸出、跳過未完成、溢頁不中斷、`_feedback/` 中文檔名與 JSON／CSV 報告、進度與取消、`batch:check` 17/17。10 分鐘 soak 已完成：45 人、每圈 45 份回饋單，15 圈、720 份 PDF，private 291→291 MB、peak 426 MB、視窗回 0，作品與 PDF 驗證全數通過。M8 Android 掃描器已完成建置：Kotlin＋ML Kit、選班級／作業／學生、多頁掃描、離線 pending、只寫 inbox；桌面端可產生 manifest.json，Android JVM 16/16、debug APK 建置通過，待實機驗證。
6. M7 打包已完成；若換電腦或離線打包，electron-builder 需要重新下載 Electron／NSIS，失敗時不影響 `npm run dev`、`m1:check`–`m7:check` 與既有資料。
7. D12 國中／高中職雙評語庫已接入（2026-11-21）：`JUNIOR_LIBRARY`／`SENIOR_LIBRARY` 並存，`libraryForGrade` 依學制自動選用，批閱面板可手動切換並顯示草稿提示；`settings.json` 的 `libraryMode` 保留偏好。國中版仍為草稿（`2026.2-draft`），待國中國文老師校閱。結構依據與 19 類覆蓋表見 `docs/評語庫結構依據.md`，覆蓋率由 `npm run library:coverage` 把關；體裁補充的來源與採用對照見 `docs/評語參考_使用者提供.md`。高中職混合型子類與情意題條數列為校閱待決事項。
8. D13 常用排序與釘選已完成（2026-11-21）：`sortLibraryEntries` 支援預設／常用（累計）／本批未用優先，釘選在三種排序都最先，釘選內依累計次數由高到低；使用次數由 `work.json` 的 `library_id` 即時推導，不維護計數器。`settings.json` 新增 `librarySort`／`libraryPins`，釘選為跨作業的全域 UI 偏好；`m3:check` 38/38 涵蓋排序、計數、偏好與 UI 重載。
9. G6 佳句庫累積已完成（2026-11-21）：`buildPraiseBank` 跨作業收集 `done` 作品的佳句、`normalizeComment` 去重、統計次數與來源作業，輸出不含座號姓名；Repository `getPraiseBank(classId?)` 支援本班／全部班級並跳過壞作業；主畫面「佳句庫」面板可搜尋、複製與關閉；`praise:check` 15/15。
10. D21 評語庫版本更新已完成（2026-11-22）：管理模式「匯入新版」只新增缺少 id 與正規化後不重複的文字，不覆蓋自訂、停用或既有條目；匯入條目存 `_library/*.json` 的 `imported` 並記錄 `imported_version`，沒有新增時不改版本、不寫檔；國中／高中職各自獨立，舊檔缺少新欄位仍可讀；`library-import:check` 19/19。
11. D19 近似重複偵測已完成（2026-11-22）：總評去除變數、標點與空白後以字元 bigram Jaccard 計算相似度，門檻 0.85（`FINAL_SIMILARITY_THRESHOLD`）；相同與近似一起計入 `final_max_reuse`；批閱畫面顯示「相同」或「相近＋百分比」並在達上限時紅字阻擋；批次檢查（`audit.ts`）同步採用，依座號逐一比對前面作品；`similarity:check` 13/13。只比對 `final_comment.text`，其他批注的近似重複不在本輪。
11. M8 桌面 manifest 已完成（2026-11-22）：外部 inbox 根目錄的 `manifest.json` 只含目前班級、全部作業與在學學生座號／姓名，不含分數、批注、總評或作品內容；原子寫入、覆蓋舊檔與無 root 錯誤皆納入 `manifest:check` 11/11。Android App 已建置（AGP 8.7.3、Kotlin 2.0.21、Gradle 8.9、compileSdk 35），16 個 JVM 測試通過，APK 位於 `apps/android/app/build/outputs/apk/debug/app-debug.apk`。待辦：實機驗證 ML Kit、SAF、Drive 上傳與桌機端到端流程，之後進入 M9。
12. E1 快速給分與 Android 掃描方向確認已完成（2026-11-22）：桌面評分卡片可用「分項合計」依量規比例分配到三項，或以「複製上一份」帶入同作業最近一份的分項與手動覆寫，兩者都走原 autosave；Android 掃描完成先確認整批旋轉角度，取消不留 pending、按上傳才存 pending 並傳 Drive；Android JVM 16/16、`m3:check` 77/77。

> 技術棧已定案；M0 骨架（`apps/desktop`、`packages/core`、`fixtures`）已建立，Git 已初始化（main），M0–M7＋F2＋10 分鐘 soak＋M8 桌面 manifest 與 Android App 建置已完成並建立對應 commit。
