# Scopy

Private, local-first personal AI operating system.

Scopy is being built as a modular local application for research, planning, creative work, business operations, software development, memory, and carefully permissioned computer actions.

## Principles

- Local-first: application data and the SQLite database live under the Scopy home directory.
- Privacy-aware: cloud model providers are optional and must be explicitly configured.
- Human approval: consequential actions require policy evaluation and explicit approval.
- Auditable: task and tool activity is recorded with stable IDs and timestamps.
- Modular: agents, providers, storage, and tools use replaceable interfaces.
- Incremental: each milestone must be testable before the next layer is added.

## Requirements

- Node.js 24+
- npm 11+
- Windows 11 is the initial target platform.

## Setup

From the repository root:

```powershell
npm install
npm run check
npm run build
```

## Windows verification

From the repository root in PowerShell, run the one-command verification script:

```powershell
.\scripts\verify-scopy.ps1
```

The script checks Node.js 24+, installs dependencies with npm, runs typecheck/build/tests through `npm run check`, initializes the local database with `health` if needed, and finishes with a read-only `doctor` check. Use `-SkipInstall` when dependencies are already installed. It does not delete or reset local data.

Set `SCOPY_WORKSPACE_DIR` in the current PowerShell session when Scopy should operate on a specific project folder instead of the default `workspace` directory. Set `SCOPY_SAFETY_PROFILE=workspace_assist` to allow workspace reads/listings and require approval for writes/creating directories; the default `strict` profile denies actions without explicit permission rules. This built-in profile applies only to `user:local` and never grants terminal or other tool access. Point `SCOPY_WORKSPACE_DIR` only at a dedicated project folder: `workspace_assist` permits reading and listing every file inside that folder, so do not use a drive root, your home directory, Scopy's secrets/data folders, or a directory containing unrelated private files. The SQLite database, logs, backups, and other Scopy data remain under `SCOPY_HOME`.

A third profile, `SCOPY_SAFETY_PROFILE=workspace_autonomy`, pre-authorizes only the workspace-scoped filesystem actions (`read`, `list`, `write`, `mkdir`) for `user:local`. Terminal, browser, Windows computer, and MCP actions still require exact one-time approval under this profile, explicit permission rules always win over the profile, and every action stays audited. The default remains `strict`; activate `workspace_autonomy` only by an explicit choice for the current session, and point `SCOPY_WORKSPACE_DIR` at a dedicated project folder under the same restrictions as `workspace_assist`.

## First commands

Run the development CLI:

```powershell
npm run dev -- health
npm run dev -- dashboard
npm run dev -- task add "Prepare Scopy project brief"
npm run dev -- task list
npm run dev -- task show <TASK_ID>
npm run dev -- project create "Personal Brand" "Brand design projects"
npm run dev -- project list
npm run dev -- project update <PROJECT_ID> description "Updated project description"
npm run dev -- task add "Prepare brand strategy" --project <PROJECT_ID>
npm run dev -- task update <TASK_ID> status in_progress
npm run dev -- backup create
npm run dev -- backup list
npm run dev -- run execute <RUN_ID> [APPROVAL_ID]
npm run dev -- run recover <RUN_ID> --confirm-process-stopped
npm run dev -- permission list
npm run dev -- permission remove <RULE_ID>
npm run dev -- approval list --all
npm run dev -- audit list
npm run dev -- agent list
npm run dev -- agent run brand-designer "Create a brand identity direction for a premium design studio"
```

Projects can be created, listed, inspected, and archived. Tasks can be linked to active projects, filtered by project/status, and updated. Use `project show <PROJECT_ID>` to inspect a project and its tasks, `project update <PROJECT_ID> name|description <value>` to edit it, and `project archive <PROJECT_ID>` to archive it without deleting linked tasks. Run `backup list` to see saved snapshots, and `backup create` to create a SQLite snapshot under `E:\\Scopy\\backups`, then `backup verify <BACKUP_FILENAME>` to check its integrity. Use `backup restore <BACKUP_FILENAME>` to restore a verified snapshot; Scopy first creates and retains a verified safety backup of the current database. Close other Scopy processes before restoring.

To complete a task, copy its ID from the task list:

```powershell
npm run dev -- task complete <TASK_ID>
```

The CLI can also advance a run with `npm run dev -- run execute <RUN_ID>`. It executes consecutive saved filesystem actions in dependency order and stops at an exact approval request or a manual step. After reviewing and approving the requested action, rerun the same command with its approval ID. It never auto-executes unsupported or untyped work.

The CLI can also be run from the compiled output:

```powershell
npm run build
npm start -- health
```

## Local data

By default, Scopy uses the repository directory as its home. With `SCOPY_HOME=E:\\Scopy`, all controllable local data stays under that root:

```text
E:\Scopy\data\scopy.sqlite
```

Set `SCOPY_HOME` to change the Scopy home directory. Database files, WAL files, logs, secrets, backups, local model caches, runtime binaries, temporary files, and workspace contents must never be committed.

## Repository workflow

- `main`: stable, reviewed baseline.
- `dev`: active development.
- Feature branches should be created from `dev` and merged back through review.

Do not commit directly to `main`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [ADR 0001 — SQLite driver](docs/decisions/0001-sqlite-driver.md)
- [Windows Local AI Runtime](docs/LOCAL_AI_WINDOWS.md)

## Current milestone

`agent list` shows built-in specialists; `agent run <AGENT_ID> "prompt"` runs an advisory-only profile through the local model and relevant memory. Specialist profiles remain advisory-only and do not autonomously call tools. The local dashboard provides sequential specialist-team synthesis plus guarded plan execution. `permission list` inspects stored policy rules, `permission remove <RULE_ID>` revokes a stored rule, and `approval list --all` shows approval history including consumed requests. `memory archive <MEMORY_ID>` archives a memory record, and `audit list` inspects recent audit events (filter with `--entity`, `--id`, and `--limit`).

If Scopy exits while a plan step is running, inspect the run and only use `run recover <RUN_ID> --confirm-process-stopped` after confirming the prior process has stopped. Recovery marks the step failed; it does not assume the action had no side effects or retry it automatically.

The CLI writes structured JSON logs to `logs/scopy.log`, redacts sensitive fields and common API-key patterns, and retains one rotated log. Prompts and file contents are not logged by the CLI command lifecycle.

The local foundation includes task and project persistence, versioned SQLite migrations, SQLite backup creation and integrity verification, a central permission policy engine, exact-action approval records, one-time approval consumption, audit events, local AI chat, typed planning, and guarded filesystem execution. GitHub Actions validates the project on Windows and Linux for changes to `dev`.

The permission engine uses **default deny**. Rules can be scoped by actor, tool, action, and target. Target patterns support an exact target, `*`, or a trailing wildcard prefix such as `E:\\Scopy\\workspace\\*`. Filesystem targets are normalized with Windows path rules and compared case-insensitively. A more specific rule takes precedence; ties resolve as deny, then approval-required, then allow.

The filesystem adapter resolves existing paths (including symlinks) and verifies that the resolved destination remains inside the configured workspace before reads and writes. String-pattern checks alone are not a filesystem sandbox.

Consequential actions configured as `approval_required` must have an approved request whose SHA-256 action fingerprint matches the exact actor, tool, action, target, and payload. The approval is consumed once before the handler runs. Policy decisions are re-evaluated at execution time.

The planner can attach validated filesystem read/list/mkdir/write, browser-open, and constrained terminal-run actions to individual plan steps. These typed actions are stored with the reviewed plan and copied into the run. Execute a saved action with `npm run dev -- run step execute <RUN_ID> <STEP_ID>`; when policy requires approval, inspect `npm run dev -- approval list`, approve the exact request, and repeat the execute command with the approval ID. Plan approval does not authorize tool execution. Browser and terminal actions always require exact one-time approval. Unsupported steps remain manual; free-form model text is never executed.

The Tool Gateway routes registered tools through the central execution guard. Adapters include workspace-scoped filesystem access, a no-shell allowlisted terminal, isolated Chrome/Edge navigation and approved page interactions, Windows UI Automation with bounded window screenshots, public web search, and opt-in local stdio MCP servers. Terminal, browser-plan, computer, and MCP actions require exact one-time approval; MCP approval is bound to the server configuration fingerprint. The filesystem adapter checks resolved paths and symlink destinations; reads/writes are capped at 1 MiB and listings at 500 entries. Terminal and UI Automation are not OS-level sandboxes; browser downloads, coordinate-based desktop control, and global keyboard shortcuts remain deferred.

### Runtime engine

The Runtime Engine wraps gateway calls and stores execution records and checkpoints in SQLite (migration 3). It provides:

- Per-run timeouts (1ms–10 minutes) and cancellation through an `AbortSignal`.
- A structured execution status and audit trail for started, succeeded, failed, cancelled, and timed-out runs.
- A serialized output size limit (1 byte–1 MiB).
- Explicit checkpoints, plus caller-driven resume that supplies the latest checkpoint to a new run.
- Resume-source validation: actor, tool, action, and target must match the new request.

Tools should observe `context.signal` and periodically check it during long operations. Cancellation and timeout are cooperative: a handler that ignores the signal may continue running after the Runtime Engine has stopped awaiting it. The output limit is checked after a handler returns and its result is serialized; it limits accepted/persisted output, not peak memory allocated inside a tool. Streaming output enforcement and hard process isolation are future work.

The gateway is an internal application API. MCP stdio integrations are configured and invoked from the local dashboard, but specialist profiles do not yet autonomously invoke tools. Reviewer identity is currently supplied by the trusted local application layer; multi-user authenticated identity and a richer approval interface remain future work.

### AI Router and memory (initial local milestone)

The AI provider contract and router are provider-independent. The first adapter speaks the OpenAI-compatible chat API but is deliberately restricted to HTTP loopback endpoints (`localhost`, `127.0.0.1`, or `::1`). The default endpoint is `http://127.0.0.1:8080/v1`; no remote endpoint is accepted by this local adapter.

When the server was started with `scripts\start-local-ai.ps1`, no per-shell setup is needed: Scopy reads the launcher's ACL-protected key file from `<SCOPY_HOME>\secrets` and auto-discovers the model ID when exactly one model is served, so the CLI and dashboard connect from any shell. The environment variables below remain as explicit overrides (for example to choose between several served models):

```powershell
$env:SCOPY_LOCAL_AI_URL = "http://127.0.0.1:8080/v1"
$env:SCOPY_LOCAL_AI_MODEL = "YOUR_EXACT_MODEL_ID"
# Optional, only if your local server requires a key:
$env:SCOPY_LOCAL_AI_API_KEY = "YOUR_LOCAL_SERVER_KEY"

npm run dev -- ai health
npm run dev -- ai chat "Explain the current Scopy architecture."
```

These environment variables apply to the current PowerShell session and take precedence over the key file and auto-discovery. API keys are not written to SQLite or project files. Scopy does not silently fall back to a cloud model. Cloud model support stays disabled prep only: no adapter collects API keys or makes paid requests until the user opts in. When a cloud profile is eventually enabled, egress is restricted to the exact reviewed provider host whose protocol the adapter implements (currently only api.openai.com, OpenAI Chat Completions); literal IP hosts, credentialed URLs, redirects, and private or reserved DNS resolutions are refused. Health checks and requests share one gated path that requires explicit cloud access, and API keys are injected per request at the client layer and redacted from structured logs. Live-provider behavior is untested (no keys or paid traffic were used); activation is the user's decision and his charges.

The first memory repository stores working, episodic, semantic, project, preference, and procedural records with scope, source type/reference, confidence, timestamps, and optional expiry. Search is bounded lexical retrieval with scope filtering and global-memory inclusion; it is not semantic/vector search. Archived and expired records are excluded. Memory create/archive operations are audited.

```powershell
npm run dev -- memory add preference global "Prefer local-first AI and explicit cloud approval."
npm run dev -- memory add project project:scopy "Scopy uses SQLite and a local-first provider router."
npm run dev -- memory search "local AI provider"
npm run dev -- memory list
```

CLI chat and advisory specialist agents retrieve up to five relevant active memories using bounded lexical matching; archived and expired memories are excluded. Retrieval evaluation begins with deterministic unit tests. Embeddings, automatic memory extraction/consolidation, cloud adapters, streaming, tool calling, and provider failover are intentionally not enabled yet.

### Windows local AI runtime

A conservative Windows/Vulkan launcher, E:-scoped Hugging Face cache, model integrity/resource diagnostics, exact model ID discovery, and a Scopy CLI throughput benchmark are documented in [docs/LOCAL_AI_WINDOWS.md](docs/LOCAL_AI_WINDOWS.md).

The local runtime launcher does not download models: it requires the already-cached Q4_K_M GGUF, binds only to 127.0.0.1, uses one sequence, and leaves GPU layer placement to llama.cpp memory fitting. Flash Attention, quantized KV cache, and speculative decoding are not enabled in the baseline unless separately measured and explicitly selected.

## Local dashboard

Start the built-in local workspace:

```powershell
npm run dev -- dashboard
```

Open the exact loopback URL printed in PowerShell. The URL contains a one-time local access token fragment; do not share it or a screenshot that exposes it. After first open, Scopy exchanges it for an HttpOnly, SameSite local session cookie so the installed PWA can launch from its normal start URL. The token is retained under `SCOPY_HOME\secrets\dashboard-token.txt`. The dashboard binds to `127.0.0.1` only, validates the Host and Origin headers, requires a one-time bearer-token exchange and then an HttpOnly, SameSite session cookie for API calls, and does not load remote scripts, fonts, analytics, or assets.

The dashboard provides a local overview, assistant/specialist chat, task and project management, user-confirmed memory, plan review, guarded run execution, approval review, permission rules, audit activity, and verified database backups. Chat and planning require a configured local model in the same PowerShell session. It also includes user-initiated public web search (only the query is sent to DuckDuckGo), isolated Chrome/Edge navigation with page-text extraction, CSS-selector click/type and an allowlisted keypress set, a constrained terminal (node/git/python/powershell.exe, no shell, workspace-only working directory, bounded time/output), bounded Windows UI Automation window screenshots, and sequential two-to-three-specialist team synthesis. Browser interactions and terminal/computer actions require exact one-time approval. Browser downloads are denied. The isolated browser profile does not reuse personal browser cookies; users may sign in manually in that separate profile. Do not send passwords, API keys, or payment data through browser typing or computer set_value because exact approval payloads are retained in local approval history. These are limited capabilities: coordinate-based desktop control, unrestricted global keyboard shortcuts, remote HTTP MCP transports, built-in OAuth flows, and autonomous multi-agent tool delegation are not implemented. The dashboard also supports opt-in local stdio MCP servers; tool calls require exact approval, and only selected environment variable names are passed to the server process. Basic Windows UI Automation can inspect a window's control tree, invoke a uniquely identified control, or set a value after exact approval. Built-in OAuth flows and remote HTTP MCP transports are not included.

### Controlled terminal

The local dashboard includes a constrained terminal action. It launches only `node`, `git`, `python`, or `powershell.exe` as a direct child process (no shell), requires an exact one-time approval by default, confines the working directory to the configured Scopy workspace, limits arguments, execution time (up to two minutes), and combined output (48 KiB). A process that spawns detached child processes may outlive the direct child timeout; this is not an OS-level sandbox. Never pass credentials in command-line arguments.

### Isolated browser and specialist team

The dashboard can launch Chrome or Edge using a dedicated profile under `SCOPY_HOME\browser-profile`, open a URL, and extract the visible page text for review. It does not attach to the user's normal browser profile or reuse its cookies. Browser automation supports navigation, page reading, CSS-selector click/type, and an allowlisted keypress set, all with exact approvals. Downloads are blocked. It uses a separate Scopy profile, not the user's personal browser profile; manual sign-in in the Scopy profile is possible. Avoid entering secrets through automated typing because approval history retains action payloads. Team mode runs two or three advisory specialists sequentially through the same configured local model, then synthesizes their contributions; it is not yet autonomous multi-agent tool delegation.

### MCP integrations

Open Integrations in the local dashboard to register an MCP stdio server. The server configuration is stored under `SCOPY_HOME\secrets\mcp-servers.json`. Scopy supports local `node`, `python`, or `powershell.exe` launchers without a shell; arguments are stored as configuration, while credentials should be supplied through PowerShell environment variables whose names are explicitly listed in `passEnv`. Discover a server's tools, inspect its input schema, request an exact approval, then execute the approved call. The MCP process is started for each discovery/call and closed afterward. Do not place credentials in arguments or tool payloads. This is a stdio bridge, not a built-in OAuth client or remote MCP transport.

### Windows computer control

Open Computer in the local dashboard. Scopy uses Windows UI Automation against an exact top-level window title and a uniquely matched control Automation ID or exact name. Supported actions are inspect controls, invoke, set value, and bounded window screenshot capture. Each action requires exact one-time approval. Screenshot output is retained in local execution history and database backups; do not capture windows containing secrets. This initial adapter does not click screen coordinates, send global keyboard shortcuts, or provide OS-level isolation; some elevated or custom-drawn applications may not expose usable UI Automation controls.
