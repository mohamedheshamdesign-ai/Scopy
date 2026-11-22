import { spawn } from "node:child_process";
import type { ActionRequest } from "../permissions/types.js";
import { ToolGateway } from "./tool-gateway.js";

interface ComputerPayload {
  readonly automationId?: string;
  readonly name?: string;
  readonly value?: string;
  readonly limit?: number;
}

const POWERSHELL_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$raw = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SCOPY_COMPUTER_REQUEST))
$request = $raw | ConvertFrom-Json
$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$windowMatches = @()
foreach ($candidate in $windows) {
  if ($candidate.Current.Name -ceq [string]$request.windowTitle) { $windowMatches += $candidate }
}
if ($windowMatches.Count -ne 1) { throw "The exact window title must match one top-level window." }
$window = $windowMatches[0]
switch ([string]$request.action) {
  'snapshot' {
    $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $limit = [Math]::Min([int]$request.limit, 300)
    $items = @()
    for ($i = 0; $i -lt [Math]::Min($elements.Count, $limit); $i++) {
      $element = $elements.Item($i)
      $items += [pscustomobject]@{
        name = $element.Current.Name
        automationId = $element.Current.AutomationId
        controlType = $element.Current.ControlType.ProgrammaticName
        enabled = $element.Current.IsEnabled
        offscreen = $element.Current.IsOffscreen
      }
    }
    @{ windowTitle = $window.Current.Name; controls = $items; truncated = ($elements.Count -gt $limit) } | ConvertTo-Json -Depth 6 -Compress
  }
  'invoke' {
    if ($request.automationId) { $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, [string]$request.automationId) }
    else { $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, [string]$request.name) }
    $foundControls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($foundControls.Count -ne 1) { throw "Target control must match exactly one element." }
    $element = $foundControls.Item(0)
    if (-not $element.Current.IsEnabled) { throw "Target control is disabled." }
    $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    @{ invoked = $true; windowTitle = $window.Current.Name; name = $element.Current.Name; automationId = $element.Current.AutomationId } | ConvertTo-Json -Depth 4 -Compress
  }
  'set_value' {
    if ($request.automationId) { $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, [string]$request.automationId) }
    else { $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, [string]$request.name) }
    $matches = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($matches.Count -ne 1) { throw "Target control must match exactly one element." }
    $element = $matches.Item(0)
    if (-not $element.Current.IsEnabled) { throw "Target control is disabled." }
    $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($pattern.Current.IsReadOnly) { throw "Target control is read-only." }
    $pattern.SetValue([string]$request.value)
    @{ valueSet = $true; windowTitle = $window.Current.Name; name = $element.Current.Name; automationId = $element.Current.AutomationId } | ConvertTo-Json -Depth 4 -Compress
  }
  default { throw "Unsupported computer action." }
}
`;

function validate(request: ActionRequest): ComputerPayload {
  if (!["snapshot", "invoke", "set_value"].includes(request.action)) throw new Error("Unsupported Windows computer action.");
  const payload = request.payload ?? {};
  if (request.action === "snapshot") {
    if (Object.keys(payload).some((key) => key !== "limit")) throw new Error("Snapshot payload supports only limit.");
    const limit = payload.limit ?? 100;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error("Snapshot limit must be between 1 and 300.");
    return { limit };
  }
  const keys = request.action === "invoke" ? ["automationId", "name"] : ["automationId", "name", "value"];
  if (Object.keys(payload).some((key) => !keys.includes(key))) throw new Error("Computer action payload contains unsupported fields.");
  const automationId = payload.automationId;
  const name = payload.name;
  if ((typeof automationId === "string" && automationId.length > 256) ||
      (typeof name === "string" && name.length > 256) ||
      ((typeof automationId !== "string" || !automationId.trim()) === (typeof name !== "string" || !name.trim()))) {
    throw new Error("Provide exactly one bounded automationId or exact control name.");
  }
  if (request.action === "invoke") return {
    ...(typeof automationId === "string" ? { automationId } : {}),
    ...(typeof name === "string" ? { name } : {}),
  };
  if (typeof payload.value !== "string" || payload.value.length > 10000) throw new Error("set_value requires a string value up to 10000 characters.");
  return {
    ...(typeof automationId === "string" ? { automationId } : {}),
    ...(typeof name === "string" ? { name } : {}),
    value: payload.value,
  };
}

export class WindowsComputerTool {
  register(gateway: ToolGateway): void {
    gateway.register(
      "computer",
      "Inspect Windows UI Automation controls and invoke or set a uniquely identified control. Every action requires exact approval.",
      (request) => this.handle(request),
    );
  }

  private async handle(request: ActionRequest): Promise<unknown> {
    if (process.platform !== "win32") throw new Error("Windows computer control is available only on Windows.");
    const windowTitle = request.target.trim();
    if (!windowTitle || windowTitle.length > 200) throw new Error("Computer target must be an exact top-level window title.");
    const payload = validate(request);
    const requestJson = JSON.stringify({ windowTitle, action: request.action, ...payload });
    const encoded = Buffer.from(requestJson, "utf8").toString("base64");
    const script = Buffer.from(POWERSHELL_SCRIPT, "utf16le").toString("base64");
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    env.SCOPY_COMPUTER_REQUEST = encoded;
    const startedAt = Date.now();
    return await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script], {
        shell: false, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let size = 0;
      let settled = false;
      const finish = (error?: Error, result?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("Windows computer action exceeded its 20-second timeout."));
      }, 20_000);
      const collect = (chunk: Buffer, stream: "stdout" | "stderr"): void => {
        size += chunk.length;
        if (size > 48 * 1024) {
          child.kill();
          finish(new Error("Windows computer action output exceeded 48 KiB."));
          return;
        }
        if (stream === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
      child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
      child.once("error", finish);
      child.once("close", (code) => {
        if (code !== 0) {
          finish(new Error("Windows UI Automation failed: " + stderr.slice(0, 2000)));
          return;
        }
        try {
          const output = JSON.parse(stdout.trim()) as unknown;
          finish(undefined, { output, durationMs: Date.now() - startedAt });
        } catch {
          finish(new Error("Windows UI Automation returned invalid JSON: " + stdout.slice(0, 1000)));
        }
      });
    });
  }
}
