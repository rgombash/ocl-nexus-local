import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logAction } from "@/lib/audit";
import { BLUEPRINTS } from "@/lib/nexus/blueprints";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ok, err, type McpCtx } from "../helpers";

export function registerDiscoveryTools(server: McpServer, ctx: McpCtx) {
  const { userId, keyId } = ctx;

  // ── nexus_list_blueprints ─────────────────────────────────────────────────
  server.registerTool(
    "nexus_list_blueprints",
    {
      description:
        "List available workload types (blueprints) on OCL Nexus. " +
        "Returns blueprint IDs, descriptions, ports, and capabilities. " +
        "Call this first to determine which blueprint to deploy (e.g. python-sandbox for Python tasks, " +
        "nodejs-sandbox for JavaScript tasks, openclaw for full AI workspace).",
    },
    async () => {
      await logAction(userId, "MCP_TOOL_CALL", "success", {
        tool: "nexus_list_blueprints",
        api_key_id: keyId,
      });
      const list = Object.values(BLUEPRINTS).map((b) => ({
        id: b.id,
        displayName: b.displayName,
        description: b.description,
        port: b.port,
        category: b.category,
        requiresLlmKeys: b.requiresLlmKeys,
        codePersistence: b.codePersistence,
        isStable: b.isStable,
        ...(b.runtimeInfo ? { runtimeInfo: b.runtimeInfo } : {}),
      }));
      return ok(JSON.stringify(list, null, 2));
    }
  );

  // ── nexus_list_workloads ──────────────────────────────────────────────────
  server.registerTool(
    "nexus_list_workloads",
    {
      description:
        "List all your existing workloads on OCL Nexus. " +
        "Returns instanceId, subdomain, blueprint, status, creation time, and internalUrl for each. " +
        "Response includes count, limit, and slotsRemaining so you can check capacity before deploying. " +
        "Use this to find an instance you deployed earlier, check what's currently running, " +
        "or decide which workloads to terminate to free local resources.",
    },
    async () => {
      await logAction(userId, "MCP_TOOL_CALL", "success", {
        tool: "nexus_list_workloads",
        api_key_id: keyId,
      });

      const [{ data, error: dbErr }, { data: profile }] = await Promise.all([
        supabaseAdmin
          .from("instances")
          .select("id, subdomain, blueprint_id, status, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("users")
          .select("max_instances, flags")
          .eq("id", userId)
          .single(),
      ]);

      if (dbErr) return err("Failed to list workloads: " + dbErr.message);

      const workloads = (data ?? []).map((row) => {
        const shortId = row.subdomain.replace("inst-", "");
        // Always port 80 — the K8s Service port; targetPort maps to the container port internally
        const internalUrl = `http://svc-${shortId}:80`;
        return {
          instanceId: row.id,
          subdomain: row.subdomain,
          blueprint_id: row.blueprint_id,
          status: row.status,
          created_at: row.created_at,
          internalUrl,
        };
      });

      const isVip = !!(profile?.flags as Record<string, unknown> | null)?.["is_vip"];
      const limit: number | null = isVip ? null : (profile?.max_instances ?? 5);
      const count = workloads.length;
      const slotsRemaining = limit === null ? null : Math.max(0, limit - count);

      return ok(JSON.stringify({ workloads, count, limit, slotsRemaining }, null, 2));
    }
  );
}
