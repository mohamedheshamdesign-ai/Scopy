[CmdletBinding()]
param(
    [switch]$SkipHash
)

$ErrorActionPreference = "Stop"
$ScopyRoot = "E:\Scopy"
$CacheRoot = Join-Path $ScopyRoot "cache\huggingface\hub"
$ModelFileName = "Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf"
$ExpectedSha256 = "f6050b4da22869aa3fb9d94bb3314e9fc5a027d4741c1f97761c387d6b2b2335"
$BaseUrl = "http://127.0.0.1:8080"
$ApiKeyFile = Join-Path $ScopyRoot "secrets\local-ai-api-keys.txt"
$Headers = @{}
if (Test-Path -LiteralPath $ApiKeyFile) {
    $ApiKey = (Get-Content -LiteralPath $ApiKeyFile -Raw).Trim()
    if ($ApiKey) { $Headers["Authorization"] = "Bearer " + $ApiKey }
}

Write-Host ""
Write-Host "=== Scopy local AI diagnostics ===" -ForegroundColor Cyan
Write-Host "Scopy root: $ScopyRoot"
Write-Host "HF cache:   $CacheRoot"

if (-not (Test-Path $ScopyRoot)) {
    throw "Scopy root does not exist: $ScopyRoot"
}

Write-Host ""
Write-Host "[Storage]" -ForegroundColor Cyan
Get-PSDrive -Name E | Select-Object Name, @{N="FreeGB";E={[math]::Round($_.Free / 1GB, 2)}}, @{N="UsedGB";E={[math]::Round($_.Used / 1GB, 2)}} | Format-Table -AutoSize

Write-Host "[System memory]" -ForegroundColor Cyan
Get-CimInstance Win32_OperatingSystem | Select-Object @{N="FreeRAM_GB";E={[math]::Round($_.FreePhysicalMemory / 1MB, 2)}}, @{N="TotalRAM_GB";E={[math]::Round($_.TotalVisibleMemorySize / 1MB, 2)}} | Format-Table -AutoSize

Write-Host "[Model file]" -ForegroundColor Cyan
$Model = Get-ChildItem -LiteralPath $CacheRoot -Filter $ModelFileName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $Model) {
    Write-Warning "The expected GGUF filename was not found under $CacheRoot."
    Write-Host "Search the cache manually before downloading anything again."
} else {
    $SizeGB = [math]::Round($Model.Length / 1GB, 3)
    Write-Host "Path:   $($Model.FullName)"
    Write-Host "Size:   $SizeGB GiB"
    if ($Model.Length -lt 15GB) {
        Write-Warning "File is smaller than expected; treat the download as incomplete."
    } elseif ($SkipHash) {
        Write-Host "SHA256: skipped by request"
    } else {
        Write-Host "Computing SHA256 (this reads the full ~18 GB file)..." -ForegroundColor Yellow
        $ActualSha256 = (Get-FileHash -LiteralPath $Model.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Host "Expected: $ExpectedSha256"
        Write-Host "Actual:   $ActualSha256"
        if ($ActualSha256 -eq $ExpectedSha256) {
            Write-Host "Integrity: PASS" -ForegroundColor Green
        } else {
            Write-Warning "Integrity: MISMATCH. Do not delete or replace the file; preserve it for diagnosis."
        }
    }
}

Write-Host ""
Write-Host "[llama-server process]" -ForegroundColor Cyan
$ServerProcesses = Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" -ErrorAction SilentlyContinue
if (-not $ServerProcesses) {
    Write-Host "No llama-server.exe process is running."
} else {
    foreach ($ServerProcess in $ServerProcesses) {
        $ProcessInfo = Get-Process -Id $ServerProcess.ProcessId -ErrorAction SilentlyContinue
        [pscustomobject]@{
            PID = $ServerProcess.ProcessId
            Executable = $ServerProcess.ExecutablePath
            WorkingSetGB = if ($ProcessInfo) { [math]::Round($ProcessInfo.WorkingSet64 / 1GB, 2) } else { $null }
            PrivateGB = if ($ProcessInfo) { [math]::Round($ProcessInfo.PrivateMemorySize64 / 1GB, 2) } else { $null }
            CommandLine = $ServerProcess.CommandLine
        } | Format-List
    }
}

Write-Host "[NVIDIA GPU]" -ForegroundColor Cyan
$NvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if ($NvidiaSmi) {
    & $NvidiaSmi.Source --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv
} else {
    Write-Host "nvidia-smi is not available on PATH; use Task Manager > Performance > GPU for live VRAM."
}

Write-Host ""
Write-Host "[Local OpenAI-compatible API]" -ForegroundColor Cyan
try {
    $ModelsResponse = Invoke-RestMethod -Uri "$BaseUrl/v1/models" -Headers $Headers -TimeoutSec 8
    $ModelsResponse.data | Select-Object id, object, owned_by | Format-Table -AutoSize
} catch {
    Write-Warning "Local API is not reachable at $BaseUrl : $($_.Exception.Message)"
}

try {
    $MetricsResponse = Invoke-WebRequest -Uri "$BaseUrl/metrics" -Headers $Headers -TimeoutSec 5
    Write-Host "Metrics endpoint: HTTP $($MetricsResponse.StatusCode)"
    $MetricsResponse.Content -split '\r?\n' | Where-Object { $_ -match "predicted_tokens_seconds|prompt_tokens_seconds|spec_decode_num_accepted_tokens" } | Select-Object -First 12
} catch {
    Write-Host "Metrics endpoint is disabled or unavailable (optional)."
}

Write-Host ""
Write-Host "Diagnostics complete. No files were deleted or modified." -ForegroundColor Green
