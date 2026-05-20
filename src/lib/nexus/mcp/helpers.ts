import { supabaseAdmin } from "@/lib/supabase-admin";
import type { AuditCtx, InstanceRow } from "@/lib/nexus/types";

// ---------------------------------------------------------------------------
// Context passed to every tool and resource registration function
// ---------------------------------------------------------------------------
export interface McpCtx {
  userId: string;
  keyId: string;
  apiKey: string;
  audit: AuditCtx;
  balance: number;
  isVip: boolean;
}

// ---------------------------------------------------------------------------
// Fetch an instance by UUID or shortId and verify ownership
// ---------------------------------------------------------------------------
export async function resolveInstance(
  instanceId: string,
  userId: string
): Promise<InstanceRow> {
  const isUuid = instanceId.includes("-") && instanceId.length > 30;
  const query = supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id, created_at");

  const { data, error } = isUuid
    ? await query.eq("id", instanceId).single()
    : await query.eq("subdomain", `inst-${instanceId}`).single();

  if (error || !data) throw new Error(`Instance not found: ${instanceId}`);
  if (data.user_id !== userId) throw new Error(`Access denied to instance: ${instanceId}`);
  return data as InstanceRow;
}

// ---------------------------------------------------------------------------
// MCP CallToolResult builders
// ---------------------------------------------------------------------------
export function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function err(message: string) {
  return {
    content: [{ type: "text" as const, text: `ERROR: ${message}` }],
    isError: true,
  };
}
