# Scopy Local Workspace

## Start

From the Scopy repository root:

~~~powershell
npm run dev -- app start
~~~

Open the printed http://127.0.0.1:4317 URL. Keep the PowerShell window open. Stop the app with Ctrl+C. The app binds only to loopback and uses the existing Scopy SQLite database and configured workspace.

The default app port is 4317. A different port can be supplied:

~~~powershell
npm run dev -- app start 4320
~~~

The app creates a random session token in memory and injects it into the served page. API requests require that token. Responses use no-store, nosniff, no-referrer, and a restrictive content security policy. The server rejects non-local Host headers and cross-site requests. It does not expose a remote listener or implement multi-user authentication.

## Included areas

- Overview, tasks, projects, and local memory.
- Local model chat with the built-in specialist profiles.
- Sequential multi-specialist analysis and synthesis. The specialists share the same configured local model and are run sequentially to avoid overloading a single local inference sequence.
- Public web search through DuckDuckGo HTML. Only the user-entered search query is sent; Scopy memory and private workspace files are not attached.
- Read-only browser page extraction using Chrome or Edge in a separate profile below SCOPY_HOME. The browser opens public HTTP(S) URLs and extracts the page title, final URL, and bounded visible text.
- A fixed terminal command set: Git status/diff/recent log, Node version, and npm check/build/test.
- Plan review, guarded plan execution, and pending action approval review.

## Browser boundary

The browser profile is separate from the user's everyday Chrome/Edge profile. Scopy does not import personal cookies or saved sessions. The browser tool supports opening a public URL, reading page text, clicking a CSS-selected element, typing into a CSS-selected input/contenteditable field, and sending a small allowlist of keys. Every navigation and interaction requires a separate exact approval. Downloads are denied through the browser protocol. It does not sign in to accounts or reuse personal browser cookies.

The requested and final top-level URLs are checked for HTTP(S), credentials, localhost, and private/reserved DNS addresses. This check is not an OS-level network sandbox: redirects and subresource requests are still handled by Chromium before the final URL is checked. Do not use this first browser adapter for sensitive internal networks or authenticated accounts.

Every browser navigation is policy-gated. In the Browser tab, choose Enable approval-gated browser to save an approval_required rule for browser navigation. Each requested page then creates an exact, one-time approval. Approving it starts that navigation.

## Terminal boundary

The terminal adapter does not accept arbitrary shell text or arbitrary executable names. It exposes only the command IDs in the dashboard: git-status, git-diff, git-log, node-version, npm-check, npm-build, and npm-test. Commands run with shell disabled except the fixed, non-user-controlled npm command wrapper required on Windows. The child process receives a reduced environment and is scoped to the configured workspace directory. Output is capped and execution is timed.

In the Terminal tab, choose Enable approval-gated terminal to save an approval_required rule scoped to the configured workspace. Each command still creates a separate exact-action approval. Do not add a broad allow rule for terminal execution.

## Approval model

Approving a generated plan authorizes the plan to start; it does not authorize any tool action. Each supported filesystem, browser, or terminal action is evaluated again by the central policy engine. When a rule requires approval, Scopy records the exact actor, tool, action, target, and payload fingerprint. The approval is one-time and is consumed before the handler runs.

The local app resumes an in-memory pending browser or terminal action after approval. If Scopy is closed while an approval is pending, the pending approval remains in SQLite but the in-memory action mapping is lost; reject that stale approval and submit the action again after restarting Scopy. Do not assume it executed.

## Current limits

- Built-in agents remain advisory profiles. Multi-specialist delegation is sequential analysis/synthesis, not independent tool-enabled agents or background work queues.
- Local chat is non-streaming and uses the configured local model. There is no automatic cloud fallback.
- Memory retrieval remains bounded lexical search.
- Browser interaction is approval-gated and limited to URL open/read, selector click/type, and approved keypresses. Downloads are blocked; this is not a general-purpose desktop browser or authenticated account automation system.
- Terminal access is a fixed command allowlist, not an unrestricted shell.
- Windows-wide mouse/keyboard control and screenshots are not implemented.
- Third-party account integrations (including Facebook), credentials vaulting, and external app synchronization are not implemented.
- This is a local single-user application, not a hardened multi-user network service.

Do not interpret a visible dashboard or successful HTTP response as proof that all planned integrations are implemented. Keep docs/IMPLEMENTATION_PLAN.md as the source of truth for deferred milestones.
