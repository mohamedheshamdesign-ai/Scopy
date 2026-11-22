# Scopy Implemented Features

**Evidence baseline:** tracked source and test files on branch `dev`, inspected 2026-11-22.  
**Status vocabulary:** Implemented = code exists; Partial = a limited implementation exists; Planned = described as future work; Unverified = no direct evidence inspected.

This document describes code presence, not a claim that the current local checkout has passed its tests. Check results must come from a fresh test run.

## Implemented or partially implemented

| Feature | Status | Source evidence | Test evidence / limits |
|---|---|---|---|
| Node.js/TypeScript CLI entry point | Implemented | `src/cli.ts`, `package.json` | CLI exposes health, task, AI, benchmark, and memory commands. |
| Local application paths/config | Partial | `src/config.ts` | Resolves home/data/database paths; no schema validation or advanced configuration validation is present in this file. |
| SQLite connection and versioned migrations | Implemented | `src/db/database.ts` | Migrations v1-v6 create tasks/audit, permissions/approvals, execution/checkpoints, memory, orchestrator plans, and orchestrator run/step/checkpoint tables. |
| Task create/read/list/complete repository | Implemented | `src/tasks/task-repository.ts` | `tests/task-repository.test.ts`; no separate projects repository is present in the inventory. |
| Task audit events | Partial | `src/tasks/task-repository.ts`, `src/db/database.ts` | Task creation/completion emit audit events; do not assume every system action is audited unless its code proves it. |
| Permission rules and policy decisions | Implemented | `src/permissions/policy-engine.ts`, `src/permissions/permission-repository.ts`, `src/permissions/types.ts` | `tests/permissions.test.ts`; default-deny and scoped rules are described in implementation plan and code. |
| Approval lifecycle and one-time payload-bound approvals | Implemented | `src/permissions/approval-service.ts` | `tests/permissions.test.ts`; approvals are bound to actor/tool/action/target/payload. |
| Guarded tool execution | Implemented | `src/permissions/execution-guard.ts`, `src/tools/tool-gateway.ts` | `tests/tool-gateway.test.ts`, `tests/permissions.test.ts`. |
| Workspace-scoped UTF-8 filesystem read/write | Implemented, with isolation limits | `src/tools/filesystem-tool.ts` | `tests/tool-gateway.test.ts`; path traversal and symlink escape checks exist. This is not OS-level sandboxing and race-condition hardening remains planned. |
| Runtime execution records, timeout/cancellation, output limits, checkpoints | Implemented, with documented limits | `src/runtime/runtime-engine.ts`, `src/db/database.ts` | `tests/runtime-engine.test.ts`; cancellation is cooperative, output limit is checked after serialization, and resume is caller-driven. |
| AI provider contract and capability declarations | Implemented | `src/ai/types.ts` | `tests/ai-router.test.ts`. |
| Local OpenAI-compatible provider | Implemented, limited | `src/ai/local-openai-provider.ts` | `tests/ai-router.test.ts`; loopback-only, health and non-streaming chat. No tool calling or vision. |
| Provider routing, model validation, cloud egress gate | Implemented, limited | `src/ai/provider-router.ts`, `src/ai/create-local-router.ts` | `tests/ai-router.test.ts`; cloud egress requires explicit opt-in. No automatic cloud fallback/provider failover. |
| Configurable local generation timeout | Implemented | `src/ai/create-local-router.ts` | `tests/local-router-timeout.test.ts`; default is 600,000 ms, bounded by validation. |
| SQLite-backed typed memory records and lexical retrieval | Implemented, limited | `src/memory/memory-repository.ts`, `src/db/database.ts` | `tests/memory-repository.test.ts`; retrieval is bounded lexical matching, not embeddings/vector search. |
| Windows local model launcher, connector, diagnostics | Implemented | `scripts/start-local-ai.ps1`, `scripts/connect-local-ai.ps1`, `scripts/inspect-local-ai.ps1` | Device-specific performance measurements and tuning A/B tests are not automatically proven by script presence. |
| Live tracked-file inventory for project chat | Implemented | `src/project/project-context.ts` | `tests/project-context.test.ts`; uses fixed read-only `git ls-files` and falls back to the checked-in inventory snapshot when Git is unavailable. |
| CLI chat project-context injection with evidence rules | Implemented, limited | `src/ai/chat-context.ts`, `src/cli.ts` | `tests/chat-context.test.ts`; loads live tracked paths plus implemented/planned feature records, architecture, and implementation plan. Context is capped at 24,000 characters. |
| Local-model draft planning, validation, persistence, and manual review | Implemented, limited | `src/orchestrator/plan.ts`, `src/orchestrator/planner.ts`, `src/orchestrator/plan-repository.ts`, `src/cli.ts`, `src/db/database.ts` | `tests/orchestrator.test.ts`; creates JSON-validated plans with bounded steps, risk labels, dependency validation, cycle detection, persisted draft/approved/rejected states, and audit events. Approval is a review record only; it does not authorize or execute tools. |
| Orchestrator run lifecycle and step tracking | Implemented, manual-only | `src/orchestrator/run-repository.ts`, `src/db/database.ts`, `src/cli.ts` | `tests/orchestrator-run.test.ts`; approved plans can start persisted runs; dependency-gated ready/running/succeeded/failed/skipped states, serial step transitions, explicit retry after a recorded failure, cancellation, audit events, and JSON snapshots are implemented. No tools or external actions are executed by these commands. Abrupt-process recovery of an in-flight step is not automatic; it is deliberately not replayed because side effects may be uncertain. |

## Not implemented or not evidenced by the current tracked source tree

- Automated execution of plan steps through registered tools, including per-action policy/approval integration and automatic crash recovery. Current run commands only track manual step transitions and persist inspectable snapshots; they do not execute tools.
- Agent registry and multi-agent delegation.
- Specialist agent implementations (Research, Developer, Business, Design, Marketing, Operations).
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
- OS-level process isolation for filesystem or tool execution.

A feature listed here as absent may be added later. Re-inspect source and tests before changing its status.
