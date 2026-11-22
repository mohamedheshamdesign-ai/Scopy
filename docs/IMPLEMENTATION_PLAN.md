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
- [ ] Add architecture and implementation documentation.
- [ ] Add Node/TypeScript project configuration and repeatable scripts.
- [ ] Add automated test runner and CI validation.
- [ ] Confirm the actual Node.js version and package manager on the target PC.

**Acceptance:** clean install, typecheck, lint, and tests run locally and in CI; no local data or secrets are tracked.

## Phase 1 — Core foundation

Implement only the contracts and infrastructure required for a first working vertical slice:

1. Typed application configuration with validation and safe defaults.
2. Structured logging with secret redaction.
3. Stable error types and error serialization.
4. SQLite adapter interface and migration runner.
5. Repository layer for projects and tasks.
6. Run/task IDs, timestamps, status transitions, and audit events.
7. Unit and integration tests.

**Acceptance:** create, list, update, and complete a task locally; restart Scopy and verify persistence; migration and backup tests pass.

## Phase 2 — Controlled execution

1. Typed tool contract and tool registry.
2. Central policy decision interface: allow, deny, approval required.
3. Approval records bound to a specific action and target.
4. Runtime with timeout, cancellation, output limits, and checkpoints.
5. Filesystem tool restricted to configured workspace roots.

**Acceptance:** safe read/write task succeeds inside the workspace; traversal and out-of-scope writes are denied; approval-required actions cannot execute before approval.

## Phase 3 — AI routing and memory

1. Provider adapter interface.
2. Local provider integration first.
3. Explicit cloud-provider opt-in and egress audit.
4. Model capability registry and health checks.
5. Working and project memory with provenance.
6. Retrieval evaluation set before adding embeddings.

**Acceptance:** route a task to a configured local model; handle provider unavailable state; no silent cloud fallback; memory results expose source and confidence.

## Phase 4 — Orchestration and specialist agents

1. Plan schema and validation.
2. Orchestrator run lifecycle.
3. Agent registry and capability declarations.
4. Delegation, dependencies, and checkpoint recovery.
5. Evaluation of plan quality and execution outcomes.
6. Add Research and Developer agents first, then expand based on real workflows.

**Acceptance:** one multi-step task is planned, reviewed, executed, checkpointed, and reported with a complete audit trail.

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
