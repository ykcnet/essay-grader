# Essay Grader 0.3.5（桌機 hotfix）

日期：2026-11-25（Asia/Taipei）
版本：0.3.5（tag `v0.3.5`）
適用：Windows 10 22H2 以上（x64）

## 本版重點（0.3.5）

- **名條匯入修正**：Google Drive 有時會建立 `_roster (1)`、`_roster (2)` 等重複資料夾；桌機現在會一併掃描，不再只看 `_roster`，避免手機上傳後「名條名單」空白。
- 匯入完成後，檔案會移到該資料夾下的 `_imported/`。
- Android 同步升為 **0.3.5**（versionCode 7），與桌機版號一致；相簿／四角校正入口已移除，維持直接掃描＋手動核對。

## 檔案

| 形式 | 檔案 | 大小 | SHA-256 |
|---|---|---|---|
| 安裝版 | `EssayGrader-0.3.5-Setup.exe` | 134,219,850 bytes（約 128.0 MB） | `DFD7189C3AEE8764A90A7152AC821BCEABA3E45C9DDFD2C0E246AD48F97A4867` |
| 免安裝版 | `EssayGrader-0.3.5-Portable.exe` | 120,864,600 bytes（約 115.3 MB） | `3C7C18DFF1A70B4857C0B11F8F28846EF1316CCD85C71E690ABF2082A69E1A17` |
| Android 掃描器（已簽署） | `EssayGrader-Scanner-0.3.5-release.apk` | 5,669,728 bytes（約 5.4 MB） | `BAC9ADB5E675224AFCC445AAD415EBBC7E8ACD7B4409D2C155D02961DCFEB5F5` |

## 安裝

- **安裝版**：可選安裝路徑，建立桌面與開始功能表捷徑，可從「應用程式與功能」解除安裝。
- **免安裝版**：單一 exe，直接執行，適合隨身碟或沒有安裝權限的電腦。
- 兩者可共存，但不要同時開啟同一個資料庫。
- 安裝檔**未簽章**，SmartScreen 可能顯示警告。

## 驗證

- `npm run typecheck`、`npm run build` 通過。
- `npm run m7:check` 25/25，含版本一致 0.3.5。
- 以 `_roster (1)` 內的實際名條 JSON 驗證：可列出並匯入，商一忠 32 人匯入成功。

## 已知限制

- 名條 OCR 仍為草稿輔助，需人工核對。
- 安裝檔未簽章。
- Android 端為本機 keystore 簽署的 release APK，未上架 Google Play。
