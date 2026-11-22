import { spawn, type ChildProcess } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}

interface CdpTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

interface CdpResponse {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string };
}

function browserExecutable(): string | undefined {
  const candidates = [
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"]!, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : "",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const a = parts[0] ?? 0; const b = parts[1] ?? 0;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 203 && b === 0));
  }
  const value = address.toLowerCase();
  return !(value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") ||
    value.startsWith("feb") || value.startsWith("ff") || value.startsWith("::ffff:"));
}

async function validateUrl(value: string): Promise<string> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Provide a valid public HTTP/HTTPS URL."); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Browser navigation accepts only public HTTP/HTTPS URLs without embedded credentials.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Browser navigation to local hostnames is blocked.");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error("Browser navigation to private or reserved network addresses is blocked.");
  }
  return url.toString();
}

export class LocalBrowserSession {
  private process: ChildProcess | undefined;
  private socket: SocketLike | undefined;
  private target: CdpTarget | undefined;
  private activeUrl: string | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: CdpResponse) => void; reject: (error: Error) => void }>();
  private readonly port: number;

  constructor(private readonly homeDirectory: string, port = Number(process.env.SCOPY_BROWSER_PORT ?? "9222")) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Browser debugging port must be between 1024 and 65535.");
    this.port = port;
  }

  status(): { running: boolean; browser: string | null; activeUrl: string | null; isolatedProfile: string } {
    return {
      running: Boolean(this.process && this.process.exitCode === null),
      browser: this.process ? "isolated Chromium session" : null,
      activeUrl: this.activeUrl,
      isolatedProfile: join(this.homeDirectory, "browser-profile"),
    };
  }

  async start(): Promise<{ browser: string; profile: string; port: number }> {
    if (this.process && this.process.exitCode === null) {
      await this.waitForEndpoint();
      return { browser: "isolated Chromium session", profile: join(this.homeDirectory, "browser-profile"), port: this.port };
    }
    if (process.platform !== "win32") throw new Error("The managed browser launcher currently targets Windows.");
    const endpoint = "http://127.0.0.1:" + this.port + "/json/version";
    try {
      const existing = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
      if (existing.ok) throw new Error("Browser debugging port " + this.port + " is already occupied. Choose another SCOPY_BROWSER_PORT; Scopy will not attach to an existing browser.");
    } catch (error) {
      if (error instanceof Error && error.message.includes("already occupied")) throw error;
    }
    const executable = browserExecutable();
    if (!executable) throw new Error("Chrome or Microsoft Edge was not found in its standard Windows installation path.");
    const profile = join(this.homeDirectory, "browser-profile");
    await mkdir(profile, { recursive: true });
    this.process = spawn(executable, [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=" + this.port,
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--new-window",
      "about:blank",
    ], { detached: false, windowsHide: false, stdio: "ignore" });
    this.process.once("exit", () => {
      this.socket?.close();
      this.socket = undefined;
      this.target = undefined;
      for (const item of this.pending.values()) item.reject(new Error("Managed browser process exited."));
      this.pending.clear();
    });
    await this.waitForEndpoint();
    return { browser: "isolated Chromium session", profile, port: this.port };
  }

  async open(input: string): Promise<{ url: string; title: string; text: string }> {
    const url = await validateUrl(input);
    await this.start();
    const response = await fetch("http://127.0.0.1:" + this.port + "/json/new?about:blank", {
      method: "PUT",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Browser could not create a new tab (HTTP " + response.status + ").");
    const target = await response.json() as CdpTarget;
    if (!target.webSocketDebuggerUrl) throw new Error("Browser target did not expose a DevTools WebSocket.");
    this.socket?.close();
    this.target = target;
    await this.connect(target.webSocketDebuggerUrl);
    await this.command("Page.enable");
    await this.command("Runtime.enable");
    await this.command("Page.setDownloadBehavior", { behavior: "deny" });
    this.activeUrl = url;
    await this.command("Page.navigate", { url });
    await this.waitForDocument();
    return this.read();
  }

  async read(): Promise<{ url: string; title: string; text: string }> {
    if (!this.socket || !this.target) throw new Error("No managed browser page is open. Open a URL first.");
    const response = await this.command("Runtime.evaluate", {
      expression: "({url: location.href, title: document.title, text: (document.body && document.body.innerText || '').slice(0, 20000)})",
      returnByValue: true,
      awaitPromise: true,
    });
    const result = response.result?.result as { value?: unknown } | undefined;
    const value = result?.value;
    if (typeof value !== "object" || value === null) throw new Error("Browser page did not return readable document content.");
    const page = value as Record<string, unknown>;
    if (typeof page.url === "string") this.activeUrl = await validateUrl(page.url);
    return {
      url: this.activeUrl ?? this.target.url,
      title: typeof page.title === "string" ? page.title : "",
      text: typeof page.text === "string" ? page.text : "",
    };
  }

  async click(selector: string): Promise<{ url: string; title: string; text: string }> {
    this.requirePage();
    if (!selector.trim() || selector.length > 500) throw new Error("CSS selector must contain 1–500 characters.");
    const encoded = JSON.stringify(selector);
    await this.command("Runtime.evaluate", {
      expression: "(()=>{const e=document.querySelector(" + encoded + ");if(!e)throw new Error('Element not found');e.click();return true})()",
      returnByValue: true,
    });
    await this.waitForDocument();
    return this.read();
  }

  async type(selector: string, text: string): Promise<{ url: string; title: string; text: string }> {
    this.requirePage();
    if (!selector.trim() || selector.length > 500 || text.length > 5000) throw new Error("Selector must be 1–500 characters and text at most 5000 characters.");
    const encodedSelector = JSON.stringify(selector);
    const encodedText = JSON.stringify(text);
    await this.command("Runtime.evaluate", {
      expression: "(()=>{const e=document.querySelector(" + encodedSelector + ");if(!e)throw new Error('Element not found');e.focus();const v=" + encodedText + ";if('value' in e){const p=Object.getPrototypeOf(e);const d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set)d.set.call(e,v);else e.value=v}else if(e.isContentEditable)e.textContent=v;else throw new Error('Target is not editable');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()",
      returnByValue: true,
    });
    return this.read();
  }

  async keypress(key: string): Promise<{ url: string; title: string; text: string }> {
    this.requirePage();
    const allowed = ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Space"];
    if (!allowed.includes(key)) throw new Error("Unsupported browser key.");
    const normalized = key === "Space" ? " " : key;
    await this.command("Input.dispatchKeyEvent", { type: "keyDown", key: normalized });
    await this.command("Input.dispatchKeyEvent", { type: "keyUp", key: normalized });
    await this.waitForDocument();
    return this.read();
  }

  async screenshot(): Promise<{ mimeType: string; data: string }> {
    this.requirePage();
    const result = await this.command("Page.captureScreenshot", { format: "jpeg", quality: 60, fromSurface: true, captureBeyondViewport: false });
    const data = result.result?.data;
    if (typeof data !== "string" || data.length > 1_500_000) throw new Error("Browser screenshot is missing or exceeds the 1.5 MiB limit.");
    return { mimeType: "image/jpeg", data };
  }

  private requirePage(): void {
    if (!this.socket || !this.target) throw new Error("No managed browser page is open. Open a URL first.");
  }

  async close(): Promise<void> {
    this.socket?.close();
    this.socket = undefined;
    this.target = undefined;
    this.activeUrl = null;
    if (this.process && this.process.exitCode === null) {
      const child = this.process;
      child.kill();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", () => resolve());
      });
    }
    this.process = undefined;
  }

  private async waitForEndpoint(): Promise<void> {
    const endpoint = "http://127.0.0.1:" + this.port + "/json/version";
    const deadline = Date.now() + 20_000;
    let lastError = "not ready";
    while (Date.now() < deadline) {
      if (this.process && this.process.exitCode !== null) throw new Error("Managed browser exited before its debugging endpoint became ready.");
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(1500) });
        if (response.ok) return;
        lastError = "HTTP " + response.status;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Managed browser did not become ready: " + lastError);
  }

  private async waitForDocument(): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const result = await this.command("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (result.result?.result && (result.result.result as { value?: unknown }).value === "complete") return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private async connect(url: string): Promise<void> {
    const Constructor = (globalThis as unknown as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
    if (!Constructor) throw new Error("This Node.js runtime does not expose the WebSocket client required by Chrome DevTools.");
    const socket = new Constructor(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Browser DevTools WebSocket connection timed out.")), 10_000);
      socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Browser DevTools WebSocket connection failed.")); });
    });
    socket.addEventListener("message", (event: { data: unknown }) => {
      let message: CdpResponse;
      try {
        message = JSON.parse(String(event.data)) as CdpResponse;
      } catch {
        return;
      }
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "Browser DevTools command failed."));
      else pending.resolve(message);
    });
    socket.addEventListener("close", () => {
      for (const item of this.pending.values()) item.reject(new Error("Browser DevTools connection closed."));
      this.pending.clear();
    });
    this.socket = socket;
  }

  private command(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    if (!this.socket || this.socket.readyState !== 1) return Promise.reject(new Error("Browser DevTools is not connected."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Browser command timed out: " + method));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket!.send(JSON.stringify({ id, method, params }));
    });
  }
}
