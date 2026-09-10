$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:PATH = "C:\Program Files\Android\Android Studio\jbr\bin;" + $env:PATH
$gradleBat = "C:\Users\hp\.gradle\wrapper\dists\gradle-8.7-bin\bhs2wmbdwecv87pi65oeuq5iu\gradle-8.7\bin\gradle.bat"
$appDir = "C:\Users\hp\OneDrive\Desktop\ot bus stand\ot bus stand\android-app"

Write-Host "Stopping any locked Gradle daemons..." -ForegroundColor Yellow
& $gradleBat --stop

$buildDir = "$appDir\app\build"
if (Test-Path $buildDir) {
    Write-Host "Cleaning locked build directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
}

Write-Host "Building BusAwake Android APK..." -ForegroundColor Cyan
& $gradleBat -p $appDir assembleDebug --no-daemon

$apkSource = "$appDir\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkSource) {
    $apkSize = (Get-Item $apkSource).Length / 1MB
    Write-Host ("`n[SUCCESS] APK BUILT SUCCESSFULLY! Size: {0:N2} MB" -f $apkSize) -ForegroundColor Green
    Copy-Item $apkSource -Destination "C:\Users\hp\OneDrive\Desktop\ot bus stand\ot bus stand\BusAwake.apk" -Force
    Copy-Item $apkSource -Destination "C:\Users\hp\OneDrive\Desktop\BusAwake.apk" -Force
    Write-Host "[READY] BusAwake.apk ready at workspace root and Desktop!" -ForegroundColor Cyan
} else {
    Write-Host "[ERROR] Build output APK not found." -ForegroundColor Red
}
