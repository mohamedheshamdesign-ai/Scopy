# Scopy Local AI Runtime — Windows

**Target machine:** Windows 11, Intel i7-10750H, 32 GB RAM, NVIDIA GTX 1660 Ti 6 GB  
**Runtime:** llama.cpp Vulkan build b12602  
**Model:** ggml-org/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M  
**Storage root:** E:\Scopy

## Current verified state

The user reported the following successful runtime log:

- llama-server.exe --version returned build 12602, commit 418fe97b5.
- --list-devices detected Vulkan0: NVIDIA GeForce GTX 1660 Ti and Vulkan1: Intel UHD Graphics.
- The server loaded the Qwen3-Coder 30B A3B Q4_K_M model and listened on http://127.0.0.1:8080.
- The user verified the model SHA-256 against the expected publisher hash; the values matched.
- Scopy's `ai models` and `ai health` commands succeeded against the authenticated local server.
- A chat request was aborted at the provider's original 120-second request timeout while the model was still generating.

## Storage layout

All controllable Scopy data and runtime assets belong under E:\Scopy:

- runtime\llama.cpp — llama.cpp binaries and DLLs.
- cache\huggingface\hub — Hugging Face / llama.cpp model cache.
- models — manually managed model files and future local runtimes.
- data\scopy.sqlite — Scopy database.
- workspace — agent workspace.
- logs and temp — runtime logs and temporary files.

llama.cpp resolves its Hugging Face cache using LLAMA_CACHE, HF_HUB_CACHE, HUGGINGFACE_HUB_CACHE, HF_HOME\hub, then fallback paths. The launcher sets the first four to the E: cache directory so the runtime does not silently use the default user profile cache on C:.

Windows and installed driver components may still place system-owned files on C:. Scopy does not attempt to relocate Windows components.

## 1. Inspect model integrity and resource use

From E:\Scopy:

~~~
powershell -ExecutionPolicy Bypass -File .\scripts\inspect-local-ai.ps1
~~~

The script:
- Finds the exact Q4_K_M GGUF in the E: Hugging Face cache.
- Computes SHA-256 and compares it with the publisher's file hash.
- Reports free disk and RAM.
- Reports the llama-server process path and working set/private bytes.
- Queries nvidia-smi if it is installed.
- Checks /v1/models and /metrics when the server is running.

The expected SHA-256 published for the 18 GB GGUF is:

f6050b4da22869aa3fb9d94bb3314e9fc5a027d4741c1f97761c387d6b2b2335

Hashing the full model reads approximately 18 GB and may take several minutes. The script does not delete or modify the model.

If the model is not found under E:\Scopy\cache\huggingface\hub, do not download it again yet. Inspect the existing cache tree and preserve all files for diagnosis.

## 2. Start the conservative single-user profile

Stop the currently running server with Ctrl+C first. Then run:

~~~
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-ai.ps1
~~~

Default profile:
- Context: 8192 tokens.
- Parallel sequences: 1.
- Device: Vulkan0 only; the Intel iGPU is not used for model offload.
- GPU placement: llama.cpp automatic fit; -ngl 12 is intentionally not pinned.
- GPU reserve: 1024 MiB.
- Flash Attention: automatic backend selection; it is not forced on.
- KV cache: default F16.
- Speculative decoding: off for baseline.

The launcher refuses to start if the expected cached GGUF is missing, free RAM is below 6 GiB, free Vulkan0 VRAM is below 2048 MiB, required flags are unavailable, or port 8080 is already occupied. It uses the local GGUF path, not a Hugging Face download URL. It creates an API key file under E:\Scopy\secrets, restricts its Windows ACL to the current user, SYSTEM, and Administrators, and passes it with --api-key-file (not on the command line). The key file is plaintext protected by NTFS permissions, not encrypted at rest; keep the E: volume and Windows account protected. It persists only path and non-secret configuration values in the Windows user environment; the key is loaded into the CLI shell only by the connection script.

The context can be tested at 4096, 8192, then 16384 only if RAM and VRAM remain healthy:

~~~
.\scripts\start-local-ai.ps1 -ContextSize 4096
.\scripts\start-local-ai.ps1 -ContextSize 8192
.\scripts\start-local-ai.ps1 -ContextSize 16384
~~~

Do not assume the model's advertised 262K context is practical on this 32 GB / 6 GB machine. The runtime context must be measured at the actual workload and memory headroom.

## 3. Discover the exact API model ID

In a second PowerShell window, connect Scopy to the running authenticated server:

~~~
. .\scripts\connect-local-ai.ps1
~~~

The script reads the protected key file, requests the served model IDs with Bearer authentication, selects the model automatically when exactly one model is served, validates the ID, and sets the current PowerShell environment. It persists only non-secret Scopy settings in the user environment. If multiple models are served, pass -ModelId explicitly.

The ai models CLI command also lists available model IDs after the connection script has loaded the key into the current shell. Do not guess the model ID from the Hugging Face repository name.

## 4. Scopy health and real chat

~~~
npm run dev -- ai models
npm run dev -- ai health
npm run dev -- ai chat "Explain the Scopy architecture and list three concrete improvements."
~~~

The local provider's original default generation timeout was 120 seconds. That was too short for the current long architecture prompt: the server reported roughly 35 seconds of prompt processing followed by generation, then the client cancelled the request before receiving the complete response.

The current `dev` branch changes the default local generation timeout to 600,000 ms (10 minutes). It is configurable in the PowerShell session:

~~~
$env:SCOPY_LOCAL_AI_TIMEOUT_MS = "600000"
~~~

Allowed values are integer milliseconds from 1 through 600000. The setting controls chat generation only; model discovery and health checks retain their shorter request limits. The provider remains non-streaming, so the CLI prints the answer only after the complete response has arrived. This timeout is a maximum wait, not a performance target.

Scopy local adapter accepts only HTTP loopback endpoints and sends the local Bearer key from the current PowerShell session. It does not silently fall back to cloud. The router has no cloud provider enabled by default, and cloud egress remains blocked unless a caller explicitly opts in at the router API.

## 5. Benchmark generation speed

Run a warm-up and a measured generation request through the Scopy provider:

~~~
npm run dev -- ai benchmark
npm run dev -- ai benchmark 512
~~~

The CLI reports prompt/completion tokens when the server returns usage metadata, request duration, and client-observed completion tokens/second. This is end-to-end client latency, not a hardware-only kernel benchmark. Repeat the same prompt and output limit after each configuration change.

For server-side telemetry, the launcher enables /metrics when the installed build exposes that option:

~~~
$Headers = @{ Authorization = "Bearer " + $env:SCOPY_LOCAL_AI_API_KEY }
(Invoke-WebRequest "http://127.0.0.1:8080/metrics" -Headers $Headers).Content | Select-String "predicted_tokens_seconds|prompt_tokens_seconds|spec_decode"
~~~

Use Task Manager > Performance > GPU or nvidia-smi to record VRAM, and the diagnostic script to record RAM/process memory.

## 6. Optimization compatibility decisions

### GPU offload

Vulkan detected the GTX 1660 Ti. The previous run pinned -ngl 12, and llama.cpp logged that it could not fit parameters because the GPU layer count was already explicitly set. The baseline launcher leaves GPU layer count unset and lets llama.cpp's fit logic choose placement while preserving a 1024 MiB GPU reserve.

### Flash Attention

The user's actual Vulkan run reported that Flash Attention over K/V rows was unsupported and disabled. Therefore the launcher does not force Flash Attention on. A future llama.cpp build may change backend support; verify from runtime logs and benchmark before changing this.

### KV cache quantization

The baseline remains F16. Quantized V cache commonly requires a compatible Flash Attention path; this Vulkan build did not establish that compatibility. Do not add q8_0/q4_0 KV flags until a controlled test confirms that the selected Vulkan backend supports them without fallback or numerical/runtime errors.

### Speculative decoding

No separate draft model is installed. Do not download a second model just to test speculation. llama.cpp also supports n-gram speculative modes that do not require a draft model. The launcher exposes opt-in A/B modes:

~~~
.\scripts\start-local-ai.ps1 -SpeculativeMode ngram-simple
.\scripts\start-local-ai.ps1 -SpeculativeMode ngram-cache
~~~

Compare each against the baseline using the same prompt and output-token limit. Keep speculation disabled if acceptance is low or throughput does not improve. The script checks that the current binary exposes --spec-type before starting.

## 7. Tools and dependencies

No additional Python runtime, Ollama, vLLM, Docker, or third-party benchmark package is required for this setup. The existing llama.cpp distribution already provides the Vulkan runtime and benchmark executables; PowerShell, Node, the Scopy CLI, and the server API are sufficient for the first measurements.

Do not install CUDA-specific inference stacks for this Vulkan build. The GTX 1660 Ti is being used through Vulkan, not CUDA. Add another backend only after a measured compatibility and performance case.

## 8. Known limits

- The model is a 30B-parameter MoE with roughly 3B active parameters per token; the 18 GB Q4_K_M weights still need to be resident in host memory / mapped storage even though only some experts are active for each token.
- 32 GB RAM with only about 9.37 GB free before the first load is tight. Close memory-heavy applications before starting. Watch for paging and keep the Windows page file system-managed.
- The model's published 262K context is a model capability, not a promise that this PC can run that context.
- The current Scopy provider is non-streaming and chat-only. Tool calling, vision, streaming, automatic provider failover, and automatic memory consolidation are not enabled.
- A server log saying model loaded is not a file integrity check. Use SHA-256.
- Do not remove the original model cache, runtime files, or database during troubleshooting.

## References

- Model card and Q4_K_M size/context details: https://huggingface.co/ggml-org/Qwen3-Coder-30B-A3B-Instruct-GGUF
- Exact GGUF SHA-256: https://huggingface.co/ggml-org/Qwen3-Coder-30B-A3B-Instruct-GGUF/blob/main/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf
- llama.cpp speculative decoding: https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md
- llama.cpp server metrics: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- llama.cpp memory fit options: https://github.com/ggml-org/llama.cpp/blob/master/tools/fit-params/README.md
- llama.cpp cache directory selection: https://github.com/ggml-org/llama.cpp/blob/master/common/hf-cache.cpp
