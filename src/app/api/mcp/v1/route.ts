/**
 * POST /api/mcp/v1 — OCL Nexus MCP Gateway
 *
 * Stateless Streamable HTTP MCP server. One McpServer + transport per request —
 * compatible with Vercel serverless.
 *
 * Tools:  nexus_list_blueprints, nexus_list_workloads, nexus_deploy,
 *         nexus_status, nexus_execute_command, nexus_write_file,
 *         nexus_read_file, nexus_list_files, nexus_delete_file,
 *         nexus_get_logs, nexus_restart, nexus_terminate
 *
 * Resources: nexus://wallet/balance, nexus://skills
 *
 * Implementation: src/lib/nexus/mcp/
 */

import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { validateApiKey } from "@/lib/auth/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hasFlag } from "@/lib/flags";
import { buildMcpServer } from "@/lib/nexus/mcp/server";


export async function POST(req: NextRequest) {
  // 1. Validate Bearer token before any MCP processing
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid Authorization header" }, id: null },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7);
  const validated = await validateApiKey(token).catch(() => null);
  if (!validated) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Invalid API key" }, id: null },
      { status: 401 }
    );
  }

  const { userId, keyId } = validated;

  // 2. Fetch user profile (balance + flags)
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("balance, flags")
    .eq("id", userId)
    .single();

  const isVip =
    hasFlag<boolean>(
      profile?.flags as Record<string, unknown> | null | undefined,
      "is_vip",
      false
    ) === true;
  const balance = parseFloat(String(profile?.balance ?? 0));

  // 3. Build MCP server + stateless transport (fresh per request)
  const server = buildMcpServer(userId, keyId, token, balance, isVip);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
  });

  await server.connect(transport);

  // 4. Dispatch
  return transport.handleRequest(req);
}

// Stateless mode does not use GET / DELETE
export async function GET() {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Use POST for MCP requests" }, id: null },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null },
    { status: 405 }
  );
}
