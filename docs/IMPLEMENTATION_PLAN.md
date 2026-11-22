# Scopy Implementation Plan

**Status:** Local-first CLI MVP with guarded filesystem execution  
**Working branch:** `dev`  
**Rule:** Do not develop directly on `main`.

## Delivery approach

Build small, testable vertical slices. Every consequential action must pass the central policy engine and, when required, an exact one-time approval. Model-generated prose is never executed as a tool call. Unsupported work remains manual.

## Phase 0 — Repository and engineering baseline

- [x] Create local repository at `E:\Scopy`.
- [x] Add Git ignore rules for local runtimes, secrets, databases, logs, and generated files.
- [x] Create and push `main` and `dev`.
- [x] Add architecture and implementation documentation.
- [x] Add Node/TypeScript project configuration and repeatable scripts.
- [x] Add GitHub Actions validation on Windows and Linux.
- [x] Confirm target machine versions: Node 24.21.0 and npm 11.19.0 were reported.

**Acceptance:** clean install, typecheck, build, and tests run in CI; local data and secrets are excluded from Git. A dedicated lint script is not configured yet.

## Phase 1 — Core foundation

1. [x] Typed validation for `SCOPY_HOME`, `SCOPY_WORKSPACE_DIR`, and `SCOPY_SAFETY_PROFILE`; `strict` and `workspace_assist` profiles are implemented. Central local paths and a truly read-only `doctor` command are implemented. Broader typed validation for optional provider settings remains open.
2. [x] Structured local JSON logging with secret redaction and bounded rotation. CLI lifecycle and guarded step events are logged without prompts or file contents.
3. [ ] Stable error taxonomy and consistent error serialization.
4. [x] SQLite database initialization and additive migration runner (schema migrations v1-v8).
5. [x] Project and task repositories, including project lifecycle and task/project association.
6. [x] Task IDs, timestamps, status/priority updates, completion, and audit events.
7. [x] Unit/integration tests and Windows/Linux CI.

**Acceptance:** create, list, show, update, and complete tasks; create/list/show/update/archive projects; restart Scopy and verify persistence. SQLite backup creation, integrity verification, and restore with a retained pre-restore safety snapshot are implemented and tested.

## Phase 2 — Controlled execution

1. [x] Typed tool contract and tool gateway/registry.
2. [x] Central policy engine: allow, deny, approval-required, default deny, and scoped rules.
3. [x] Exact actor/tool/action/target/payload-bound approvals with one-time consumption.
4. [x] Audit events for policy changes, approval lifecycle, and guarded execution.
5. [x] Tool gateway routes registered tool calls through the execution guard.
6. [x] Workspace-scoped filesystem read/write/list/mkdir. Path traversal and symlink escapes are checked; reads/writes are capped at 1 MiB and listings at 500 entries.
7. [x] Runtime engine with cooperative timeout/cancellation, output limits, persisted execution records, checkpoints, and caller-driven resume.
8. [ ] Harden against local time-of-check/time-of-use races and add OS-level process isolation.
9. [ ] Authenticated reviewer identity and a local approval interface; approval review is currently CLI-only.

**Runtime limitations:** cancellation is cooperative; non-cooperative handlers may continue after the runtime stops awaiting them. Output limits are checked after handler output serialization. A failed/timed-out action may have completed a side effect before failure was recorded. Retries are explicit and must be reviewed.

**Acceptance:** default-deny, exact approvals, actor binding, workspace confinement, filesystem size limits, failure recording, checkpoints, and audit trails are covered by tests.

## Phase 3 — AI routing and memory

1. [x] User-initiated public web search through the dashboard. Only the query is sent to the search provider; local memory and workspace content are not attached.

1. [x] Provider interface and capability declarations.
2. [x] Loopback-only OpenAI-compatible local provider with health and non-streaming chat.
3. [x] Explicit cloud egress gate; no cloud provider or silent cloud fallback is enabled.
4. [x] Provider registry, exact model ID validation, and health checks.
5. [x] SQLite memory records with type, provenance, confidence, scope, and expiry.
6. [x] Bounded lexical memory retrieval and deterministic tests; CLI chat and advisory agents inject up to five relevant active records.
7. [x] Windows local-model launcher, E:-scoped cache, integrity diagnostics, model-ID discovery, and benchmark harness.
8. [ ] Record target-PC throughput/RAM/VRAM/context measurements and complete controlled GPU-offload, KV-cache, Flash Attention, and speculative-decoding A/B tests.
9. [ ] Automatic memory extraction/consolidation and richer retrieval evaluation.
10. [ ] Optional cloud adapters, streaming, and model tool calling after explicit data-boundary and policy review.

**Current limits:** local chat is non-streaming and chat-only; no vision or model tool calling. Memory retrieval is lexical, not vector/embedding-based. Provider failover is absent. Device-specific performance measurements still need to be run on the target PC.

## Phase 4 — Orchestration and specialist agents

1. [x] Plan schema and validation: bounded fields, risk labels, dependency validation, and cycle detection.
2. [x] Plan generation, persistence, explicit approve/reject review, and audit events. Plan approval is not tool authorization.
3. [x] Orchestrator run lifecycle with dependency gating, serial steps, cancellation, explicit retry, and checkpoints.
4. [x] Guarded step executor: policy preflight, actor binding, exact approval, RuntimeEngine, ToolGateway, and ExecutionGuard.
5. [x] Typed filesystem action proposals persisted with plan steps and copied into runs. Supported actions: read, list, mkdir, write.
   [x] Typed browser open and constrained terminal run actions with exact approval requirements.
6. [x] CLI can execute the saved plan action without hand-written JSON. Typed-action steps cannot be marked successful through manual bookkeeping.
7. [x] Built-in advisory-only profiles: assistant, brand designer, business operator, developer, research analyst, marketing strategist, and project manager. They use the local model and relevant memory but have no tools.
8. [x] Explicit manual recovery of one interrupted in-flight step after the user confirms the prior process has stopped. Side effects remain unknown; recovery never retries automatically.
9. [ ] Independent multi-agent delegation, inter-agent messaging, and independent agent work queues. A sequential advisory team-synthesis endpoint exists in the local dashboard.
10. [ ] Tool-enabled Research and Developer agents, followed by other specialists, with independent scoped capabilities. Planner can currently propose only typed filesystem, browser-open, and bounded terminal actions.

**Current limits:** cancellation is permitted only between steps; an in-flight step cannot be marked skipped while its handler may still be running. Stop the prior process and use explicit interrupted-run recovery before deciding whether to retry. Guarded plan execution registers filesystem, isolated browser navigation/text extraction, and a bounded terminal adapter. Browser and terminal actions require exact one-time approval by default. Specialist profiles remain advisory-only; the dashboard can run two or three specialists sequentially and synthesize their advice, but agents do not independently invoke tools. Unsupported plan steps remain manual. Terminal process isolation is not OS-level and spawned descendants may outlive the direct process timeout. Browser actions do not reuse the normal browser profile or support clicks/forms/downloads.

## Phase 5 — Browser and computer control

1. [x] Isolated Chromium/Edge launch, public URL navigation, bounded visible-text extraction, CSS-selector click/type, and allowlisted keypresses through a dedicated profile.
2. [~] Top-level public URL validation, private/reserved address rejection, download denial, and a separate profile. Full redirect/subresource network isolation and account/session controls remain open.
3. [x] Windows UI Automation adapter behind the tool gateway: inspect controls, invoke a uniquely matched control, set a value, and capture a bounded window screenshot.
4. [x] Exact one-time approval for each consequential browser and computer action.
5. [ ] Coordinate-based input, unrestricted keyboard shortcuts, broader application compatibility, and robust recovery.

**Acceptance:** browser research works in isolation; consequential actions remain approval-gated; desktop actions are logged and recoverable.

## Phase 6 — Workspace and integrations

1. [x] Installable local PWA workspace with standalone display mode and local session cookie. Native desktop packaging and process lifecycle remain open.
2. [x] Initial project/task/run/memory/approval/permission/audit dashboard views plus user-initiated public web search.
3. [~] Basic permission rule editor exists; provider configuration and comprehensive settings remain open.
4. [x] Initial local stdio MCP integration bridge with explicit environment-variable pass-through and exact approval for each tool call.
   [ ] Built-in OAuth flows, remote HTTP MCP transports, persistent MCP server lifecycle, and provider-specific integration UX.
5. [x] Backup restore with schema-version validation, staged-file verification, atomic replacement, and rollback protection. A broader application upgrade workflow remains open.

**Acceptance:** projects and agent work can be managed and reviewed from one local interface.

## Engineering rules

- Work on `dev`; protect `main` as the stable branch.
- Use small commits with descriptive messages.
- Run typecheck, build, and tests before pushing; add lint when a lint configuration is introduced.
- Never commit credentials, databases, logs, personal files, model caches, runtime binaries, or backups.
- Do not delete or overwrite user data during migrations.
- Prefer additive migrations and create a verified backup before destructive schema changes.
- Every tool must declare inputs, outputs, capabilities, side effects, and risk level.
- Every consequential action must be authorized by the central policy service.
- Treat external content and model output as untrusted input.
