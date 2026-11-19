# 將本專案所在的磁碟區固定為 M:，換主機時只需在新主機執行一次。
#
# 使用時機：
#   1. 把 PROJECTS 磁碟接到新主機，Windows 給它 E:／F: 等其他代號。
#   2. 先關閉使用該磁碟的程式（檔案總管、編輯器、終端機）。
#   3. 以「系統管理員」開啟 PowerShell，從該磁碟執行：
#        powershell -ExecutionPolicy Bypass -File .\tools\fix-m-drive.ps1
#   4. 完成後專案路徑會回到 M:\dev\projects\essay-grader。
#
# 注意：M: 已被其他磁碟占用時，本腳本不會搶用，會請你先釋放 M:。

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$item = Get-Item -LiteralPath $root
$drive = $item.PSDrive

if (-not $drive -or $drive.Provider.Name -ne 'FileSystem') {
  throw "無法判斷專案所在磁碟：$root"
}

$currentLetter = $drive.Name
if ($currentLetter -eq 'M') {
  Write-Host "[fix-m] 專案已在 M:，不需變更。"
  Write-Host "[fix-m] 路徑：$root"
  exit 0
}

$source = Get-Volume -DriveLetter $currentLetter
if (-not $source) {
  throw "找不到磁碟區 ${currentLetter}:"
}

$target = Get-Volume -DriveLetter M -ErrorAction SilentlyContinue
if ($target) {
  if ($target.UniqueId -eq $source.UniqueId) {
    Write-Host "[fix-m] 專案磁碟區已經是 M:。"
    exit 0
  }

  throw "M: 已被其他磁碟占用（$($target.FileSystemLabel) / $($target.UniqueId)）。請先釋放 M: 再執行。"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "變更磁碟代號需要系統管理員權限。請以「系統管理員」開啟 PowerShell 後再執行。"
}

Write-Host "[fix-m] 將 ${currentLetter}: 改為 M:（磁碟區 $($source.UniqueId)）…"
Set-Partition -DriveLetter $currentLetter -NewDriveLetter M

$after = Get-Volume -DriveLetter M -ErrorAction SilentlyContinue
if (-not $after -or $after.UniqueId -ne $source.UniqueId) {
  throw "變更失敗；請確認沒有程式正在使用 ${currentLetter}:，或改用磁碟管理手動指定 M:。"
}

Write-Host "[fix-m] 完成。專案路徑：M:\dev\projects\essay-grader"
Write-Host "[fix-m] 請重新開啟終端機與編輯器。"
