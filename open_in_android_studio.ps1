# Open BusAwake Android App in Android Studio
$studioPath = "C:\Program Files\Android\Android Studio\bin\studio64.exe"
$projectDir = "$PSScriptRoot\android-app"

if (Test-Path $studioPath) {
    Write-Host "Launching Android Studio with BusAwake project..." -ForegroundColor Green
    Start-Process $studioPath -ArgumentList "`"$projectDir`""
} else {
    Write-Host "Android Studio not found at $studioPath" -ForegroundColor Red
    Write-Host "Please open Android Studio manually and choose Open -> $projectDir" -ForegroundColor Yellow
}
