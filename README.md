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

The local foundation now includes task persistence, versioned SQLite migrations, a central permission policy engine, exact-action approval records, one-time approval consumption, and audit events.

The permission engine uses **default deny**. Rules can be scoped by actor, tool, action, and target. Target patterns support an exact target, `*`, or a trailing wildcard prefix such as `E:\\Scopy\\workspace\\*`. Filesystem targets are normalized with Windows path rules and compared case-insensitively. A more specific rule takes precedence; ties resolve as deny, then approval-required, then allow.

The filesystem adapter resolves existing paths (including symlinks) and verifies that the resolved destination remains inside the configured workspace before reads and writes. String-pattern checks alone are not a filesystem sandbox.

Consequential actions configured as `approval_required` must have an approved request whose SHA-256 action fingerprint matches the exact actor, tool, action, target, and payload. The approval is consumed once before the handler runs. Policy decisions are re-evaluated at execution time.

The initial Tool Gateway is now in place. Registered tools can only be invoked through the gateway, which routes execution through the central guard. The first adapter is a UTF-8 filesystem tool scoped to `E:\\Scopy\\workspace` by default (the `workspace` directory under the configured Scopy home). It checks resolved paths and symlink destinations before reads and writes. The filesystem adapter is a first security boundary, not an OS-level sandbox: a future hardened adapter must address local time-of-check/time-of-use races and use OS-level isolation where appropriate.

The current gateway is an internal application API; no agent or external integration is connected yet. Reviewer identity is currently supplied by the trusted local application layer; authenticated user identity is a later integration task.
