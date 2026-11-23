# Essay Grader 0.3.0（桌機版）

日期：2026-11-23（Asia/Taipei）
版本：0.3.0（commit `d4595ee`、tag `v0.3.0`；2026-11-23 09:20 最終建置，含 Drive 匯入與來源刪除修正）
適用：Windows 10 22H2 以上（x64）

## 本版重點

- 掃描方向確認與旋轉：Android 掃描完成後先確認整批旋轉角度；取消不留 pending，按上傳才寫入佇列。
- 快速給分：可用「分項合計」依量規比例分配到三項，或以「複製上一份」帶入同作業最近一份的分項再手動覆寫。
- 班級與作業編輯／刪除。
- 修正 Android manifest 讀取與淺色主題對比。
- 承接 0.2.0：M8 Android 掃描器、Google Drive 外部 inbox、自訂評語、佳句庫、UI 對比修正。
- 2026-11-23 修正：Drive inbox 每 20 秒補掃、來源檔「穩定消失」刪除與警告、側欄選取與 hover 對比；Android 方向確認改為四張縮圖並支援 EXIF 轉正。

## 檔案

| 形式 | 檔案 | 大小 | SHA-256 |
|---|---|---|---|
| 安裝版 | `EssayGrader-0.3.0-Setup.exe` | 134,215,638 bytes（約 128.0 MB） | `0DBE6EEB8B09C308102B84E92E32C2509A805F5BA42BBB030DFE924CA83DC719` |
| 免安裝版 | `EssayGrader-0.3.0-Portable.exe` | 120,855,733 bytes（約 115.3 MB） | `4823CE615B2C84DDA9D7B32815AA337375D92B44DD47DE0B1ADFA59DA1A4010B` |
| Android 掃描器（debug，選用） | `EssayGrader-Scanner-0.2.0-debug.apk` | 10,870,477 bytes（約 10.4 MB） | `362668957184BD0F8971E077BC98AC21C523E2E5D1AF942EE4BD91CB5B68F60A` |

## 安裝

- **安裝版**：可選安裝路徑，建立桌面與開始功能表捷徑，可從「應用程式與功能」解除安裝。
- **免安裝版**：單一 exe，直接執行，適合隨身碟或沒有安裝權限的電腦。
- 第一次開啟時自行選一個資料夾當資料庫；程式不會把資料庫放進安裝目錄。
- 兩者可共存，但不要同時開啟同一個資料庫（有單一實例與 `.essay-grader.lock` 保護）。
- 安裝檔**未簽章**，SmartScreen 可能顯示警告，需選「更多資訊 → 仍要執行」。

## 驗證

- `npm run typecheck`、`npm run build` 通過。
- `npm run m7:check` 25/25，含版本一致 0.3.0、產物命名與非空檢查。
- `win-unpacked\EssayGrader.exe` FileVersion／ProductVersion 為 0.3.0。

## 已知限制

- 安裝檔未簽章。
- Android 端仍為 0.2.0 debug APK（`EssayGrader-Scanner-0.2.0-debug.apk`），ML Kit、SAF、Drive 上傳與桌機端到端流程待實機驗證。
- 只支援 Windows x64。
- Google Drive for desktop 可能在上傳後鎖住大圖約 8 分鐘；來源刪除重試 5 分鐘後仍可能失敗並顯示警告，作品已匯入，來源可稍後手動清除。
