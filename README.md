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

The first vertical slice provides a local CLI, SQLite migrations, task persistence, and audit events. It is an early foundation, not yet a complete autonomous agent system.
