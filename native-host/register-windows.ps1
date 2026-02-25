# register-windows.ps1
#
# Run this ONCE (no admin required) to register the SecurePass native
# messaging host with Chrome and Firefox on Windows.
#
# Usage (from the native-host\ directory):
#   powershell -ExecutionPolicy Bypass -File register-windows.ps1
#
# To unregister:
#   powershell -ExecutionPolicy Bypass -File register-windows.ps1 -Unregister

param([switch]$Unregister)

$hostName    = "com.securepass.bridge"
$hostDir     = Split-Path -Parent $MyInvocation.MyCommand.Definition
$batPath     = Join-Path $hostDir "run-host.bat"
$jsonPath    = Join-Path $hostDir "$hostName.json"

# ── Read extension ID from manifest so we don't have to hard-code it ──────────
$extManifest = Join-Path $hostDir "..\extension\manifest.json"
if (Test-Path $extManifest) {
  $extJson = Get-Content $extManifest -Raw | ConvertFrom-Json
  $chromeId = $extJson.key   # will be empty for unpacked — that's fine
}

# ── Registry keys ─────────────────────────────────────────────────────────────
$chromeKey  = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$firefoxKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"

if ($Unregister) {
  Remove-Item -Path $chromeKey  -ErrorAction SilentlyContinue
  Remove-Item -Path $firefoxKey -ErrorAction SilentlyContinue
  Write-Host "Unregistered $hostName"
  exit 0
}

# ── Write the manifest JSON with the correct absolute path ────────────────────
$manifestObj = [ordered]@{
  name              = $hostName
  description       = "SecurePass NFC Password Manager bridge"
  path              = $batPath
  type              = "stdio"
  # Replace EXTENSION_ID below after loading the extension in Chrome.
  # Get it from chrome://extensions while Developer Mode is on.
  allowed_origins   = @("chrome-extension://EXTENSION_ID/")
}
$manifestObj | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $jsonPath
Write-Host "Wrote $jsonPath"

# ── Register for Chrome ───────────────────────────────────────────────────────
New-Item -Path $chromeKey -Force | Out-Null
Set-ItemProperty -Path $chromeKey -Name "(default)" -Value $jsonPath
Write-Host "Chrome registered OK"

# Register for Firefox - needs its own JSON with allowed_extensions instead
$ffManifest = [ordered]@{
  name               = $hostName
  description        = "SecurePass NFC Password Manager bridge"
  path               = $batPath
  type               = "stdio"
  allowed_extensions = @("securepass@localhost")
}
$ffJsonPath = Join-Path $hostDir "$hostName.firefox.json"
$ffManifest | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $ffJsonPath

New-Item -Path $firefoxKey -Force | Out-Null
Set-ItemProperty -Path $firefoxKey -Name "(default)" -Value $ffJsonPath
Write-Host "Firefox registered OK"

Write-Host ""
Write-Host "Done. Next steps:"
Write-Host "  1. Load extension/  as an unpacked extension in Chrome"
Write-Host "  2. Copy the Extension ID from chrome://extensions"
Write-Host "  3. Re-run this script (it will update allowed_origins in the JSON)"
Write-Host "     OR manually edit $jsonPath and replace EXTENSION_ID"
