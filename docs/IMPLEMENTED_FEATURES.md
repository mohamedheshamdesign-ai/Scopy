# Scopy Implemented Features

**Evidence baseline:** tracked source and test files on branch `dev`, inspected 2026-11-22.  
**Status vocabulary:** Implemented = code exists; Partial = a limited implementation exists; Planned = described as future work; Unverified = no direct evidence inspected.

This document describes code presence, not a claim that the current local checkout has passed its tests. Check results must come from a fresh test run.

## Implemented or partially implemented

| Feature | Status | Source evidence | Test evidence / limits |
|---|---|---|---|
| Node.js/TypeScript CLI entry point | Implemented | `src/cli.ts`, `package.json` | CLI exposes health, task, AI, benchmark, and memory commands. |
| Structured local logging | Implemented, bounded initial logger | `src/logging/scopy-logger.ts`, `src/cli.ts`, `src/orchestrator/step-executor.ts` | `tests/logger.test.ts`; JSON-lines logs are written under the Scopy home, sensitive keys and bearer/API-key patterns are redacted, strings and record counts are bounded, and one rotated log is retained. CLI command lifecycle and guarded plan-step approval/start/success/failure/denial events are recorded without action payload contents; not every subsystem emits events yet. |
| Local application paths/config | Partial | `src/config.ts`, `src/db/database.ts` | Resolves home, database, workspace, backup, log, and temp directories under one Scopy home and creates them on database initialization. Broader typed environment validation remains open. |
| SQLite connection and versioned migrations | Implemented | `src/db/database.ts` | Migrations v1-v8 create tasks/audit, permissions/approvals, execution/checkpoints, memory, orchestrator plans/runs, typed plan actions, and project/task relationships. |
| Project repository | Implemented, initial lifecycle | `src/projects/project-repository.ts`, `src/db/database.ts` | `tests/projects.test.ts`; projects can be created, listed, inspected, and archived. Archived projects cannot receive new tasks; existing linked tasks remain accessible. |
| SQLite backup create/verify | Implemented, no restore command yet | `src/backup/backup-service.ts`, `src/cli.ts` | `tests/backup.test.ts`; uses SQLite online backup, integrity-checks the snapshot, reports schema version and task/project counts, and only verifies generated filenames under the Scopy backups directory. Restore is not implemented. |
| Task create/read/list/update/complete repository | Implemented | `src/tasks/task-repository.ts` | `tests/task-repository.test.ts`, `tests/projects.test.ts`; tasks support project association, filtering, status/priority updates, and completion. |
| Task audit events | Implemented for task create/update/complete | `src/tasks/task-repository.ts`, `src/db/database.ts` | Task create, update, and completion emit audit events. |
| Audit event inspection | Implemented, read-only | `src/audit/audit-repository.ts`, `src/cli.ts` | `tests/audit.test.ts`; audit events can be listed and filtered by entity type and ID with bounded results. |
| Permission rules and policy decisions | Implemented | `src/permissions/policy-engine.ts`, `src/permissions/permission-repository.ts`, `src/permissions/types.ts` | `tests/permissions.test.ts`; default-deny, scoped rules, CLI listing, and audited rule removal are implemented. |
| Approval lifecycle and one-time payload-bound approvals | Implemented | `src/permissions/approval-service.ts` | `tests/permissions.test.ts`; approvals are bound to actor/tool/action/target/payload; pending and full status history can be inspected. |
| Guarded tool execution | Implemented | `src/permissions/execution-guard.ts`, `src/tools/tool-gateway.ts` | `tests/tool-gateway.test.ts`, `tests/permissions.test.ts`. |
| Workspace-scoped UTF-8 filesystem read/write/list/mkdir | Implemented, with isolation limits | `src/tools/filesystem-tool.ts` | `tests/tool-gateway.test.ts`; path traversal and symlink escape checks exist. This is not OS-level sandboxing and race-condition hardening remains planned. |
| Runtime execution records, timeout/cancellation, output limits, checkpoints | Implemented, with documented limits | `src/runtime/runtime-engine.ts`, `src/db/database.ts` | `tests/runtime-engine.test.ts`; cancellation is cooperative, output limit is checked after serialization, and resume is caller-driven. |
| AI provider contract and capability declarations | Implemented | `src/ai/types.ts` | `tests/ai-router.test.ts`. |
| Local OpenAI-compatible provider | Implemented, limited | `src/ai/local-openai-provider.ts` | `tests/ai-router.test.ts`; loopback-only, health and non-streaming chat. No tool calling or vision. |
| Provider routing, model validation, cloud egress gate | Implemented, limited | `src/ai/provider-router.ts`, `src/ai/create-local-router.ts` | `tests/ai-router.test.ts`; cloud egress requires explicit opt-in. No automatic cloud fallback/provider failover. |
| Configurable local generation timeout | Implemented | `src/ai/create-local-router.ts` | `tests/local-router-timeout.test.ts`; default is 600,000 ms, bounded by validation. |
| SQLite-backed typed memory records and lexical retrieval | Implemented, limited | `src/memory/memory-repository.ts`, `src/agents/agent-registry.ts`, `src/db/database.ts` | `tests/memory-repository.test.ts`, `tests/agents.test.ts`; retrieval is bounded lexical matching, not embeddings/vector search. CLI chat and advisory agent runs inject up to five relevant active memories above a confidence threshold. |
| Windows local model launcher, connector, diagnostics | Implemented | `scripts/start-local-ai.ps1`, `scripts/connect-local-ai.ps1`, `scripts/inspect-local-ai.ps1` | Device-specific performance measurements and tuning A/B tests are not automatically proven by script presence. |
| Live tracked-file inventory for project chat | Implemented | `src/project/project-context.ts` | `tests/project-context.test.ts`; uses fixed read-only `git ls-files` and falls back to the checked-in inventory snapshot when Git is unavailable. |
| CLI chat project-context injection with evidence rules | Implemented, limited | `src/ai/chat-context.ts`, `src/cli.ts` | `tests/chat-context.test.ts`; loads live tracked paths plus implemented/planned feature records, architecture, and implementation plan. Context is capped at 24,000 characters. |
| Local-model draft planning, validation, persistence, and manual review | Implemented, limited | `src/orchestrator/plan.ts`, `src/orchestrator/planner.ts`, `src/orchestrator/plan-repository.ts`, `src/cli.ts`, `src/db/database.ts` | `tests/orchestrator.test.ts`; creates JSON-validated plans with bounded steps, risk labels, dependency validation, cycle detection, persisted draft/approved/rejected states, and audit events. Approval is a review record only; it does not authorize or execute tools. |
| Orchestrator run lifecycle and step tracking | Implemented, manual-only | `src/orchestrator/run-repository.ts`, `src/db/database.ts`, `src/cli.ts` | `tests/orchestrator-run.test.ts`; approved plans can start persisted runs; dependency-gated ready/running/succeeded/failed/skipped states, serial step transitions, explicit retry after a recorded failure, cancellation, audit events, and JSON snapshots are implemented. Manual CLI transitions still do not execute tools. An explicit `run recover` command can mark one in-flight step failed only after the user confirms the previous process has stopped; possible side effects are unknown and are never retried automatically. |
| Built-in specialist agent registry | Implemented, advisory-only profiles | `src/agents/agent-registry.ts`, `src/cli.ts` | `tests/agents.test.ts`; includes assistant, brand designer, business operator, developer, research analyst, marketing strategist, and project manager profiles. Agent runs use the local provider and relevant lexical memory. They have no tools and cannot browse or execute actions. |
| Guarded orchestrator step execution | Implemented, bounded filesystem action proposals | `src/orchestrator/plan.ts`, `src/orchestrator/action-resolver.ts`, `src/orchestrator/step-executor.ts`, `src/cli.ts`, `src/runtime/runtime-engine.ts`, `src/tools/tool-gateway.ts`, `src/permissions/*` | `tests/orchestrator.test.ts`, `tests/orchestrator-run.test.ts`, `tests/orchestrator-step-executor.test.ts`; the planner may attach a validated filesystem read/list/mkdir/write action to a step. Actions persist with plans and runs, resolve to typed requests, and execute only through policy, exact one-time approval, RuntimeEngine, ToolGateway, and ExecutionGuard. The CLI executes the saved action without hand-written JSON. Unsupported work remains manual. Filesystem access is workspace-scoped, not OS-sandboxed. |

## Not implemented or not evidenced by the current tracked source tree

- Action resolution is limited to validated filesystem read/write proposals. Research, browser, terminal, desktop, and external-app actions are not supported by the resolver. Automatic crash recovery of interrupted side effects remains unimplemented.
- Multi-agent delegation, inter-agent messaging, and independent agent work queues.
- Tool-enabled autonomous specialist agents; current specialist profiles are advisory-only and do not have web, filesystem, terminal, or external-app tools.
- Browser automation.
- Windows computer/UI control.
- Terminal command execution tool.
- MCP tool integration.
- Desktop application/workspace.
- External app integrations.
- Embeddings, vector database, automatic memory extraction, and memory consolidation.
- Streaming chat, AI tool calling, and vision support.
- General structured logging with secret redaction.
- General stable error taxonomy/serialization.
- A projects repository/API.
- SQLite backup restore workflow; backups can be created and verified but not restored through the CLI.
- OS-level process isolation for filesystem or tool execution.

A feature listed here as absent may be added later. Re-inspect source and tests before changing its status.
