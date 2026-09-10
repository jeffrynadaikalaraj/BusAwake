param (
    [int]$Port = 8080
)

$rootPath = $PSScriptRoot
if (-not $rootPath) { $rootPath = (Get-Location).Path }

try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
    $listener.Start()
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " 🚌 BusAwake Local Server is RUNNING!" -ForegroundColor Cyan
    Write-Host " Local URL:    http://localhost:$Port/" -ForegroundColor Yellow
    Write-Host " Network URL:  http://192.168.29.212:$Port/" -ForegroundColor Yellow
    Write-Host " Serving from: $rootPath" -ForegroundColor Gray
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Error "Could not bind to port $Port. $_"
    exit 1
}

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".webp" = "image/webp"
    ".ico"  = "image/x-icon"
}

while ($true) {
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
        $requestLine = $reader.ReadLine()

        if ([string]::IsNullOrEmpty($requestLine)) {
            $client.Close()
            continue
        }

        $parts = $requestLine.Split(" ")
        if ($parts.Length -lt 2) {
            $client.Close()
            continue
        }

        $rawPath = $parts[1].Split("?")[0]
        if ($rawPath -eq "/" -or [string]::IsNullOrWhiteSpace($rawPath)) {
            $rawPath = "/index.html"
        }

        $relPath = $rawPath.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
        $fullPath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relPath))

        if ($fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($fullPath)) {
            $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)

            $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nAccess-Control-Allow-Origin: *`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($bytes, 0, $bytes.Length)
        } else {
            $errBody = "404 Not Found: $rawPath"
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes($errBody)
            $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($errBytes.Length)`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($errBytes, 0, $errBytes.Length)
        }

        $stream.Flush()
        $client.Close()
    } catch {
        # continue on connection reset
    }
}
