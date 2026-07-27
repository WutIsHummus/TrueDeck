# One-shot: switch Cursor + Grok MCP configs from Docker → native mempalace-mcp
# Safe: backs up existing configs first.

$ErrorActionPreference = "Stop"
$McpExe = Join-Path $env:USERPROFILE ".local\bin\mempalace-mcp.exe"
$Palace = Join-Path $env:USERPROFILE ".mempalace\palace"
$CursorMcp = Join-Path $env:USERPROFILE ".cursor\mcp.json"
$GrokToml = Join-Path $env:USERPROFILE ".grok\config.toml"

if (-not (Test-Path $McpExe)) {
  Write-Host "Installing mempalace via uv..." -ForegroundColor Cyan
  uv tool install mempalace
}

if (-not (Test-Path $McpExe)) {
  throw "mempalace-mcp.exe still missing at $McpExe"
}

# Cursor
if (Test-Path $CursorMcp) {
  $bak = "$CursorMcp.bak.docker-$(Get-Date -Format yyyyMMddHHmmss)"
  Copy-Item $CursorMcp $bak -Force
  Write-Host "Backed up Cursor MCP → $bak" -ForegroundColor DarkGray
  $json = Get-Content $CursorMcp -Raw | ConvertFrom-Json
  if (-not $json.mcpServers) { $json | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }
  $json.mcpServers | Add-Member -NotePropertyName mempalace -NotePropertyValue ([pscustomobject]@{
    command = $McpExe
    args    = @("--palace", $Palace)
  }) -Force
  $json | ConvertTo-Json -Depth 20 | Set-Content $CursorMcp -Encoding UTF8
  Write-Host "Updated Cursor mcp.json → native mempalace-mcp" -ForegroundColor Green
}

# Grok
if (Test-Path $GrokToml) {
  $bak = "$GrokToml.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  Copy-Item $GrokToml $bak -Force
  $text = Get-Content $GrokToml -Raw
  if ($text -notmatch '\[mcp_servers\.mempalace\]') {
    $block = @"

# MemPalace — native (no Docker)
[mcp_servers.mempalace]
command = "$($McpExe -replace '\\','\\')"
args = ["--palace", "$($Palace -replace '\\','\\')"]
enabled = true
startup_timeout_sec = 60
"@
    # Fix path escaping for TOML strings - use forward-friendly single-escaped backslashes
    $cmdEsc = $McpExe -replace '\\', '\\'
    $palEsc = $Palace -replace '\\', '\\'
    $block = @"

# MemPalace — native (no Docker)
[mcp_servers.mempalace]
command = "$cmdEsc"
args = ["--palace", "$palEsc"]
enabled = true
startup_timeout_sec = 60
"@
    Add-Content -Path $GrokToml -Value $block
    Write-Host "Appended MemPalace to Grok config.toml" -ForegroundColor Green
  } else {
    Write-Host "Grok already has mcp_servers.mempalace" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Restart Cursor / Grok Build so MCP reloads." -ForegroundColor Cyan
Write-Host "Docker Desktop is no longer required for MemPalace." -ForegroundColor Green
