# Essay Grader — 製作方案（草案）

> 版本 v0.9 ｜ 2026-11-19 ｜ 狀態：**M5 回饋單完成；待 M6 統計**
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
| 資料庫 | 本地資料夾為唯一資料庫；雲端只做單向搬檔 |
| 手機角色 | 只寫 `inbox`，不直接寫 `work.json` |
| 第一版核心 | 批一份 → 批一班 → 出回饋單 |

---

## 一、現況判讀

### 已具備

| 項目 | 狀態 |
|---|---|
| 功能清單 | 77 項：P0 39／P1 22／P2 16 |
| 核心主線 | 拍照匯入 → 批注 → 評分 → 回饋單 |
| 資料夾契約 | 全 ASCII、中文存 JSON |
| 評語庫 | 高中職 126 條，含防罐頭化與輪替規則 |
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
> 尚未跑滿 10 分鐘 soak，自動化目前是 2.5 秒縮放壓力測試，列為 M1 前的追蹤項。

---

## 三、建議架構

### 3.1 資料流

```text
┌──────────────┐   SAF 寫入   ┌──────────────────┐   Syncthing / OneDrive
│ Android 掃描 │ ──────────> │ 共用 inbox 資料夾 │ ──────────────┐
└──────────────┘              └──────────────────┘                │
                                                                  v
┌─────────────────────────────────────────────────────────────────────┐
│ Windows 桌機                                                         │
│  watcher → 匯入/配對 → essay-grader-data（本地唯一資料庫）          │
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
- 雲端資料夾只做「手機 → 桌機」單向搬檔與桌機備份。
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
- 匯入新版只新增缺少的 id，不覆蓋已自訂與已停用。

### 4.6 手機產出

```text
<sync>/C302-2025F/E20250107/_inbox/
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

桌面 watcher 用 sidecar 配對，不靠檔名猜；sidecar 缺失才退回檔名解析。

### 4.7 成績寫回 Excel

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
    "seat_format": "07"
  }
}
```

**規則**

1. 讀 `header_row` 以下，用 `seat_column` 建「座號 → 列號」索引；對不到就列入報告，不猜。
2. **先複製成 `成績.graded-{timestamp}.xlsx` 再寫入**，原檔永不覆蓋。
3. 寫入後重新開啟驗證：該列分數正確、列數未變。
4. `.xlsm`、含圖表／樞紐的檔案，`exceljs` 可能破壞內容 → 偵測到就改走「匯出新檔」模式並提示。
5. 同名作業重複寫入 → 覆寫同欄，並在報告列出變更前後值。
6. 失敗一律保留可用的匯出檔（CSV／xlsx），不讓分數卡在程式裡。

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
| 重複檢查 | 正規化：去 `{變數}`、標點、空白；P0 精確比對，P1 再加相似度 ≥0.85 |
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
| M6 統計 | 1 週 | G1 弱項排行、G2 常錯字、G3 個人弱項、CSV | 數字與批注一致；可匯出 |
| M7 打磨＋交付 | 1 週 | 安裝檔、portable、備份、錯誤處理、log、使用者說明 | 乾淨 Windows 10/11 可安裝、可批完一班 |
| M8 Android 掃描器 | 3–4 週 | 選班級／作業／學生、ML Kit 掃描、多頁排序、重拍、離線佇列、inbox 寫入 | 手機拍 3 頁 → 桌機 10 秒內出現在佇列 |
| M9 P1 | 4–6 週 | 批次 PDF、含原圖、冷卻輪替、匯出 CSV、備份排程、遷移工具 | 依 P1 清單逐項驗收 |

**粗估**：桌機 MVP 6–8 週；桌機 P0 約 9–11 週；加 Android 與 QA 約 14–17 週。需求不再變動的估算，誤差約 ±30%。

> 進度：M0（骨架）、M1（資料層）、M2（匯入佇列）、M3（批閱核心）、M4（批次檢查）、M5（回饋單）已於 2026-11-19 完成；M1 11/11、M2 13/13、M3 25/25、M4 17/17、M5 19/19。M3 已含基本分項評分、自動扣分、總評字數、同批重複阻擋、建立作業可選量規、評分前調整配分與等第門檻；M4 補上作業層級批次檢查與 45 份流程驗收；M5 補上一頁 A4 回饋單、單份 PDF、列印與溢頁阻擋。

**M3 驗收備註**

- `npm run m3:check` 涵蓋：EXIF 轉正與長邊 2600、600px 縮圖、評語庫 126 條分類、`normalizeComment`、三組量規配分與舊 id 相容、`computeScore`、`validateWork` 三種情境、work 存取（含 D25）、量規更新（拒絕非 100、`balanced` → `content`、既有分數不變）、等第門檻（自訂三級排序、88／72／65 對應優／甲／乙、重複最低分與空白名稱被拒、既有分數不變）、主畫面與批閱介面載入、量規編輯器載入。
- m2 匯入改走 sharp 前處理後仍為 13/13，10 檔實測約 2 秒。
- 量規規則：建立作業可選均衡／內容導向／語言導向；評分前可再調整 preset、自訂三項配分與等第門檻。若已有任何 work 帶分數或 `status === 'done'`，UI 先確認才寫入，且不自動改寫既有 `scores`；目前這份的預覽以新量規重算，完成批閱時才落盤。
- 等第規則：至少一筆；名稱去空白後不可空白或重複；最低分須為 0–100 數字且不可重複；儲存時由高到低排序，main 與 UI 共用 core 的驗證，錯誤訊息為繁體中文。
- 已知限制：10 分鐘 soak 未跑；量規三組數值與等第門檻仍為預設值，待老師確認；等第名稱未限制長度、門檻未限制級距；只有高中職評語庫；回饋單／統計／成績寫回未做；UI 自動驗收只確認進站、載入與量規編輯器出現，未逐項模擬完整鍵盤流程。 

**M4 驗收備註**

- **量規預設採用均衡版（`balanced-default`，40／30／30）**：建立作業不帶 `rubricPreset` 時由 schema 預設 `balanced`，建立表單的下拉也預設均衡版。之後仍可在建立作業時改選內容導向／語言導向，或進批閱後按「調整量規」修改。
- `npm run m4:check` 17/17：以 1 班 45 人、1 份均衡版作業，產生 44 份作品（S45 刻意未匯入），涵蓋 29 份合法 `done`、5 份總評不足、5 份未評分、3 份共用總評、2 份缺頁檔案。
- 批次檢查統計：在學 45、已匯入 44、待批 0、批閱中 11、已批 33、未匯入 1；問題 14 條、提醒 11 條。重複規則只標第 3 份（S42），前兩份（S40、S41）合法；缺頁檔案 2 份與未匯入 1 人均被抓到；執行約 32 ms（門檻 < 2 秒）。
- 批次檢查實作：`packages/core/src/audit.ts` 的純函式 `auditWorks`／`appendMissingPageIssues`，重用 `normalizeComment`、`countFinalChars`、`computeScore`；repository 的 `auditAssignment` 補 fs 缺頁檢查；IPC `assignment:audit`；preload `window.electronAPI.assignment.audit`。
- UI：匯入佇列面板的「批次檢查」按鈕，結果以同卡片面板呈現（統計 chips、問題表格、只看有問題／全部、重新檢查、前往批閱）；從批閱返回時若面板開著會自動重查。
- 已知限制：批次檢查目前只掃描單一作業，不做跨作業重複；頁面檔案只確認存在，不重新驗證圖片內容；10 分鐘 soak、回饋單、統計、Excel 寫回仍未做。

**M5 驗收備註**

- **回饋單資料由 `class.json`＋`assignment.json`＋`work.json` 即時推導**：`packages/core/src/feedback.ts` 的 `buildFeedbackSheet` 產生分項、扣分、錯字聚合、詞句改寫、佳句與檔名；分數與等第優先使用 `work.scores` 的完成快照，量規事後調整不會改寫已批結果。
- **一頁 A4 內容**：只印分數／等第／扣分、分項、總評、詞句前後對照、常錯字、佳句；不印原圖。摘要上限為錯字 12 種、詞句 6 句、佳句 4 句，超出僅截顯示，完整資料仍在 `work.json`。
- **PDF 實作**：隱藏 BrowserWindow 載入同一個 React 頁面，等 `document.fonts.ready` 與版面量測完成後 `printToPDF`（A4、0 邊界、`preferCSSPageSize`）；數頁數必須為 1 才寫檔。中文使用 Microsoft JhengHei，標題 fallback 標楷體／PMingLiU。
- **溢頁**：normal（10pt）→ compact（9.2pt）→ tiny（8.4pt）；最小字級仍超過 297mm 就標示並阻擋匯出。S08 約 7,600 字總評成功被擋下。
- **檔名**：程式固定 `S{座號}_feedback.pdf`（存在學生資料夾）；另存用中文 `{班級}_{題目}_S{座號}_{姓名}_回饋單_{日期}.pdf`，Windows 非法字元與多餘空白皆清洗。
- **入口**：匯入佇列只有 `done` 的列有「回饋單」；批閱畫面右下角也有按鈕。預覽工具列提供列印、匯出 PDF、另存 PDF 與開啟資料夾。
- `npm run m5:check` 19/19：S07 回饋單資料（81 扣 2 = 79、B++）、錯字聚合、詞句只收 revised、檔名清洗、1 頁 150 KB（約 360 ms）、JhengHei 子集、超長內容與未完成批閱被擋、預覽視窗可開啟且重複使用、主畫面與回饋單頁煙霧。
- 已知限制：只支援單份、無整班批次 PDF；列印對話框未自動化；回饋單只用系統字型；10 分鐘 soak、統計、Excel 寫回仍未做。

---

## 七、P0 建議再瘦身

### 0.1 版（先跑通閉環）

- A1／A2／A5／A6／A7：名單、作業、量規、扣分
- C1／C2／C3／C5：監看、配對、佇列、狀態
- D1／D2／D4／D5／D6／D7／D10／D11／D12／D17／D18／D23／D25：批閱、評語庫、總評、重複檢查、快照、詞句改寫
- E1／E2／E3／E6：分項、扣分、總分／等第、寫回 Excel
- F1：一頁回饋單
- H1／H2／H3／H4：資料夾、原子寫入、正規化座標、備份

### 0.2 版

- G1／G2／G3 統計
- F2 全班批次 PDF
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
| 注音／中文輸入與快捷鍵衝突 | 快捷鍵依 focus scope 停用；Enter 在輸入框內只儲存不跳下一份 |

---

## 九、待決事項

- [x] 桌機技術棧定案：Electron + React + TypeScript（2026-11-19）
- [x] 手機技術棧：Kotlin + ML Kit（第二階段）
- [x] 1 天 Spike 通過（PDF／Canvas／監看／記憶體，2026-11-19）
- [ ] 成績寫回 Excel 的欄位對應與失敗處理（見 4.7）
- [x] 量規預設採用均衡版（40／30／30），之後可調整；另提供內容導向與語言導向，建立作業時可選
- [x] 評分前可調整量規；已有評分時先確認，且不自動改寫既有分數
- [ ] 三組量規的最終配分與等第預設值（目前均衡版為預設，數值可於評分前修改，待老師確認）
- [ ] 錯別字／標點的扣分單位與上限（目前 0.5／0.5、上限 10）
- [x] 回饋單只印文字與統計、不印原圖；一頁 A4、單份 PDF、列印與檔名規則已完成（2026-11-19）
- [ ] 跨裝置搬檔方式：Syncthing／OneDrive／Google Drive／USB
- [ ] 是否先產出三張畫面草圖再進程式
- [ ] 國中版評語庫時程（介面先留空位）
- [ ] 目標電腦螢幕解析度（1366×768 是否為最低）

---

## 十、下一步

1. Spike 已完成，結果見 2.4。
2. M1、M2、M3、M4、M5 已完成。M3 交付三欄式批閱介面、縮放／平移／翻頁、五類批注、評語庫、復原、快捷鍵、autosave、基本評分與總評重複提示；M4 交付作業層級批次檢查（未匯入、總評不足、重複超限、未評分、缺頁檔案、尚未完成）與 45 份流程驗收；M5 交付一頁 A4 回饋單、單份 PDF、列印、另存中文檔名與溢頁阻擋。
3. 圖片前處理（EXIF 轉正、移除 GPS／中繼資料、長邊 2600、縮圖）已隨 M3 完成。
4. 量規預設採用均衡版，建立作業可改選其他 preset、評分前可調整配分與等第門檻；變更只影響之後的計算，已有分數不自動改寫。
5. 下一步 M6：統計（G1 弱項排行、G2 常錯字、G3 個人弱項、CSV）；並行補 10 分鐘 soak、搬檔方式、成績寫回欄位、整班批次 PDF。

> 技術棧已定案；M0 骨架（`apps/desktop`、`packages/core`、`fixtures`）已建立，尚未初始化 Git repo。
