[CmdletBinding()]
param(
    [string]$HomePath = "",
    [switch]$PersistUserEnvironment
)
$ErrorActionPreference = "Stop"
function Invoke-Checked {
    param([Parameter(Mandatory = $true)][string]$Executable,[Parameter(Mandatory = $true)][string[]]$Arguments)
    Write-Host ("> {0} {1}" -f $Executable, ($Arguments -join " ")) -ForegroundColor Cyan
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw ("Command failed ({0}): {1} {2}" -f $LASTEXITCODE, $Executable, ($Arguments -join " ")) }
}
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "package.json"))) { throw "Scopy package.json was not found. Extract the complete Scopy archive and run this script from its scripts folder." }
if ([string]::IsNullOrWhiteSpace($HomePath)) { $HomePath = $repoRoot }
$resolvedHome = [System.IO.Path]::GetFullPath($HomePath)
$nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
$npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) { throw "Node.js 24+ and npm are required. Install Node.js 24 or newer, reopen PowerShell, and retry." }
$nodeVersion = (& $nodeCommand.Source --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch "^v?(\d+)\.") { throw "Could not determine the installed Node.js version." }
if ([int]$Matches[1] -lt 24) { throw "Scopy requires Node.js 24 or newer. Detected: $nodeVersion" }
$env:SCOPY_HOME = $resolvedHome
$env:SCOPY_WORKSPACE_DIR = "workspace"
$env:SCOPY_SAFETY_PROFILE = "strict"
if ($PersistUserEnvironment) {
    [Environment]::SetEnvironmentVariable("SCOPY_HOME", $resolvedHome, "User")
    [Environment]::SetEnvironmentVariable("SCOPY_WORKSPACE_DIR", "workspace", "User")
    [Environment]::SetEnvironmentVariable("SCOPY_SAFETY_PROFILE", "strict", "User")
    Write-Host "Scopy paths and strict safety profile saved to the current Windows user environment." -ForegroundColor Yellow
}
Push-Location $repoRoot
try {
    Write-Host "Installing Scopy dependencies..." -ForegroundColor Cyan
    Invoke-Checked -Executable $npmCommand.Source -Arguments @("install", "--no-audit", "--no-fund")
    Write-Host "Running typecheck, build, and tests..." -ForegroundColor Cyan
    Invoke-Checked -Executable $npmCommand.Source -Arguments @("run", "check")
    Write-Host "Initializing the local Scopy database..." -ForegroundColor Cyan
    Invoke-Checked -Executable $npmCommand.Source -Arguments @("run", "dev", "--", "health")
    Write-Host "Checking the local installation..." -ForegroundColor Cyan
    Invoke-Checked -Executable $npmCommand.Source -Arguments @("run", "dev", "--", "doctor")
}
finally { Pop-Location }
Write-Host ""
Write-Host "Scopy local core is installed and verified." -ForegroundColor Green
Write-Host ("Home:      {0}" -f $resolvedHome)
Write-Host ("Workspace: {0}" -f (Join-Path $resolvedHome "workspace"))
Write-Host "Safety:    strict (default deny)"
Write-Host ""
Write-Host "Next: configure your local llama.cpp server with scripts\connect-local-ai.ps1 after starting the server."
Write-Host 'Run Scopy with: npm run dev -- ai chat "Hello Scopy"'
