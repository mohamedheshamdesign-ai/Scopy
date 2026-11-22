[CmdletBinding()]
param(
    [string]$ModelId
)

$ErrorActionPreference = "Stop"
$ScopyRoot = "E:\Scopy"
$BaseUrl = "http://127.0.0.1:8080/v1"
$TempRoot = Join-Path $ScopyRoot "temp"

if (-not (Test-Path (Join-Path $ScopyRoot "package.json"))) {
    throw "Scopy project was not found at $ScopyRoot"
}

New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

$ModelsResponse = Invoke-RestMethod -Uri ($BaseUrl + "/models") -TimeoutSec 10
$AvailableModels = @($ModelsResponse.data | ForEach-Object { $_.id } | Where-Object { $_ })

if (-not $AvailableModels -or $AvailableModels.Count -eq 0) {
    throw "The local server did not return any model IDs from $BaseUrl/models"
}

if (-not $ModelId) {
    if ($AvailableModels.Count -ne 1) {
        Write-Host "More than one model is loaded. Re-run with -ModelId and choose one of:" -ForegroundColor Yellow
        $AvailableModels | ForEach-Object { Write-Host "  $_" }
        throw "A model ID must be selected explicitly."
    }
    $ModelId = $AvailableModels[0]
}

if ($AvailableModels -notcontains $ModelId) {
    Write-Host "Available model IDs:" -ForegroundColor Yellow
    $AvailableModels | ForEach-Object { Write-Host "  $_" }
    throw "Model ID is not currently served: $ModelId"
}

$ContextTokens = [Environment]::GetEnvironmentVariable("SCOPY_LOCAL_AI_CONTEXT_TOKENS", "User")
if (-not $ContextTokens) {
    $ContextTokens = "8192"
}

$env:SCOPY_HOME = $ScopyRoot
$env:SCOPY_LOCAL_AI_URL = $BaseUrl
$env:SCOPY_LOCAL_AI_MODEL = $ModelId
$env:SCOPY_LOCAL_AI_CONTEXT_TOKENS = $ContextTokens
$env:TMP = $TempRoot
$env:TEMP = $TempRoot

[Environment]::SetEnvironmentVariable("SCOPY_HOME", $ScopyRoot, "User")
[Environment]::SetEnvironmentVariable("SCOPY_LOCAL_AI_URL", $BaseUrl, "User")
[Environment]::SetEnvironmentVariable("SCOPY_LOCAL_AI_MODEL", $ModelId, "User")
[Environment]::SetEnvironmentVariable("SCOPY_LOCAL_AI_CONTEXT_TOKENS", $ContextTokens, "User")

Write-Host ""
Write-Host "Scopy is connected to the local model." -ForegroundColor Green
Write-Host "Model:    $ModelId"
Write-Host "Endpoint: $BaseUrl"
Write-Host "Context:  $ContextTokens"
Write-Host "Data:     $ScopyRoot\data"
Write-Host "Temporary files for this shell: $TempRoot"
Write-Host ""
Write-Host "Run: npm run dev -- ai health"
