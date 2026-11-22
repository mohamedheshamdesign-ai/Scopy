import { McpServerManager } from "../integrations/mcp/mcp-server-manager.js";
import type { ActionRequest } from "../permissions/types.js";
import { ToolGateway } from "./tool-gateway.js";

export class McpTool {
  constructor(private readonly manager: McpServerManager) {}

  register(gateway: ToolGateway): void {
    gateway.register(
      "mcp",
      "Call an explicitly configured MCP server tool. The exact server, tool name, and arguments require one-time approval.",
      async (request: ActionRequest) => {
        if (request.action !== "call") throw new Error("MCP adapter supports only the call action.");
        const separator = request.target.indexOf("/");
        if (separator < 1 || separator === request.target.length - 1) {
          throw new Error("MCP target must be <server-id>/<tool-name>.");
        }
        const serverId = request.target.slice(0, separator);
        const toolName = request.target.slice(separator + 1);
        const payload = request.payload;
        if (!payload || typeof payload.arguments !== "object" || payload.arguments === null || Array.isArray(payload.arguments)) {
          throw new Error("MCP calls require payload.arguments as a JSON object.");
        }
        return this.manager.callTool(serverId, toolName, payload.arguments as Record<string, unknown>);
      },
    );
  }
}
