import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpServerManager } from "../src/integrations/mcp/mcp-server-manager.js";

const fakeServer = [
  "const readline=require('node:readline');",
  "const rl=readline.createInterface({input:process.stdin});",
  "rl.on('line',line=>{",
  "  const message=JSON.parse(line);",
  "  if(message.id===undefined)return;",
  "  let result={};",
  "  if(message.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'scopy-test',version:'1'}};",
  "  else if(message.method==='tools/list')result={tools:[{name:'echo',description:'Echo JSON arguments',inputSchema:{type:'object',properties:{value:{type:'string'}}}}]};",
  "  else if(message.method==='tools/call')result={content:[{type:'text',text:JSON.stringify(message.params.arguments)}],isError:false};",
  "  else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}})+'\\n');return;}",
  "  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');",
  "});",
].join("\n");

test("MCP manager starts an opt-in stdio server, discovers tools, and binds approvals to config", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-mcp-test-"));
  try {
    const manager = new McpServerManager(home);
    await manager.add({
      id: "test-server",
      command: "node",
      args: ["-e", fakeServer],
      passEnv: [],
      timeoutMs: 10000,
    });
    const tools = await manager.listTools("test-server");
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "echo");

    const fingerprint = await manager.getServerFingerprint("test-server");
    const result = await manager.callTool("test-server", "echo", { value: "works" }, fingerprint) as {
      content: Array<{ text: string }>;
    };
    assert.equal(result.content[0]?.text, '{"value":"works"}');

    const configPath = join(home, "secrets", "mcp-servers.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Array<Record<string, unknown>>;
    config[0]!.args = ["-e", "process.exit(1)"];
    await writeFile(configPath, JSON.stringify(config), "utf8");
    await assert.rejects(
      manager.callTool("test-server", "echo", { value: "changed" }, fingerprint),
      /configuration changed after approval/,
    );
    assert.equal(await manager.remove("test-server"), true);
    assert.deepEqual(await manager.list(), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("MCP manager rejects arbitrary executables and invalid environment variable names", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-mcp-validation-"));
  try {
    const manager = new McpServerManager(home);
    await assert.rejects(manager.add({
      id: "unsafe-server", command: "cmd.exe", args: [], passEnv: [], timeoutMs: 5000,
    }), /must be node, python, or powershell/);
    await assert.rejects(manager.add({
      id: "bad-env", command: "node", args: ["server.js"], passEnv: ["GITHUB_TOKEN;Write-Host"], timeoutMs: 5000,
    }), /environment variable names/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
