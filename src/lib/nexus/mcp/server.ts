import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuditCtx } from "@/lib/nexus/types";
import { registerDiscoveryTools } from "./tools/discovery";
import { registerLifecycleTools } from "./tools/lifecycle";
import { registerSandboxTools } from "./tools/sandbox";
import { registerResources } from "./resources";
import type { McpCtx } from "./helpers";

/**
 * Create a fresh McpServer for a single HTTP request (stateless mode).
 * Called once per POST /api/mcp/v1.
 */
export function buildMcpServer(
  userId: string,
  keyId: string,
  token: string,
  balance: number,
  isVip: boolean
): McpServer {
  const server = new McpServer(
    { name: "ocl-nexus", version: "1.0.0" },
    { capabilities: { logging: {}, resources: {} } }
  );

  const audit: AuditCtx = { userId, apiKeyId: keyId };
  const mcpCtx: McpCtx = { userId, keyId, apiKey: token, audit, balance, isVip };

  registerDiscoveryTools(server, mcpCtx);
  registerLifecycleTools(server, mcpCtx);
  registerSandboxTools(server, mcpCtx);
  registerResources(server, mcpCtx);

  return server;
}
