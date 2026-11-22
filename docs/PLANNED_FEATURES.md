# Scopy Planned Features

**Source:** `docs/IMPLEMENTATION_PLAN.md` and the target architecture.  
**Rule:** Items in this document are plans, not implemented capabilities. Do not present them as available features until source code and tests provide direct evidence.

## Phase 0 — Engineering baseline
- Complete architecture and implementation documentation.
- Complete repeatable project scripts and CI validation.
- Confirm clean-install, typecheck, lint, and test workflow in CI.

## Phase 2 — Controlled execution hardening
- Harden filesystem isolation against local race conditions.
- Add OS-level isolation where appropriate.
- Add authenticated reviewer identity and a local approval interface.

## Phase 3 — AI routing and memory
- Record device-specific speed/RAM/VRAM/context measurements.
- Run controlled GPU-offload, KV-cache, Flash Attention, and speculative-decoding comparisons.
- Add automatic memory extraction/consolidation and richer retrieval evaluation.
- Consider cloud provider adapters, streaming, and tool calling only after explicit policy and data-boundary review.

## Phase 4 — Orchestration and specialist agents
- Plan schema and validation.
- Orchestrator run lifecycle.
- Agent registry and capability declarations.
- Delegation, dependencies, and checkpoint recovery.
- Plan-quality and execution-outcome evaluation.
- Research and Developer agents first, then other specialists based on real workflows.

## Phase 5 — Browser and computer control
- Browser automation in an isolated context.
- Domain, download, and session controls.
- Windows computer adapter behind the tool gateway.
- Per-action risk checks, explicit approvals, recovery, and evidence capture.

## Phase 6 — Workspace and integrations
- Desktop workspace.
- Project/task/run/memory views.
- Provider and permission settings.
- Opt-in scoped external integrations.
- Backup, restore, diagnostics, and upgrade workflow.

## How to update this file
Move an item out of this list only after:
1. The implementation exists in the tracked source tree.
2. Relevant tests exist and have been run successfully.
3. The implemented feature document records exact source and test paths.
4. Limitations are documented honestly.

Do not treat an architecture diagram, directory proposal, TODO, or plan checkbox as implementation evidence.
