# 產生測試用頁面圖（1200×1600）
# 用法：powershell -ExecutionPolicy Bypass -File tools/make_fixture_pages.ps1

Add-Type -AssemblyName System.Drawing

$root = Join-Path $PSScriptRoot '..\fixtures\C302-2025F\E20250107'
$students = @('S07', 'S08', 'S12')
$width = 1200
$height = 1600

foreach ($student in $students) {
  $dir = Join-Path $root $student
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  foreach ($page in 1..2) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 253, 247))

    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 226, 217, 199), 1)
    for ($y = 240; $y -lt ($height - 120); $y += 64) {
      $graphics.DrawLine($linePen, 90, $y, ($width - 90), $y)
    }

    $marginPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 192, 57, 43), 2)
    $graphics.DrawLine($marginPen, 72, 60, 72, ($height - 60))

    $font = New-Object System.Drawing.Font('Segoe UI', 26)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 92, 107, 122))
    $graphics.DrawString("$student / page $page", $font, $brush, 100, 100)

    $out = Join-Path $dir "p$page.jpg"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg)

    $brush.Dispose()
    $font.Dispose()
    $marginPen.Dispose()
    $linePen.Dispose()
    $graphics.Dispose()
    $bmp.Dispose()

    Write-Host "wrote $out"
  }
}
