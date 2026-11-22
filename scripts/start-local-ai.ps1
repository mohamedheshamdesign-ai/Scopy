[CmdletBinding()]
param(
    [ValidateSet(4096, 8192, 16384)]
    [int]$ContextSize = 8192,

    [ValidateSet("none", "ngram-simple", "ngram-cache")]
    [string]$SpeculativeMode = "none",

    [ValidateRange(512, 2048)]
    [int]$GpuMemoryReserveMiB = 1024
)

$ErrorActionPreference = "Stop"
$ScopyRoot = "E:\Scopy"
$ServerExe = Join-Path $ScopyRoot "runtime\llama.cpp\llama-server.exe"
$CacheRoot = Join-Path $ScopyRoot "cache\huggingface\hub"
$HFHome = Join-Path $ScopyRoot "cache\huggingface"
$TempRoot = Join-Path $ScopyRoot "temp"
$ModelFileName = "Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf"

if (-not (Test-Path -LiteralPath $ServerExe)) {
    throw "llama-server.exe was not found at $ServerExe"
}
if (-not (Test-Path -LiteralPath $CacheRoot)) {
    throw "The expected Hugging Face cache is missing: $CacheRoot. Refusing to download the model again."
}

$Model = Get-ChildItem -LiteralPath $CacheRoot -Filter $ModelFileName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $Model) {
    throw "The existing model file was not found under $CacheRoot. Run scripts\inspect-local-ai.ps1; no download was started."
}
if ($Model.Length -lt 15GB) {
    throw "The cached GGUF is unexpectedly small ($([math]::Round($Model.Length / 1GB, 2)) GiB). Refusing to start it."
}

$SystemMemory = Get-CimInstance Win32_OperatingSystem
$FreeRamGiB = [math]::Round($SystemMemory.FreePhysicalMemory / 1MB, 2)
Write-Host "Free physical RAM before model load: $FreeRamGiB GiB"
if ($FreeRamGiB -lt 6) {
    throw "Only $FreeRamGiB GiB RAM is free. Close memory-heavy applications and retry; the model will not be loaded."
}

$DeviceOutput = (& $ServerExe --list-devices 2>&1 | Out-String)
$NvidiaDeviceMatch = [regex]::Match($DeviceOutput, "Vulkan0:.*?\((\d+)\s+MiB,\s*(\d+)\s+MiB free\)")
if (-not $NvidiaDeviceMatch.Success) {
    throw "Could not verify free VRAM for Vulkan0. Device output: $DeviceOutput"
}
$TotalVramMiB = [int]$NvidiaDeviceMatch.Groups[1].Value
$FreeVramMiB = [int]$NvidiaDeviceMatch.Groups[2].Value
Write-Host "Vulkan0 VRAM: $FreeVramMiB MiB free of $TotalVramMiB MiB"
if ($FreeVramMiB -lt 2048) {
    throw "Only $FreeVramMiB MiB VRAM is free. Close GPU-heavy applications and retry; the model will not be loaded."
}

$Listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($Listener) {
    $OwnerIds = @($Listener | Select-Object -ExpandProperty OwningProcess -Unique)
    throw "Port 8080 is already listening (PID(s): $($OwnerIds -join ', ')). Stop the existing server with Ctrl+C before starting another."
}

foreach ($Directory in @($HFHome, $CacheRoot, $TempRoot, (Join-Path $ScopyRoot "logs"))) {
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
}

# Keep model downloads, runtime cache, temporary files, and Scopy data on E:.
$env:SCOPY_HOME = $ScopyRoot
$env:SCOPY_LOCAL_AI_URL = "http://127.0.0.1:8080/v1"
$env:SCOPY_LOCAL_AI_CONTEXT_TOKENS = "$ContextSize"
$env:LLAMA_CACHE = $CacheRoot
$env:HF_HOME = $HFHome
$env:HF_HUB_CACHE = $CacheRoot
$env:HUGGINGFACE_HUB_CACHE = $CacheRoot
$env:OLLAMA_MODELS = Join-Path $ScopyRoot "models\ollama"
$env:TMP = $TempRoot
$env:TEMP = $TempRoot

# Persist only path/config values; no API keys or secrets are written.
[Environment]::SetEnvironmentVariable("SCOPY_HOME", $ScopyRoot, "User")
[Environment]::SetEnvironmentVariable("SCOPY_LOCAL_AI_URL", $env:SCOPY_LOCAL_AI_URL, "User")
[Environment]::SetEnvironmentVariable("SCOPY_LOCAL_AI_CONTEXT_TOKENS", $env:SCOPY_LOCAL_AI_CONTEXT_TOKENS, "User")
[Environment]::SetEnvironmentVariable("LLAMA_CACHE", $CacheRoot, "User")
[Environment]::SetEnvironmentVariable("HF_HOME", $HFHome, "User")
[Environment]::SetEnvironmentVariable("HF_HUB_CACHE", $CacheRoot, "User")
[Environment]::SetEnvironmentVariable("HUGGINGFACE_HUB_CACHE", $CacheRoot, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS", $env:OLLAMA_MODELS, "User")

$ServerArgs = @(
    "-m", $Model.FullName,
    "--host", "127.0.0.1",
    "--port", "8080",
    "-c", "$ContextSize",
    "-np", "1",
    "--device", "Vulkan0",
    "--fit", "on",
    "--fit-target", "$GpuMemoryReserveMiB"
)

$HelpText = (& $ServerExe --help 2>&1 | Out-String)
if ($HelpText -match "--metrics") {
    $ServerArgs += "--metrics"
}
if ($SpeculativeMode -ne "none") {
    if ($HelpText -notmatch "--spec-type") {
        throw "This llama.cpp build does not expose --spec-type. Keep speculative decoding disabled."
    }
    $ServerArgs += @("--spec-type", $SpeculativeMode)
}

Write-Host ""
Write-Host "Scopy local AI launch profile" -ForegroundColor Cyan
Write-Host "Model:       $($Model.FullName)"
Write-Host "Model size:  $([math]::Round($Model.Length / 1GB, 2)) GiB"
Write-Host "Runtime:     $ServerExe"
Write-Host "Endpoint:    $env:SCOPY_LOCAL_AI_URL"
Write-Host "Context:     $ContextSize"
Write-Host "Sequences:   1"
Write-Host "GPU device:  Vulkan0 (GTX 1660 Ti)"
Write-Host "GPU reserve: $GpuMemoryReserveMiB MiB"
Write-Host "Speculative: $SpeculativeMode"
Write-Host "Flash Attention: auto (backend decides; do not force it on for this Vulkan build)"
Write-Host "KV cache:    default F16 (quantized V cache is not enabled without a supported Flash Attention path)"
Write-Host ""
Write-Host "Starting server. Keep this window open; press Ctrl+C to stop it." -ForegroundColor Yellow

& $ServerExe @ServerArgs
