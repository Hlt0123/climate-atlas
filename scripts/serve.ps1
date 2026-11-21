# 零依赖静态服务器(v2)
param([int]$Port = 8791)
#   GET  http://127.0.0.1:                → dist/index.html
#   GET  http://127.0.0.1:<项目内路径>     → 任意白名单类型文件(含 .nc 大文件,流式)
#   POST http://127.0.0.1:save?name=x.json → 把请求体存到 data/processed/<name>
# 用法:powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve.ps1
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "serving $root at http://127.0.0.1:$Port"
$mimes = @{
  ".html" = "text/html; charset=utf-8"; ".json" = "application/json; charset=utf-8"
  ".js" = "text/javascript"; ".css" = "text/css"; ".csv" = "text/csv"
  ".txt" = "text/plain; charset=utf-8"; ".nc" = "application/octet-stream"
  ".gz" = "application/gzip"; ".tif" = "application/octet-stream"; ".zip" = "application/zip"
  ".pdf" = "application/pdf"; ".png" = "image/png"
}
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      if ($ctx.Request.HttpMethod -eq "OPTIONS") {
        $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
        $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        $ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true")
        $ctx.Response.StatusCode = 204
        $ctx.Response.Close()
        continue
      }
      if ($ctx.Request.HttpMethod -eq "POST" -and $ctx.Request.Url.AbsolutePath -eq "/save") {
        $name = $ctx.Request.QueryString["name"]
        if ($name -notmatch '^[A-Za-z0-9_.-]+$') { $ctx.Response.StatusCode = 400 }
        else {
          $dest = Join-Path $root ("data\processed\" + $name)
          $fs = [IO.File]::Create($dest)
          $ctx.Request.InputStream.CopyTo($fs)
          $fs.Close()
          $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
          $ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true")
          $msg = [Text.Encoding]::UTF8.GetBytes("saved " + (Get-Item $dest).Length + " bytes")
          $ctx.Response.ContentType = "text/plain"
          $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
          Write-Host ("saved " + $dest)
        }
        $ctx.Response.Close()
        continue
      }
      $path = $ctx.Request.Url.AbsolutePath
      if ($path -eq "/") { $path = "/dist/index.html" }
      $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
      $ctx.Response.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
      if ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase))) {
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if (-not $mimes.ContainsKey($ext)) { $ctx.Response.StatusCode = 403 }
        else {
          $ctx.Response.ContentType = $mimes[$ext]
          $ctx.Response.ContentLength64 = (Get-Item $file).Length
          $fs = [IO.File]::OpenRead($file)
          try { $fs.CopyTo($ctx.Response.OutputStream) } finally { $fs.Close() }
        }
      } else { $ctx.Response.StatusCode = 404 }
    } catch { try { $ctx.Response.StatusCode = 500 } catch {} }
    try { $ctx.Response.Close() } catch {}
  }
} finally { $listener.Stop() }
