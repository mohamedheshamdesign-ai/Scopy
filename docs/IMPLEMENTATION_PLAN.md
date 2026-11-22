# Scopy Implementation Plan

**Status:** Initial delivery plan  
**Working branch:** `dev`  
**Rule:** Do not develop directly on `main`.

## Delivery approach

Build a small, testable vertical slice first. Each phase must have acceptance criteria and a checkpoint commit. Avoid broad rewrites and avoid adding dependencies without a concrete requirement.

## Phase 0 — Repository and engineering baseline

- [x] Create local repository at `E:\Scopy`.
- [x] Add Git ignore rules for local runtimes, secrets, databases, and generated files.
- [x] Create and push `main` and `dev`.
- [x] Confirm clean working tree and upstream tracking.
- [x] Add architecture and implementation documentation.
- [x] Add Node/TypeScript project configuration and repeatable scripts.
- [x] Add automated test runner and CI validation on Windows and Linux via GitHub Actions.
- [x] Confirm the actual Node.js version and package manager on the target PC (Node 24.21.0, npm 11.19.0 reported).

**Acceptance:** clean install, typecheck, build, and tests run locally and in CI; no local data or secrets are tracked. A dedicated lint script is not currently configured.

## Phase 1 — Core foundation

Implement only the contracts and infrastructure required for a first working vertical slice:

1. [ ] Centralized local path configuration and null-character rejection; broader environment schema validation and safe-mode profiles remain open.
2. [x] Structured local JSON logging with secret redaction and bounded rotation; subsystem coverage remains incremental.
3. Stable error types and error serialization.
4. SQLite adapter interface and migration runner.
5. Repository layer for projects and tasks.
6. Run/task IDs, timestamps, status transitions, and audit events.
7. Unit and integration tests.

**Acceptance:** create, list, update, and complete tasks; create/list/update/archive projects; restart Scopy and verify persistence. SQLite backup creation and integrity verification are implemented and tested; restore remains open.

## Phase 2 — Controlled execution

1. Typed tool contract and tool registry.
2. [x] Central policy decision engine: allow, deny, approval required, with default-deny behavior and scoped rules.
3. [x] Approval records bound to the exact actor, tool, action, target, and payload; approvals are single-use.
4. [x] Audit events for policy changes, approval lifecycle, and guarded tool execution.
5. [x] Tool gateway that routes registered tool calls through the execution guard.
6. [x] Initial UTF-8 filesystem tool restricted to the configured workspace; path traversal and symlink escapes are checked.
7. [x] Runtime engine with cooperative timeout/cancellation, serialized output-size limits, persisted execution records, checkpoints, and caller-driven resume.
8. Harden filesystem isolation against local race conditions; add OS-level isolation where appropriate.
9. Authenticated reviewer identity and a local approval interface.

**Runtime limitations:** cancellation requires tools to observe the abort signal; non-cooperative handlers may continue after the runtime stops awaiting them. Output size is checked after result serialization, not as a streaming or memory-allocation cap. Hard process isolation and streaming output enforcement are not implemented. A failed/timed-out execution may have completed an external side effect before the runtime recorded failure; retries are explicit and must not be assumed idempotent.

**Acceptance:** policy, approval, gateway, filesystem, and runtime tests pass; safe read/write succeeds inside the workspace; traversal and symlink escapes are denied; approval-required actions cannot execute before approval; timeouts and cancellation are recorded; checkpoints can be loaded by a matching resumed run.

## Phase 3 — AI routing and memory

1. [x] Provider adapter interface and capability declarations.
2. [x] Loopback-only OpenAI-compatible local provider with health and chat requests.
3. [x] Explicit per-request cloud egress opt-in enforcement and audit events; no cloud provider enabled by default.
4. [x] Provider registry, model validation, and health checks.
5. [x] SQLite memory records for working, episodic, semantic, project, preference, and procedural types with provenance, confidence, scope, and expiry.
6. [x] Bounded lexical retrieval and deterministic retrieval tests before adding embeddings.
7. [x] Windows local-runtime launcher, E:-scoped model cache, model integrity diagnostics, model-ID discovery, and CLI throughput benchmark harness.
8. [ ] Record device-specific speed/RAM/VRAM/context measurements and complete controlled GPU-offload, KV-cache, Flash Attention, and speculative-decoding A/B tests.
9. [ ] Automatic memory extraction/consolidation and richer retrieval evaluation.
8. [ ] Optional cloud provider adapters, streaming, and tool calling only after explicit policy and data-boundary review.

**Current limits:** local provider is non-streaming and chat-only. It does not implement tool calls or vision. Memory search is lexical, not embedding-based. Provider failover is intentionally absent: a local provider failure never silently routes private prompts to cloud. The Windows runtime launcher and benchmark harness are implemented, but device-specific performance measurements remain pending until executed on the target PC.

**Acceptance:** route a prompt to a configured local model; handle provider unavailable state; reject non-loopback endpoints; no silent cloud fallback; memory results expose source, scope, and confidence; expiry/archive filters work.

## Phase 4 — Orchestration and specialist agents

1. [x] Plan schema and validation — bounded step fields, risk labels, dependency validation, and cycle detection.
   - Initial slice also supports local-model draft generation, SQLite persistence, explicit approve/reject review, and audit events. Plan approval is not execution authorization.
2. [x] Orchestrator run lifecycle — approved-plan runs, persisted step states, dependency gating, serial transitions, explicit retry after recorded failures, cancellation, audit events, and inspectable checkpoints.
3. [x] Guarded plan-step execution service — typed action requests pass policy preflight, exact one-time approval checks, actor binding, RuntimeEngine, ToolGateway, and ExecutionGuard.
4. [x] CLI wiring for explicit filesystem actions, permission-rule management, and approval review.
5. [x] Bounded typed filesystem action proposals stored with reviewed plan steps and copied into runs; the CLI resolves saved actions without hand-written JSON.
6. [ ] Expand action resolution only through separately validated schemas and registered tools; never execute model-generated free text as a tool call.
7. [x] Built-in advisory-only agent registry and capability declarations; specialist profiles run through the local chat provider and cannot invoke tools.
8. [ ] Multi-agent delegation and inter-agent messaging. [x] Explicit manual recovery of a single interrupted in-flight step after process-stop confirmation; side effects remain unknown and require inspection.
8. Delegation, dependencies, and safe checkpoint recovery (including explicit handling of interrupted in-flight steps).
9. Evaluation of plan quality and execution outcomes.
10. [ ] Add tool-enabled Research and Developer agents first, then expand based on real workflows.

**Acceptance:** one multi-step task is planned and reviewed; a run is started; dependency-ordered steps can be advanced manually or executed through the guarded service; default-deny, exact approvals, actor binding, tool failure recording, checkpoints, and audit trails are tested. The CLI currently registers only the filesystem tool. The planner can propose validated filesystem read/list/mkdir/write actions; unsupported work remains manual. Automatic interrupted-side-effect recovery is not implemented. A timeout or failed result does not prove that a non-cooperative tool had no side effect; retries require review.

## Phase 5 — Browser and computer control

1. Browser automation in an isolated context.
2. Domain, download, and session controls.
3. Windows computer adapter behind the tool gateway.
4. Per-action risk checks and explicit approvals.
5. Recovery and screenshot/evidence capture where appropriate.

**Acceptance:** browser research works in isolation; consequential actions remain approval-gated; desktop actions are logged and recoverable.

## Phase 6 — Workspace and integrations

1. Desktop workspace after core APIs stabilize.
2. Project/task/run/memory views.
3. Provider and permission settings.
4. External integrations, each opt-in and scoped.
5. Backup, restore, diagnostics, and upgrade workflow.

**Acceptance:** user can manage projects and inspect/approve agent work from one local interface.

## Engineering rules

- Work on `dev`; protect `main` as the stable branch.
- Use small commits with descriptive messages.
- Run formatting, lint, typecheck, and tests before pushing.
- Never commit `.env`, credentials, databases, logs, personal files, or backups.
- Do not delete or overwrite user data during migrations.
- Prefer additive migrations and create a verified backup before destructive schema changes.
- Every tool must declare inputs, outputs, capabilities, side effects, and risk level.
- Every consequential action must be authorized by the central policy service.
- Treat external content and model output as untrusted input.
