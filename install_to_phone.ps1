# 1-Click Install BusAwake to Connected Android Phone via USB
$adb = "C:\Users\hp\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$root = $PSScriptRoot
$apk = "$root\BusAwake.apk"

if (-not (Test-Path $adb)) {
    Write-Host "[ERROR] adb.exe not found at $adb" -ForegroundColor Red
    exit 1
}

Write-Host "Checking for connected Android devices..." -ForegroundColor Cyan
$devicesOutput = & $adb devices
Write-Host $devicesOutput

$deviceList = ($devicesOutput -split "`r?`n") | Where-Object { $_ -match "\bdevice\b" -and $_ -notmatch "List of" }

if (-not $deviceList) {
    Write-Host "`n=======================================================" -ForegroundColor Yellow
    Write-Host " NO PHONE DETECTED YET!" -ForegroundColor Red
    Write-Host " Please follow these 3 quick steps on your phone:" -ForegroundColor Yellow
    Write-Host "  1. Plug your phone into this PC using a USB data cable." -ForegroundColor White
    Write-Host "  2. On your phone, go to Settings -> Developer Options -> Turn ON 'USB Debugging'." -ForegroundColor White
    Write-Host "  3. When prompted on your phone screen ('Allow USB Debugging?'), tap 'Allow'." -ForegroundColor White
    Write-Host "=======================================================" -ForegroundColor Yellow
    exit 0
}

Write-Host "`n[DEVICE FOUND] Installing latest BusAwake.apk..." -ForegroundColor Green
& $adb install -r $apk

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[SUCCESS] BusAwake installed successfully on your phone!" -ForegroundColor Green
    Write-Host "Launching BusAwake on phone screen..." -ForegroundColor Cyan
    & $adb shell am start -n com.busawake.app/.MainActivity
} else {
    Write-Host "`n[ERROR] Failed to install APK. Check phone screen for permission prompts." -ForegroundColor Red
}
