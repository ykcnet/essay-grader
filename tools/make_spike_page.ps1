# 產生 Spike 用的 2600×3466 頁面圖
# 用法：powershell -ExecutionPolicy Bypass -File tools/make_spike_page.ps1

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\spike-assets'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$width = 2600
$height = 3466
$bmp = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 253, 247))

$linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 226, 217, 199), 2)
for ($y = 420; $y -lt ($height - 200); $y += 108) {
  $graphics.DrawLine($linePen, 200, $y, ($width - 200), $y)
}

$marginPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 192, 57, 43), 4)
$graphics.DrawLine($marginPen, 160, 120, 160, ($height - 140))

$titleFont = New-Object System.Drawing.Font('Segoe UI', 46, [System.Drawing.FontStyle]::Bold)
$titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 37, 69))
$graphics.DrawString('Essay Grader Spike - 2600 x 3466', $titleFont, $titleBrush, 220, 150)

$bodyFont = New-Object System.Drawing.Font('Segoe UI', 30)
$bodyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 92, 107, 122))
for ($i = 0; $i -lt 24; $i++) {
  $graphics.DrawString("Line $($i + 1) - pan, zoom and annotation anchor test.", $bodyFont, $bodyBrush, 220, (260 + $i * 108))
}

$out = Join-Path $outDir 'page-2600.jpg'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg)

$bodyBrush.Dispose()
$bodyFont.Dispose()
$titleBrush.Dispose()
$titleFont.Dispose()
$marginPen.Dispose()
$linePen.Dispose()
$graphics.Dispose()
$bmp.Dispose()

Write-Host "wrote $out"
