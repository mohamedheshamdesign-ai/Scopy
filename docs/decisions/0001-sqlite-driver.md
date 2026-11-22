# ADR 0001: SQLite driver for the first Scopy core

- **Status:** Accepted for the initial implementation; subject to integration testing.
- **Date:** 2026-11-22

## Context

Scopy targets local-first operation on Windows 11 with Node.js 24. The database must remain inside the Scopy home directory, require no hosted service, support transactions and migrations, and install reliably without asking the user to configure a native compiler toolchain.

Node.js also provides `node:sqlite`, but the Node.js v24 documentation currently labels that API a release candidate (Stability 1.2). We will avoid making the first persistent data layer depend on a runtime API that is not yet stable.

## Decision

Use `better-sqlite3@12.11.1` behind Scopy-owned database and repository interfaces. The v12 line includes Node.js 24 prebuilt binary support. Keep SQL and driver-specific behavior inside `src/db`; application services must depend on repositories, not on the driver.

## Operational constraints

- Database location defaults to `<SCOPY_HOME>\\data\\scopy.sqlite`.
- Enable WAL, foreign keys, a bounded busy timeout, and transactional migrations.
- Never commit database files, WAL files, or user data.
- Keep transactions synchronous and short. Never perform network or model calls inside a database transaction.
- If installation fails on the target Windows machine, stop and diagnose the native binding before changing Node versions or installing build tools.

## Revisit when

- Scopy adopts Electron or another runtime with a different native module ABI.
- Database work becomes long-running or high-contention.
- Node.js `node:sqlite` reaches stable status and provides a clear maintenance advantage.
