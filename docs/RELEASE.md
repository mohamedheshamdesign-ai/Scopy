# Scopy Windows package

This package is a reproducible source distribution of the current Scopy local-core milestone.

## Included

- TypeScript CLI application and SQLite storage.
- Local OpenAI-compatible model connection (loopback only).
- Task and project repositories.
- Typed local memory with bounded lexical retrieval.
- Specialist advisory profiles.
- Draft planning, review, run tracking, guarded filesystem actions, approvals, and audit events.
- Local backup creation, verification, and restore.
- Windows local-model launcher, connector, diagnostics, and verification scripts.
- Tests and architecture/implementation documentation.

## Not included yet

This is not the final desktop-agent vision. The current milestone is a local CLI core. It does not yet provide a desktop GUI, browser/computer control, general terminal execution, autonomous multi-agent delegation, vector memory, model tool-calling, or built-in third-party integrations. Specialist agents are advisory-only. The filesystem tool is the only registered execution adapter.

Do not interpret a roadmap item or a generated plan as an implemented feature. See docs/IMPLEMENTED_FEATURES.md and docs/PLANNED_FEATURES.md.

## Requirements

- Windows 11
- Node.js 24 or newer
- npm included with Node.js
- A local OpenAI-compatible model server is optional for database, task, project, memory, and backup features.

## Install on E drive

1. Extract the package into E:\Scopy.
2. Open PowerShell in E:\Scopy.
3. Run:

   ~~~powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-scopy.ps1
   ~~~

The installer uses E:\Scopy as SCOPY_HOME by default, keeps the workspace under E:\Scopy\workspace, installs dependencies, runs typecheck/build/tests, initializes the local database, and performs a read-only doctor check. It does not delete existing files or reset the database.

To persist the three Scopy environment settings for the current Windows user, opt in explicitly:

   ~~~powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-scopy.ps1 -PersistUserEnvironment
   ~~~

The persisted safety profile is strict (default deny). Do not switch to workspace_assist unless you understand that it permits workspace reads/listings and requires approval for writes and directory creation.

## First run

   ~~~powershell
   npm run dev -- health
   npm run dev -- doctor
   npm run dev -- agent list
   npm run dev -- task add "My first Scopy task"
   npm run dev -- task list
   npm run dev -- project create "Personal Brand"
   npm run dev -- memory list
   npm run dev -- backup create
   ~~~

## Connect local AI

Start the local llama.cpp server using the provided scripts\start-local-ai.ps1 setup where applicable. In a second PowerShell session:

   ~~~powershell
   . .\scripts\connect-local-ai.ps1
   npm run dev -- ai models
   npm run dev -- ai health
   npm run dev -- ai chat "Review the Scopy project and suggest the next safe improvement."
   ~~~

The AI provider is optional and does not silently fall back to a cloud service. Local generation is non-streaming and chat-only.

## Data and safety

By default, all Scopy-managed state is rooted at SCOPY_HOME:

   ~~~text
   E:\Scopy\
     data\scopy.sqlite
     backups\
     logs\
     temp\
     workspace\
     cache\
     runtime\
     models\
     secrets\
   ~~~

Only the directories actually used by enabled components are created. Keep databases, backups, logs, secrets, model weights, runtime binaries, and personal workspace files out of Git. The installer does not copy or move existing model files.

Create and verify a backup before upgrades or database maintenance:

   ~~~powershell
   npm run dev -- backup create
   npm run dev -- backup list
   npm run dev -- backup verify BACKUP_FILENAME
   ~~~

See docs/LOCAL_AI_WINDOWS.md for the device-specific llama.cpp configuration and measured limitations.
