# Essay Grader 0.3.3（桌機版）

日期：2026-11-24（Asia/Taipei）
版本：0.3.3（tag `v0.3.3`）
適用：Windows 10 22H2 以上（x64）

## 本版重點（0.3.3）

- **內建使用說明**：桌機上方新增「使用說明」按鈕，開啟可捲動的 9 章操作說明；手機主畫面最下方也有「使用說明」對話框。
- **匯出成績 Excel**：統計面板新增「匯出成績 Excel」，不需原始 Excel 檔，直接產生 `_stats/成績-<作業>-<時間>.xlsx`，包含座號、姓名、在學、狀態、頁數、各分項、扣分、總分、等第、總評與更新時間。
- 承接 0.3.2：Drive inbox 入口改到上方並可直接產生 manifest。
- 承接 0.3.1：Drive inbox 每 20 秒補掃、來源刪除穩定重試與 WARN、Android EXIF 轉正＋四張縮圖方向確認＋橫向提醒、上傳 0 bytes 判定失敗、側欄對比修正、Android release 簽章。

## 檔案

| 形式 | 檔案 | 大小 | SHA-256 |
|---|---|---|---|
| 安裝版 | `EssayGrader-0.3.3-Setup.exe` | 134,218,799 bytes（約 128.0 MB） | `183E94B1C2204F7740B58637E25F52C83F9F7A18B631355A8D2B6BEC13AC76B5` |
| 免安裝版 | `EssayGrader-0.3.3-Portable.exe` | 120,858,297 bytes（約 115.3 MB） | `77C74033C3CE6754F37AB0D272B0C5D2C3E8B453593D022BFE7A80870CA80A02` |
| Android 掃描器（已簽署） | `EssayGrader-Scanner-0.3.3-release.apk` | 5,489,938 bytes（約 5.2 MB） | `22C8E34A605AA6E17E66F38CB8BB885B4E9CBE5F51D6FDE8428C92D1D0F24B9F` |
| 範例名單（選用） | `名單-商三忠-115上.xlsx` | 7,591 bytes | — |

## 安裝

- **安裝版**：可選安裝路徑，建立桌面與開始功能表捷徑，可從「應用程式與功能」解除安裝。
- **免安裝版**：單一 exe，直接執行，適合隨身碟或沒有安裝權限的電腦。
- 第一次開啟時自行選一個資料夾當資料庫；程式不會把資料庫放進安裝目錄。
- 兩者可共存，但不要同時開啟同一個資料庫（有單一實例與 `.essay-grader.lock` 保護）。
- 安裝檔**未簽章**，SmartScreen 可能顯示警告，需選「更多資訊 → 仍要執行」。

## 驗證

- `npm run typecheck`、`npm run build` 通過。
- `npm run m7:check` 25/25，含版本一致 0.3.3、產物命名與非空檢查。
- Android `assembleRelease` 通過，`versionCode` 5、`versionName` 0.3.3，keystore 簽章有效。
- 使用說明面板與手機說明對話框已實機／畫面驗證；匯出成績 Excel 以實際資料庫產出並讀回檢查欄位與 3 筆列。

## 已知限制

- 安裝檔未簽章。
- Google Drive for desktop 可能在上傳後鎖住大圖約 8 分鐘；來源刪除重試 5 分鐘後仍可能失敗並顯示警告，作品已匯入，來源可稍後手動清除。
- Android 端為本機 keystore 簽署的 release APK，未上架 Google Play。
- 只支援 Windows x64。
