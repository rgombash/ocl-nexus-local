import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { SKILLS_CONTENT } from "./skills";
import type { McpCtx } from "./helpers";

export function registerResources(server: McpServer, ctx: McpCtx) {
  const { userId, isVip } = ctx;

  // ── nexus://wallet/balance ────────────────────────────────────────────────
  server.registerResource(
    "nexus-wallet-balance",
    "nexus://wallet/balance",
    {
      mimeType: "application/json",
      description:
        "Current user authorization status and instance capacity. " +
        "Check this to confirm your API key is active before deploying.",
    },
    async () => {
      const { data } = await supabaseAdmin
        .from("users")
        .select("max_instances, flags")
        .eq("id", userId)
        .single();
      const limit: number = (data?.max_instances as number | null) ?? 5;
      return {
        contents: [
          {
            uri: "nexus://wallet/balance",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                authorized: true,
                mode: "local",
                instance_limit: limit,
                is_vip: isVip,
                dashboard_url: "http://localhost:3000/dashboard",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── nexus://skills ────────────────────────────────────────────────────────
  server.registerResource(
    "nexus-skills",
    "nexus://skills",
    {
      mimeType: "text/markdown",
      description:
        "OCL Nexus agent playbook. Read this at the start of a session to understand " +
        "deployment patterns, Service Mode, internal URLs, and best practices.",
    },
    async () => ({
      contents: [
        {
          uri: "nexus://skills",
          mimeType: "text/markdown",
          text: SKILLS_CONTENT,
        },
      ],
    })
  );
}
