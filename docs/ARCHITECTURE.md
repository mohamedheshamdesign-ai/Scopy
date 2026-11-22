# Scopy Architecture

**Status:** Initial architecture baseline (v0.1)  
**Repository:** `mohamedheshamdesign-ai/Scopy`  
**Development branch:** `dev`

## 1. Product definition

Scopy is a local-first personal AI operating system for research, planning, creative work, business operations, software development, and approved computer actions. It is not a single chatbot and must not depend on one model provider or one agent framework.

The system should support English and Egyptian Arabic, preserve user-controlled memory, and run on the user's Windows machine. Cloud services are optional integrations, never an implicit requirement.

## 2. Architectural principles

1. **Local-first:** project data, memory, logs, and configuration live under the Scopy data directory by default.
2. **Explicit egress:** network access and cloud model use are visible, configurable, and attributable to a task.
3. **Policy before execution:** every tool call is checked by a central permission service. Prompts are not a security boundary.
4. **Approval for consequential actions:** sending messages, publishing, purchases/payments, permanent deletion, credential changes, and security-sensitive system changes require explicit approval.
5. **Auditable execution:** tasks, plans, tool calls, approvals, failures, and results have traceable IDs and timestamps.
6. **Provider independence:** model providers are adapters behind a common interface. Routing, fallback, and capability checks are centralized.
7. **Replaceable components:** agents, tools, storage adapters, and UI must not own business rules that belong in the core.
8. **Incremental delivery:** build and test a narrow vertical slice before adding more agents or integrations.

## 3. High-level system

```text
User
  |
  v
Scopy Workspace / CLI (initial interface)
  |
  v
Application API
  |
  +--> Orchestrator
  |      +--> Planner
  |      +--> Task / Run State
  |      +--> Agent Registry
  |      +--> Checkpoint & Retry Policy
  |
  +--> Policy & Approval Service
  |
  +--> AI Router
  |      +--> Local providers
  |      +--> Optional cloud providers (explicit opt-in)
  |
  +--> Memory Service
  |      +--> Working / episodic / semantic / project memory
  |      +--> Retrieval and provenance
  |
  +--> Tool Gateway
         +--> Filesystem
         +--> Browser
         +--> Terminal
         +--> Windows computer control
         +--> External integrations

Shared infrastructure:
  SQLite + local files + structured logs + evaluation
```

## 4. Core boundaries

- **Orchestrator:** owns run lifecycle, delegation, ordering, cancellation, and recovery. It does not directly implement browser or filesystem operations.
- **Planner:** turns a user goal into a typed plan with steps, dependencies, expected outputs, and risk classifications. A plan is a proposal, not permission.
- **Runtime:** executes approved steps, applies timeouts and resource limits, records outputs, and supports checkpoints.
- **Policy service:** evaluates actor, tool, action, target, scope, and risk. It returns allow, deny, or approval-required. Tool adapters must not bypass it.
- **AI Router:** selects a registered provider/model using capability, availability, privacy, latency, context, and configured budget constraints. The initial implementation is local-only by default, restricts the first adapter to loopback, and requires an explicit per-request cloud egress opt-in with audit events. It must not silently send private data to a cloud provider.
- **Memory:** stores facts with source, timestamp, confidence, scope, and retention metadata. Retrieval must distinguish user-confirmed facts from inferred or temporary context. The initial implementation uses bounded lexical retrieval; embeddings are deferred until evaluation demonstrates a need.
- **Tool Gateway:** exposes narrow, typed capabilities. Tools receive scoped access rather than unrestricted machine access.
- **Evaluation:** tests task quality, policy compliance, tool reliability, latency, and resource usage.

## 5. Agent model

Agents are specialists with declared capabilities, instructions, input/output schemas, and permitted tools. Initial candidates:

- Research
- Business
- Design
- Marketing
- Developer
- Operations

An agent is not an independent security authority. All agents use the same orchestrator, AI router, memory interface, and policy service. Delegation must be explicit and observable; sequentially running a list of prompts is not considered multi-agent collaboration.

## 6. Storage model

- SQLite is the source of truth for structured entities: projects, tasks, runs, plans, approvals, tool executions, provider settings, and memory metadata.
- Documents, images, exports, and other large binary assets remain ordinary files under the Scopy data directory. SQLite stores references and metadata.
- Database migrations are versioned and reversible where practical.
- Secrets must not be stored in plaintext configuration, SQLite, logs, or Git. Use the operating system credential store or an encrypted vault.
- Backups must be local by default, versioned, and test-restorable.

The SQLite driver is intentionally not locked in this document. Before selection, benchmark Windows installation reliability, Node compatibility, transaction behavior, backup support, and maintenance status.

## 7. Computer access and isolation

- Browser automation should use a dedicated browser context/profile with explicit download and domain controls.
- Filesystem access should be restricted to configured workspace roots by default.
- Terminal execution should use command allowlists or per-command approval, with working-directory and timeout constraints.
- Windows UI automation should run behind a separate adapter and require explicit approval for actions that affect external accounts, system settings, or user data.
- Untrusted page content, documents, code, and tool output are data, not instructions. They cannot change Scopy's policies.

## 8. Initial technology direction

- Runtime: Node.js 24+ and TypeScript, subject to local compatibility checks.
- Initial interface: CLI and developer scripts; choose a desktop UI after core contracts stabilize.
- Tests: unit tests for core logic, integration tests for storage and adapters, and policy regression tests.
- Database: SQLite behind a repository interface; driver selection is a measured decision.
- No mandatory cloud API, hosted database, or paid subscription.

## 9. Repository structure

```text
Scopy/
  apps/
    desktop/             # future desktop workspace
  core/
    orchestrator/
    planner/
    runtime/
    permissions/
    ai-router/
    memory/
    evaluation/
  agents/
    research/
    business/
    design/
    marketing/
    developer/
    operations/
  tools/
    browser/
    computer/
    filesystem/
    terminal/
    mcp/
  integrations/
    providers/
    external-apps/
  packages/
  skills/
  data/                  # local runtime data; never commit user data
  tests/
  scripts/
  docs/
  backups/               # local backups; never commit backup contents
```

## 10. Non-goals for the first milestone

- No unrestricted autonomous desktop control.
- No automatic social publishing, sending messages, payments, or purchases.
- No self-modifying source code or silent self-updates.
- No large multi-agent framework before the core execution and policy contracts exist.
- No embeddings/vector database until retrieval evaluations demonstrate a need.
- No cloud dependency for startup, memory, or basic task management.

## 11. Implemented AI and memory baseline

- Provider contract describes provider boundary, models, and capabilities.
- Initial OpenAI-compatible adapter accepts only HTTP loopback endpoints and supports non-streaming chat plus a basic health check.
- Provider router validates model registration and records cloud egress authorization/denial. There is no automatic provider failover.
- Memory records include type, scope, content, source type/reference, confidence, status, timestamps, and optional expiry.
- Initial retrieval is lexical and deterministic, with global plus project-scope filtering. Archived and expired records are excluded.
- Cloud adapters, streaming, tool calling, vision, automatic memory extraction, embeddings, and consolidation remain unimplemented.
