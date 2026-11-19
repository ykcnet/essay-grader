# 階段完成提示音
# 用法：powershell -ExecutionPolicy Bypass -File tools/notify.ps1 [訊息]

param(
  [string]$Message = 'Task complete'
)

[System.Media.SystemSounds]::Asterisk.Play()
Start-Sleep -Milliseconds 250
[System.Media.SystemSounds]::Exclamation.Play()
Start-Sleep -Milliseconds 900

Write-Host "[notify] $Message"
