# 建置／測試 Android 掃描器。
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/android.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/android.ps1 -Task ":app:testDebugUnitTest"
# 工具鏈優先序：
#   JAVA_HOME／ANDROID_HOME → M:\dev\tools\jdk、M:\dev\tools\android-sdk。

param(
    [string]$Task = ':app:assembleDebug'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot 'apps\android'
$gradlew = Join-Path $androidDir 'gradlew.bat'

function Find-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        return (Resolve-Path $env:JAVA_HOME).Path
    }
    $fallback = 'M:\dev\tools\jdk'
    if (Test-Path (Join-Path $fallback 'bin\java.exe')) {
        return (Resolve-Path $fallback).Path
    }
    return $null
}

function Find-AndroidSdk {
    foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
        if ($candidate -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }
    $fallback = 'M:\dev\tools\android-sdk'
    if (Test-Path $fallback) {
        return (Resolve-Path $fallback).Path
    }
    return $null
}

if (-not (Test-Path $gradlew)) {
    Write-Error "找不到 apps/android/gradlew.bat，請確認 Android 專案完整。"
    exit 1
}

$javaHome = Find-JavaHome
if (-not $javaHome) {
    Write-Error "找不到 JDK。請設定 JAVA_HOME，或把 JDK 放在 M:\dev\tools\jdk。"
    exit 1
}

$androidHome = Find-AndroidSdk
if (-not $androidHome) {
    Write-Error "找不到 Android SDK。請設定 ANDROID_HOME，或把 SDK 放在 M:\dev\tools\android-sdk。"
    exit 1
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome

Write-Host "JAVA_HOME    = $env:JAVA_HOME"
Write-Host "ANDROID_HOME = $env:ANDROID_HOME"
Write-Host "Gradle task  = $Task"

Push-Location $androidDir
try {
    & $gradlew $Task
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($code -ne 0) {
    Write-Error "Gradle 工作失敗（$Task），exit code $code。"
    exit $code
}

exit 0
