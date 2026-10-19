# Builds and puts `am` on the user's PATH on Windows: a small am.cmd in
# %USERPROFILE%\.local\bin (where Claude Code's installer also lives, and
# what the daemon's task puts first on its PATH) that runs dist\main.js from
# this checkout. Re-run after a pull; a `npm run build` here changes the
# installed command at once.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Bin  = Join-Path $env:USERPROFILE '.local\bin'
$Node = (Get-Command node).Source
Push-Location $Root
try { npm run build | Out-Null; if ($LASTEXITCODE) { throw "npm run build failed ($LASTEXITCODE)" } } finally { Pop-Location }
New-Item -ItemType Directory -Force $Bin | Out-Null
@('@echo off', 'set ELECTRON_RUN_AS_NODE=', "`"$Node`" `"$Root\dist\main.js`" %*") | Set-Content -Path (Join-Path $Bin 'am.cmd') -Encoding ASCII
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($p -notlike "*\.local\bin*") { [Environment]::SetEnvironmentVariable('Path', "$Bin;$p", 'User'); Write-Host "added $Bin to the user PATH (new shells see it)" }
Write-Host "installed $Bin\am.cmd -> $Root\dist\main.js"
