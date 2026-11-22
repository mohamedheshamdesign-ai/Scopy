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

## First commands

Run the development CLI:

```powershell
npm run dev -- health
npm run dev -- task add "Prepare Scopy project brief"
npm run dev -- task list
```

To complete a task, copy its ID from the task list:

```powershell
npm run dev -- task complete <TASK_ID>
```

The CLI can also be run from the compiled output:

```powershell
npm run build
npm start -- health
```

## Local data

By default, Scopy uses the repository directory as its home and stores runtime data in:

```text
E:\Scopy\data\scopy.sqlite
```

Set `SCOPY_HOME` to change the Scopy home directory. Database files, WAL files, logs, secrets, and backups must never be committed.

## Repository workflow

- `main`: stable, reviewed baseline.
- `dev`: active development.
- Feature branches should be created from `dev` and merged back through review.

Do not commit directly to `main`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [ADR 0001 — SQLite driver](docs/decisions/0001-sqlite-driver.md)

## Current milestone

The local foundation includes task persistence, versioned SQLite migrations, a central permission policy engine, exact-action approval records, one-time approval consumption, and audit events.

The permission engine uses **default deny**. Rules can be scoped by actor, tool, action, and target. Target patterns support an exact target, `*`, or a trailing wildcard prefix such as `E:\\Scopy\\workspace\\*`. Filesystem targets are normalized with Windows path rules and compared case-insensitively. A more specific rule takes precedence; ties resolve as deny, then approval-required, then allow.

The filesystem adapter resolves existing paths (including symlinks) and verifies that the resolved destination remains inside the configured workspace before reads and writes. String-pattern checks alone are not a filesystem sandbox.

Consequential actions configured as `approval_required` must have an approved request whose SHA-256 action fingerprint matches the exact actor, tool, action, target, and payload. The approval is consumed once before the handler runs. Policy decisions are re-evaluated at execution time.

The Tool Gateway routes registered tools through the central execution guard. The first adapter is a UTF-8 filesystem tool scoped to `E:\\Scopy\\workspace` by default. It checks resolved paths and symlink destinations before reads and writes. This is a first security boundary, not an OS-level sandbox: local time-of-check/time-of-use races and OS-level isolation remain future hardening work.

### Runtime engine

The Runtime Engine wraps gateway calls and stores execution records and checkpoints in SQLite (migration 3). It provides:

- Per-run timeouts (1ms–10 minutes) and cancellation through an `AbortSignal`.
- A structured execution status and audit trail for started, succeeded, failed, cancelled, and timed-out runs.
- A serialized output size limit (1 byte–1 MiB).
- Explicit checkpoints, plus caller-driven resume that supplies the latest checkpoint to a new run.
- Resume-source validation: actor, tool, action, and target must match the new request.

Tools should observe `context.signal` and periodically check it during long operations. Cancellation and timeout are cooperative: a handler that ignores the signal may continue running after the Runtime Engine has stopped awaiting it. The output limit is checked after a handler returns and its result is serialized; it limits accepted/persisted output, not peak memory allocated inside a tool. Streaming output enforcement and hard process isolation are future work.

The gateway is an internal application API; no agent or external integration is connected yet. Reviewer identity is currently supplied by the trusted local application layer; authenticated user identity and a local approval interface remain future work.


### AI Router and memory (initial local milestone)

The AI provider contract and router are provider-independent. The first adapter speaks the OpenAI-compatible chat API but is deliberately restricted to HTTP loopback endpoints (`localhost`, `127.0.0.1`, or `::1`). The default endpoint is `http://127.0.0.1:8080/v1`; no remote endpoint is accepted by this local adapter.

Configure the exact model ID reported by your local server:

```powershell
$env:SCOPY_LOCAL_AI_URL = "http://127.0.0.1:8080/v1"
$env:SCOPY_LOCAL_AI_MODEL = "YOUR_EXACT_MODEL_ID"
# Optional, only if your local server requires a key:
$env:SCOPY_LOCAL_AI_API_KEY = "YOUR_LOCAL_SERVER_KEY"

npm run dev -- ai health
npm run dev -- ai chat "Explain the current Scopy architecture."
```

These environment variables apply to the current PowerShell session. API keys are not written to SQLite or project files. Scopy does not silently fall back to a cloud model. Cloud providers are blocked unless a caller explicitly sets `allowCloudEgress: true` for that request; blocked and authorized egress attempts are audited. No cloud provider adapter is enabled by default.

The first memory repository stores working, episodic, semantic, project, preference, and procedural records with scope, source type/reference, confidence, timestamps, and optional expiry. Search is bounded lexical retrieval with scope filtering and global-memory inclusion; it is not semantic/vector search. Archived and expired records are excluded. Memory create/archive operations are audited.

```powershell
npm run dev -- memory add preference global "Prefer local-first AI and explicit cloud approval."
npm run dev -- memory add project project:scopy "Scopy uses SQLite and a local-first provider router."
npm run dev -- memory search "local AI provider"
npm run dev -- memory list
```

Retrieval evaluation begins with deterministic unit tests. Embeddings, automatic memory extraction/consolidation, cloud adapters, streaming, tool calling, and provider failover are intentionally not enabled yet.
