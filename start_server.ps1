# Lightweight Local BusAwake Server for Mobile & Desktop
$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:$port/")
try {
    $listener.Start()
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host " BusAwake Local Server Running!" -ForegroundColor Green
    Write-Host " On this PC:    http://localhost:$port" -ForegroundColor Yellow
    Write-Host " On your Phone: http://192.168.29.212:$port" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Cyan
} catch {
    Write-Host "Prefix http://*:$port/ failed, trying localhost..." -ForegroundColor Yellow
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
    Write-Host "Running on http://localhost:$port" -ForegroundColor Green
}

$root = $PSScriptRoot

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $rawPath = $request.Url.LocalPath
        if ([string]::IsNullOrWhiteSpace($rawPath) -or $rawPath -eq "/") {
            $rawPath = "/index.html"
        }
        
        $cleanPath = $rawPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $filePath = Join-Path $root $cleanPath
        
        # Security headers for all responses
        $response.Headers.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
        $response.Headers.Set("X-Content-Type-Options", "nosniff")
        $response.Headers.Set("X-Frame-Options", "SAMEORIGIN")
        $response.Headers.Set("Referrer-Policy", "strict-origin-when-cross-origin")
        $response.Headers.Set("Content-Security-Policy", "upgrade-insecure-requests")

        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".svg"  { $response.ContentType = "image/svg+xml" }
                ".png"  { $response.ContentType = "image/png" }
                ".ico"  { $response.ContentType = "image/x-icon" }
                default { $response.ContentType = "application/octet-stream" }
            }

            # GZip compress text-based responses
            $ct = $response.ContentType
            if ($ct.StartsWith("text/") -or $ct.StartsWith("application/javascript") -or $ct.StartsWith("application/json") -or $ct.StartsWith("image/svg+xml")) {
                $ms = [System.IO.MemoryStream]::new()
                $gz = [System.IO.Compression.GZipStream]::new($ms, [System.IO.Compression.CompressionMode]::Compress)
                $gz.Write($bytes, 0, $bytes.Length)
                $gz.Close()
                $bytes = $ms.ToArray()
                $ms.Close()
                $response.Headers.Set("Content-Encoding", "gzip")
            }

            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 - File Not Found")
            $response.ContentLength64 = $notFound.Length
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
        }
        $response.OutputStream.Close()
    } catch {
        # ignore client disconnects
    }
}
