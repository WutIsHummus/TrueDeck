# Ensure MemPalace is ready WITHOUT Docker.
# Uses native mempalace-mcp from %USERPROFILE%\.local\bin

$ErrorActionPreference = "Stop"
$LocalBin = Join-Path $env:USERPROFILE ".local\bin"
$Mcp = Join-Path $LocalBin "mempalace-mcp.exe"
$Cli = Join-Path $LocalBin "mempalace.exe"
$Palace = Join-Path $env:USERPROFILE ".mempalace\palace"

function Write-Ok($m) { Write-Host "[ok] $m" -ForegroundColor Green }
function Write-Info($m) { Write-Host "[..] $m" -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host "[!!] $m" -ForegroundColor Yellow }

if (-not (Test-Path $Cli) -and -not (Test-Path $Mcp)) {
  Write-Warn "MemPalace not installed natively."
  Write-Info "Installing with uv tool install mempalace ..."
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if (-not $uv) {
    Write-Warn "uv not found. Install from https://docs.astral.sh/uv/ then re-run."
    Write-Info "Or: pipx install mempalace"
    exit 1
  }
  & uv tool install mempalace
}

if (-not (Test-Path $Palace)) {
  Write-Info "Creating palace at $Palace"
  New-Item -ItemType Directory -Force -Path $Palace | Out-Null
}

if (Test-Path $Cli) {
  Write-Info "mempalace status"
  & $Cli --palace $Palace status 2>$null
  Write-Ok "CLI ready: $Cli"
}

if (Test-Path $Mcp) {
  Write-Ok "MCP ready (native, no Docker): $Mcp"
  Write-Info "Cursor/Grok should use:"
  Write-Host @"
  command: $Mcp
  args:    --palace $Palace
"@
} else {
  Write-Warn "mempalace-mcp.exe not found after install"
  exit 1
}

Write-Ok "Done. You do not need to open Docker for MemPalace."
