[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Invoke-CheckedNativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host ("> {0} {1}" -f $Executable, ($Arguments -join " ")) -ForegroundColor Cyan
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ("Command failed with exit code {0}: {1} {2}" -f $LASTEXITCODE, $Executable, ($Arguments -join " "))
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $PWD "package.json"))) {
    throw "Run this script from the Scopy repository root."
}

$nodeVersion = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch "^v?(\d+)\.") {
    throw "Node.js could not be detected. Install Node.js 24 or newer."
}

$nodeMajor = [int]$Matches[1]
if ($nodeMajor -lt 24) {
    throw "Scopy requires Node.js 24 or newer. Detected: $nodeVersion"
}

Write-Host "Detected Node.js $nodeVersion" -ForegroundColor Green

if (-not $SkipInstall) {
    Invoke-CheckedNativeCommand -Executable "npm" -Arguments @("install", "--no-audit", "--no-fund")
}

Invoke-CheckedNativeCommand -Executable "npm" -Arguments @("run", "check")
Invoke-CheckedNativeCommand -Executable "npm" -Arguments @("run", "dev", "--", "doctor")

Write-Host "Scopy verification completed successfully." -ForegroundColor Green
if (-not $env:SCOPY_LOCAL_AI_MODEL) {
    Write-Host "Local AI health was not checked because SCOPY_LOCAL_AI_MODEL is not configured in this PowerShell session." -ForegroundColor Yellow
}
