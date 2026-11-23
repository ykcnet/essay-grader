# Essay Grader 0.3.2（桌機版）

日期：2026-11-23（Asia/Taipei）
版本：0.3.2（tag `v0.3.2`）
適用：Windows 10 22H2 以上（x64）

## 本版重點（0.3.2）

- **Drive inbox 入口改到上方**：頂部新增「Drive inbox」按鈕，不必先選作業就能設定資料夾、開啟資料夾或產生手機 manifest。
- **manifest 產生說明**：面板會顯示目前班級與「全部作業、在學學生」的提示；未選班級時按鈕停用。
- 承接 0.3.1：Drive inbox 每 20 秒補掃、來源刪除穩定重試與 WARN、Android EXIF 轉正＋四張縮圖方向確認＋橫向提醒、上傳 0 bytes 判定失敗、側欄對比修正、Android release 簽章。

## 檔案

| 形式 | 檔案 | 大小 | SHA-256 |
|---|---|---|---|
| 安裝版 | `EssayGrader-0.3.2-Setup.exe` | 134,216,127 bytes（約 128.0 MB） | `452DDB6C3180643C7CD61BC347F60508550C1EDEDD17D9B7FDE6018885AC2658` |
| 免安裝版 | `EssayGrader-0.3.2-Portable.exe` | 120,854,225 bytes（約 115.3 MB） | `DF162065A08068D463C3E9498154C959DBDD9C5753E877BF5C7DDC535E525A94` |
| Android 掃描器（已簽署） | `EssayGrader-Scanner-0.3.2-release.apk` | 5,487,542 bytes（約 5.2 MB） | `B5FFA3F69B63903D997B53E28436514FBF343DFDD509D34D96D69D2DEAFF6C48` |

## 安裝

- **安裝版**：可選安裝路徑，建立桌面與開始功能表捷徑，可從「應用程式與功能」解除安裝。
- **免安裝版**：單一 exe，直接執行，適合隨身碟或沒有安裝權限的電腦。
- 第一次開啟時自行選一個資料夾當資料庫；程式不會把資料庫放進安裝目錄。
- 兩者可共存，但不要同時開啟同一個資料庫（有單一實例與 `.essay-grader.lock` 保護）。
- 安裝檔**未簽章**，SmartScreen 可能顯示警告，需選「更多資訊 → 仍要執行」。

## 驗證

- `npm run typecheck`、`npm run build` 通過。
- `npm run m7:check` 25/25，含版本一致 0.3.2、產物命名與非空檢查。
- Android `assembleRelease` 通過，`versionCode` 4、`versionName` 0.3.2，keystore 簽章有效。
- 實機 T1–T13 通過、T14 部分通過；Drive inbox 面板已用畫面驗證。

## 已知限制

- 安裝檔未簽章。
- Google Drive for desktop 可能在上傳後鎖住大圖約 8 分鐘；來源刪除重試 5 分鐘後仍可能失敗並顯示警告，作品已匯入，來源可稍後手動清除。
- Android 端為本機 keystore 簽署的 release APK，未上架 Google Play；T14 的 0 頁情境未測。
- 只支援 Windows x64。
