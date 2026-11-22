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
- Independent multi-agent delegation, inter-agent messaging, and agent work queues (dashboard team synthesis is sequential/advisory only).
- Tool-enabled Research and Developer agents with separately scoped browser/terminal/filesystem capabilities.
- Plan-quality and execution-outcome evaluation.

## Phase 5 — Browser and computer control
- Expand the isolated browser beyond navigation/text extraction to reviewed clicks, forms, downloads, and explicit session controls.
- Domain allowlists, download quarantine, and session isolation.
- Expand the initial UI Automation adapter with screenshots, coordinate/keyboard input where safe, broader app compatibility, and recovery/evidence capture.
- Per-action risk checks and explicit approvals for all desktop operations.

## Phase 6 — Workspace and integrations
- Native desktop packaging and lifecycle.
- Expand dashboard provider/permission settings and local workspace views.
- Built-in OAuth flows and remote HTTP MCP transports.
- Provider-specific integration UX, persistent server lifecycle/health management, and more granular tool capability scopes.
- Full application upgrade workflow. Backup creation, verification, and guarded restore are implemented.

## How to update this file
Move an item out of this list only after:
1. The implementation exists in the tracked source tree.
2. Relevant tests exist and have been run successfully.
3. The implemented feature document records exact source and test paths.
4. Limitations are documented honestly.

Do not treat an architecture diagram, directory proposal, TODO, or plan checkbox as implementation evidence.
