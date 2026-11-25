# Essay Grader 0.3.4（桌機版）

日期：2026-11-25（Asia/Taipei）
版本：0.3.4（tag `v0.3.4`）
適用：Windows 10 22H2 以上（x64）

## 本版重點（0.3.4）

- **名條掃描（輔助）**：手機主畫面新增「掃描名條（輔助）」，可用 ML Kit 掃描器或從相簿選照片；OCR 後顯示可編輯草稿，上傳到 Drive `_roster/`。
- **桌機名條匯入**：Drive inbox 面板新增「名條名單」，可將手機上傳的名條 JSON 匯入班級（同座號更新姓名、新座號新增），完成後移到 `_roster/_imported/`。
- **班級 hover 藍框**：側欄班級項目的滑鼠移入框線改為明顯藍框。
- 承接 0.3.3：內建使用說明、匯出成績 Excel、Drive inbox 入口在上方、Drive 補掃與來源刪除重試、Android EXIF 轉正與四縮圖方向確認、release 簽章。

### 名條 OCR 限制

目前 OCR 僅為**草稿輔助**，整張表格的框線與小字仍可能造成漏字、重複或配對錯誤；UI 與文件均已標註「請逐筆核對」。若錯誤率過高，建議改用「匯入 Excel」手動建立名單。

## 檔案

| 形式 | 檔案 | 大小 | SHA-256 |
|---|---|---|---|
| 安裝版 | `EssayGrader-0.3.4-Setup.exe` | 134,219,805 bytes（約 128.0 MB） | `93F96A34DCA799CF1C0F0E50151D1486E5FF6CB1871B4AAA812F1439369D42A3` |
| 免安裝版 | `EssayGrader-0.3.4-Portable.exe` | 120,857,350 bytes（約 115.3 MB） | `729B67F774139DCFC70F797CD3A59E49ACA58F43E0E3CA149E92E0072FD0F9E1` |
| Android 掃描器（已簽署） | `EssayGrader-Scanner-0.3.4-release.apk` | 5,661,552 bytes（約 5.4 MB） | `2FC9530522BD255CF95E71B5012975E60776D1F4D75567E362ACEFD6E9147C51` |

## 安裝

- **安裝版**：可選安裝路徑，建立桌面與開始功能表捷徑，可從「應用程式與功能」解除安裝。
- **免安裝版**：單一 exe，直接執行，適合隨身碟或沒有安裝權限的電腦。
- 第一次開啟時自行選一個資料夾當資料庫；程式不會把資料庫放進安裝目錄。
- 兩者可共存，但不要同時開啟同一個資料庫（有單一實例與 `.essay-grader.lock` 保護）。
- 安裝檔**未簽章**，SmartScreen 可能顯示警告，需選「更多資訊 → 仍要執行」。

## 驗證

- `npm run typecheck`、`npm run build` 通過。
- `npm run m7:check` 25/25，含版本一致 0.3.4、產物命名與非空檢查。
- Android `assembleRelease` 通過，`versionCode` 6、`versionName` 0.3.4，keystore 簽章有效。
- 名條掃描流程實機測試；名條匯入以模擬 JSON 驗證（40 筆匯入成功、檔案移到 `_imported/`）。

## 已知限制

- 安裝檔未簽章。
- 名條 OCR 準確率有限，需人工核對；近拍部分頁面會有梯形透視，ML Kit 不校正。
- Google Drive for desktop 可能在上傳後鎖住大圖約 8 分鐘；來源刪除重試 5 分鐘後仍可能失敗並顯示警告。
- Android 端為本機 keystore 簽署的 release APK，未上架 Google Play。
- 只支援 Windows x64。
