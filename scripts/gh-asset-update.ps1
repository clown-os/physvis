# Replace the web zip asset on the v1.0.0 release (delete old, upload new)
param(
  [string]$Repo = "clown-os/physvis",
  [string]$Tag = "v1.0.0",
  [string]$Asset = "physvis-web-v1.0.0.zip"
)
$token = $env:PT_TOKEN
if (-not $token) { Write-Error "PT_TOKEN not set"; exit 1 }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ Authorization = "token $token"; "User-Agent" = "physvis-release" }
$base = "https://api.github.com/repos/$Repo"
$path = Join-Path "C:\Users\hx\physvis\release" $Asset

$rel = Invoke-RestMethod -Uri "$base/releases/tags/$Tag" -Headers $headers -TimeoutSec 30
$old = $rel.assets | Where-Object { $_.name -eq $Asset }
if ($old) {
  Invoke-RestMethod -Method Delete -Uri "$base/releases/assets/$($old.id)" -Headers $headers -TimeoutSec 30 | Out-Null
  Write-Output ("deleted old asset id=" + $old.id)
}
$uploadBase = ($rel.upload_url -replace '\{[^}]*\}', '')
$asset = Invoke-RestMethod -Method Post -Uri "$uploadBase`?name=$Asset" -Headers $headers -ContentType "application/zip" -InFile $path -TimeoutSec 120
Write-Output ("uploaded new: " + $asset.name + " (" + $asset.size + " bytes) updated_at=" + $asset.updated_at)
