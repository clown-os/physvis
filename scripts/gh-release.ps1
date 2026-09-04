# Create v1.0.0 release and upload the two zips as assets
param(
  [string]$Repo = "clown-os/physvis",
  [string]$Tag = "v1.0.0",
  [string]$ZipDir = "C:\Users\hx\physvis\release"
)
$token = $env:PT_TOKEN
if (-not $token) { Write-Error "PT_TOKEN not set"; exit 1 }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ Authorization = "token $token"; "User-Agent" = "physvis-release" }
$base = "https://api.github.com/repos/$Repo"

# 1) Create the release.
# Note: Get-Content -Raw decorates the string with ETS properties (PSPath etc.),
# so ConvertTo-Json would serialize an object instead of a string -> HTTP 422.
# Use .NET File.ReadAllText to get a plain string.
$bodyFile = Join-Path $PSScriptRoot "gh-release-body.md"
$notes = [System.IO.File]::ReadAllText($bodyFile, [System.Text.Encoding]::UTF8)
$payload = @{ tag_name = $Tag; name = "PhysVis $Tag"; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json

try {
  # PS 5.1 sends string bodies as non-UTF8; convert to UTF-8 bytes explicitly
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $rel = Invoke-RestMethod -Method Post -Uri "$base/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 30
  Write-Output ("RELEASE created: " + $rel.html_url)
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    Write-Output ("RELEASE fail HTTP " + [int]$resp.StatusCode + ": " + $reader.ReadToEnd())
  } else { Write-Output ("RELEASE fail: " + $_.Exception.Message) }
  exit 1
}

# 2) Upload assets (upload_url has {?name,label} suffix to strip)
$uploadBase = ($rel.upload_url -replace '\{[^}]*\}', '')
$files = @("physvis-web-v1.0.0.zip", "physvis-src-v1.0.0.zip")
foreach ($f in $files) {
  $path = Join-Path $ZipDir $f
  if (-not (Test-Path $path)) { Write-Output ("SKIP missing: " + $f); continue }
  $uri = "$uploadBase`?name=$f"
  try {
    $asset = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType "application/zip" -InFile $path -TimeoutSec 120
    Write-Output ("ASSET uploaded: " + $asset.name + " (" + $asset.size + " bytes)")
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      Write-Output ("ASSET fail " + $f + " HTTP " + [int]$resp.StatusCode + ": " + $reader.ReadToEnd())
    } else { Write-Output ("ASSET fail " + $f + ": " + $_.Exception.Message) }
  }
}
