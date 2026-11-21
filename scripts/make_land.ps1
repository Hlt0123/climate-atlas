# 把 Natural Earth 陆地 GeoJSON 简化为紧凑海岸线 JSON
# 用法:powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make_land.ps1 [-Scale 50] [-Pts 110]
#   -Scale 110(默认)→ land_110m.json;50 → land_50m.json;-Pts 每环取样点数
param(
  [int]$Scale = 110,
  [int]$Pts = 38,
  [int]$Dec = 1
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$raw = Join-Path $root ("data\raw\ne_" + $Scale + "m_land.geojson")
$out = Join-Path $root ("data\processed\land_" + $Scale + "m.json")
$gj = Get-Content $raw -Raw -Encoding UTF8 | ConvertFrom-Json

$rings = New-Object System.Collections.Generic.List[object]
foreach ($f in $gj.features) {
  $geom = $f.geometry
  # Polygon.coordinates = 环的列表;MultiPolygon.coordinates = 多边形的列表(每个再含环)
  $ringLists = $null
  if ($geom.type -eq "Polygon") { $ringLists = @($geom.coordinates) }
  elseif ($geom.type -eq "MultiPolygon") {
    $ringLists = New-Object System.Collections.Generic.List[object]
    foreach ($poly in $geom.coordinates) { foreach ($r in @($poly)) { [void]$ringLists.Add($r) } }
  }
  if (-not $ringLists) { continue }
  foreach ($ring in $ringLists) {
      $n = @($ring).Count
      if ($n -lt 4) { continue }
      $step = [Math]::Max(1, [int][Math]::Round($n / [double]$Pts))
      $rp = New-Object System.Collections.Generic.List[object]
      for ($i = 0; $i -lt $n; $i += $step) {
        $p = $ring[$i]
        $x = [Math]::Round([double]$p[0], $Dec)
        $y = [Math]::Round([double]$p[1], $Dec)
        if ($rp.Count -gt 0) {
          $last = $rp[$rp.Count - 1]
          if ($last[0] -eq $x -and $last[1] -eq $y) { continue }
        }
        [void]$rp.Add(@($x, $y))
      }
      if ($rp.Count -ge 4) { [void]$rings.Add($rp) }
  }
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('[')
$firstRing = $true
foreach ($r in $rings) {
  if (-not $firstRing) { [void]$sb.Append(',') }
  $firstRing = $false
  [void]$sb.Append('[')
  [void]$sb.Append((($r | ForEach-Object { '[' + $_[0] + ',' + $_[1] + ']' }) -join ','))
  [void]$sb.Append(']')
}
[void]$sb.Append(']')
[IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ((Split-Path -Leaf $out) + ": " + (Get-Item $out).Length + " bytes, rings: " + $rings.Count)
