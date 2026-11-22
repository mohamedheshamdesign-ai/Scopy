# Scopy Repository Inventory

**Branch checked:** `dev`  
**Inventory basis:** Git tree for the `dev` branch, inspected on 2026-11-22.  
**Purpose:** This file records paths that actually exist in the tracked repository. It is not a target architecture.

## Tracked repository paths

```text
.gitignore
.nvmrc
README.md
backups/.gitkeep
data/.gitkeep
docs/ARCHITECTURE.md
docs/IMPLEMENTATION_PLAN.md
docs/LOCAL_AI_WINDOWS.md
docs/decisions/0001-sqlite-driver.md
package.json
scripts/connect-local-ai.ps1
scripts/inspect-local-ai.ps1
scripts/start-local-ai.ps1
src/ai/chat-context.ts
src/ai/create-local-router.ts
src/ai/local-openai-provider.ts
src/ai/provider-router.ts
src/ai/types.ts
src/cli.ts
src/config.ts
src/db/database.ts
src/memory/memory-repository.ts
src/permissions/approval-service.ts
src/permissions/execution-guard.ts
src/permissions/permission-repository.ts
src/permissions/policy-engine.ts
src/permissions/types.ts
src/runtime/runtime-engine.ts
src/tasks/task-repository.ts
src/tools/filesystem-tool.ts
src/tools/tool-gateway.ts
tests/ai-router.test.ts
tests/chat-context.test.ts
tests/local-router-timeout.test.ts
tests/memory-repository.test.ts
tests/permissions.test.ts
tests/runtime-engine.test.ts
tests/task-repository.test.ts
tests/tool-gateway.test.ts
tsconfig.json
```

## Important distinctions

- The source tree uses `src/...`, not the proposed `core/...` layout shown in the architecture document.
- `backups/` and `data/` currently contain only `.gitkeep` placeholders in Git. Runtime data and backup contents are not represented by those placeholders.
- `docs/ARCHITECTURE.md` describes the intended system design and includes a proposed future directory layout. Those paths are not evidence that those directories or modules exist.
- The presence of a test file proves only that a test file is tracked. It does not prove that tests currently pass.
- This is a snapshot. Re-check the Git tree before making claims about paths added or removed later.
