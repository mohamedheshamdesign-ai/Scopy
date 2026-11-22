import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { Script } from "node:vm";
import { dashboardHtml } from "../src/dashboard/dashboard-html.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { DashboardServer } from "../src/dashboard/dashboard-server.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("dashboard uses loopback auth, issues an HttpOnly session, and serves a PWA shell", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "scopy-dashboard-test-"));
  const config = loadConfig(home);
  const database = openDatabase(config);
  const port = await freePort();
  const dashboard = new DashboardServer(config, database, { port });
  const originalLog = console.log;
  console.log = () => undefined;
  const started = dashboard.start();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/api/health");
        if (response.ok) { ready = true; break; }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.equal(ready, true, "dashboard should start on loopback");

    const unauthorized = await fetch("http://127.0.0.1:" + port + "/api/state");
    assert.equal(unauthorized.status, 401);

    const hostileHostStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest("http://127.0.0.1:" + port + "/api/health", {
        headers: { host: "attacker.example" },
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      req.once("error", reject);
      req.end();
    });
    assert.equal(hostileHostStatus, 403);

    const token = readFileSync(join(home, "secrets", "dashboard-token.txt"), "utf8").trim();
    const session = await fetch("http://127.0.0.1:" + port + "/api/session", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
    });
    assert.equal(session.status, 204);
    const setCookie = session.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0]!;

    const state = await fetch("http://127.0.0.1:" + port + "/api/state", {
      headers: { cookie },
    });
    assert.equal(state.status, 200);
    const payload = await state.json() as { agents: unknown[]; mcpServers: unknown[]; safetyProfile: string };
    assert.equal(payload.agents.length, 7);
    assert.deepEqual(payload.mcpServers, []);
    assert.equal(payload.safetyProfile, "strict");

    const manifest = await fetch("http://127.0.0.1:" + port + "/manifest.webmanifest");
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json() as { display: string }).display, "standalone");
    const worker = await fetch("http://127.0.0.1:" + port + "/sw.js");
    assert.equal(worker.status, 200);
    assert.match(await worker.text(), /scopy-shell-v1/);
  } finally {
    console.log = originalLog;
    dashboard.close();
    await started;
    database.close();
    rmSync(home, { recursive: true, force: true });
  }
});


test("dashboard inline client script parses as JavaScript", () => {
  const match = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match?.[1], "dashboard should contain its inline client script");
  assert.doesNotThrow(() => new Script(match[1]!));
});
