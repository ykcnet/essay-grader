# Essay Grader 0.3.1（桌機版）

日期：2026-11-23（Asia/Taipei）
版本：0.3.1（tag `v0.3.1`）
適用：Windows 10 22H2 以上（x64）

## 本版重點（0.3.1）

- **Drive 匯入補掃**：外部 inbox 每 20 秒全量補掃，補上 Google Drive 虛擬磁碟漏掉的檔案事件。
- **來源刪除重試**：刪除後須連續 12 秒不存在才算成功，最多重試 5 分鐘；失敗會寫 WARN 並保留 sidecar。
- **Android 方向修正**：掃描頁面先依 EXIF 轉正，再套用選定角度；方向確認改為 0°／90°／180°／270° 四張縮圖，直接點正立的那張。
- **橫向提醒**：手機明顯橫向時，開始掃描前提示可能造成頁面側倒。
- **上傳檢查**：寫入 0 bytes 直接判定失敗，不再回報成功。
- **側欄對比**：班級選取改淺底深字，hover 改淡藍底。
- **Android 簽章**：提供以本機 keystore 簽署的 0.3.1 release APK。
- 承接 0.3.0：掃描方向確認、快速給分、班級與作業編輯刪除、Android manifest 與淺色主題修正。

## 檔案

| 形式 | 檔案 | 大小 | SHA-256 |
|---|---|---|---|
| 安裝版 | `EssayGrader-0.3.1-Setup.exe` | 134,215,729 bytes（約 128.0 MB） | `B4D2FEFDEDB0735322A5FE9B96D10DF3F662FB171BB8E84748E5274F370AF7EC` |
| 免安裝版 | `EssayGrader-0.3.1-Portable.exe` | 120,853,703 bytes（約 115.3 MB） | `C3F7FA72B0EB32AFF02842F020A7B67F60D61C4426654D3449297D180A60FBC8` |
| Android 掃描器（已簽署） | `EssayGrader-Scanner-0.3.1-release.apk` | 5,487,542 bytes（約 5.2 MB） | `D0DFC5013662F99C7A50D76511FC3DB36F8AE67EACB3C26EAD08DE61F8C37E4F` |

## 安裝

- **安裝版**：可選安裝路徑，建立桌面與開始功能表捷徑，可從「應用程式與功能」解除安裝。
- **免安裝版**：單一 exe，直接執行，適合隨身碟或沒有安裝權限的電腦。
- 第一次開啟時自行選一個資料夾當資料庫；程式不會把資料庫放進安裝目錄。
- 兩者可共存，但不要同時開啟同一個資料庫（有單一實例與 `.essay-grader.lock` 保護）。
- 安裝檔**未簽章**，SmartScreen 可能顯示警告，需選「更多資訊 → 仍要執行」。

## 驗證

- `npm run typecheck`、`npm run build` 通過。
- `npm run m7:check` 25/25，含版本一致 0.3.1、產物命名與非空檢查。
- Android `assembleDebug` 建置通過；方向確認與 EXIF 轉正已實機驗證（`p12` 0° 正立、`p16` 90° 側躺、`p17` 0° 正立）。

## 已知限制

- 安裝檔未簽章。
- Google Drive for desktop 可能在上傳後鎖住大圖約 8 分鐘；來源刪除重試 5 分鐘後仍可能失敗並顯示警告，作品已匯入，來源可稍後手動清除。
- Android 端為本機 keystore 簽署的 release APK，未上架 Google Play；T1–T13 已實機驗證，T14 部分驗證（0 頁情境未測）。
- 只支援 Windows x64。
