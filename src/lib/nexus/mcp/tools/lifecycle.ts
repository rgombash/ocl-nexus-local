import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logAction } from "@/lib/audit";
import { INFRA_DOMAIN } from "@/lib/config/nexus";
import { deployWorkload } from "@/lib/nexus/ops/deploy";
import { getStatus } from "@/lib/nexus/ops/status";
import { restartWorkload } from "@/lib/nexus/ops/restart";
import { deleteWorkload } from "@/lib/nexus/ops/delete";
import { ok, err, resolveInstance, type McpCtx } from "../helpers";
import { InstanceLimitError } from "@/lib/nexus/errors";

export function registerLifecycleTools(server: McpServer, ctx: McpCtx) {
  const { userId, keyId, audit, balance, isVip } = ctx;

  // ── nexus_deploy ──────────────────────────────────────────────────────────
  server.registerTool(
    "nexus_deploy",
    {
      description:
        "Provision a new sandbox or workload on OCL Nexus Local. " +
        "Returns instanceId and subdomain immediately — the pod takes 20–60 s to start. " +
        "After calling this, call nexus_wait_for_ready (preferred) or poll nexus_status until " +
        "status === 'running' before sending files or executing commands. " +
        "Blueprints: python-sandbox (Python 3.12), nodejs-sandbox (Node.js 20), " +
        "openclaw (full AI workspace, requires LLM keys). " +
        "Tip: check nexus_list_workloads first to confirm available slots. " +
        "IMPORTANT: internalUrl uses port 80 (the K8s Service port) for pod-to-pod calls — " +
        "e.g. http://svc-a1b2c3d4:80. Apps must still bind to their container port (8000 for " +
        "python-sandbox, 3000 for nodejs-sandbox) — that is what public ingress targets on the " +
        "pod directly. Never use internalUrl port for the app's bind address. " +
        "Default instance limit: 5 concurrent workloads. " +
        "If the limit is reached, nexus_deploy returns an error — call nexus_terminate on an " +
        "existing workload first, then retry.",
      inputSchema: {
        blueprint_id: z
          .string()
          .describe(
            "Blueprint ID to deploy. Options: python-sandbox, nodejs-sandbox, " +
              "openclaw, nanoclaw, hello-world. Default: python-sandbox"
          )
          .default("python-sandbox"),
        user_description: z
          .string()
          .optional()
          .describe(
            "Human-readable label shown in the user's dashboard. Always set this — " +
            "derive a purpose-based name from context if the user hasn't specified one " +
            "(e.g. 'flask-api', 'data-scraper', 'image-processor'). " +
            "Avoid generic names like 'test', 'sandbox', or 'workload-1'."
          ),
        config_set_id: z
          .string()
          .optional()
          .describe("Optional config set UUID to inject environment variables from the vault"),
      },
    },
    async ({ blueprint_id, user_description, config_set_id }) => {
      const { isLocalMode } = await import("@/lib/auth/dev-user");
      if (!isLocalMode() && balance <= 0 && !isVip) {
        return err("Insufficient balance. Check nexus://wallet/balance.");
      }
      await logAction(userId, "MCP_TOOL_CALL", "success", {
        tool: "nexus_deploy",
        blueprint_id,
        api_key_id: keyId,
      });
      try {
        const result = await deployWorkload({
          userId,
          blueprintId: blueprint_id,
          configSetId: config_set_id ?? null,
          userDescription: user_description ?? null,
          apiKeyId: keyId,
        });
        return ok(
          JSON.stringify(
            {
              instanceId: result.instanceId,
              subdomain: result.subdomain,
              publicUrl: `http://${result.subdomain}.${INFRA_DOMAIN}`,
              internalUrl: result.internalUrl,
              status: "provisioning",
              message:
                "Workload deployment initiated. The pod takes 20–60 s to start.",
              nextStep:
                "Call nexus_wait_for_ready to block until the pod is ready, " +
                "then upload your files with nexus_write_file and run code with nexus_execute_command.",
            },
            null,
            2
          )
        );
      } catch (e) {
        if (e instanceof InstanceLimitError) {
          return err(
            `Instance limit reached (${e.current}/${e.limit}). ` +
            `Call nexus_terminate on an existing workload to free a slot, then retry nexus_deploy.`
          );
        }
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_status ──────────────────────────────────────────────────────────
  server.registerTool(
    "nexus_status",
    {
      description:
        "Get real-time pod status for a workload. " +
        "Possible statuses: provisioning, starting, pulling (image download), running, error, suspended. " +
        "Prefer nexus_wait_for_ready after deploy/restart — it blocks server-side and eliminates " +
        "manual polling. Use nexus_status only when you need a one-shot status check. " +
        "The response includes internalUrl (cluster-internal http://svc-{id}:80) for " +
        "direct pod-to-pod communication — always port 80 regardless of the app's bind port.",
      inputSchema: {
        instance_id: z
          .string()
          .describe("Instance UUID or short ID (e.g. 'a1b2c3d4') from nexus_deploy"),
      },
    },
    async ({ instance_id }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_status",
          instance_id: instance.id,
          api_key_id: keyId,
        });
        const result = await getStatus(instance);
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_restart ─────────────────────────────────────────────────────────
  server.registerTool(
    "nexus_restart",
    {
      description:
        "Reboot a workload pod. " +
        "Scales the Kubernetes Deployment to 0 then back to 1. The pod " +
        "terminates immediately and a fresh pod starts with the same code volume. " +
        "Critical use case: after uploading nexus-start.sh via nexus_write_file, " +
        "call this to activate Service Mode (the new pod will execute nexus-start.sh). " +
        "After restarting, call nexus_wait_for_ready to block until the pod is ready (~15–30 s).",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
      },
    },
    async ({ instance_id }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_restart",
          instance_id: instance.id,
          api_key_id: keyId,
        });
        await restartWorkload(instance, audit);
        return ok(
          JSON.stringify(
            {
              message:
                "Restart triggered. Call nexus_wait_for_ready to block until the pod is ready.",
              instance_id: instance.id,
            },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_terminate ───────────────────────────────────────────────────────
  server.registerTool(
    "nexus_terminate",
    {
      description:
        "Permanently destroy a workload and all its storage. " +
        "This deletes the Kubernetes Deployment, Service, Ingress, " +
        "and all PVCs (including the 250 MB code volume). THIS IS IRREVERSIBLE. " +
        "Call this when you are done with a workload to free local resources.",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
      },
    },
    async ({ instance_id }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_terminate",
          instance_id: instance.id,
          api_key_id: keyId,
        });
        await deleteWorkload(instance, audit);
        return ok(
          JSON.stringify(
            { ok: true, message: "Workload terminated and all resources deleted." },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_wait_for_ready ──────────────────────────────────────────────────────
  server.registerTool(
    "nexus_wait_for_ready",
    {
      description:
        "Block server-side until a workload pod is fully ready (status === 'running' AND " +
        "readiness probe passed). Polls every 5 s — eliminates manual polling loops and " +
        "reduces a typical 10-turn deployment wait into a single tool call. " +
        "Returns immediately on success or on unrecoverable error (CrashLoopBackOff, " +
        "ImagePullBackOff, suspended). Use after nexus_deploy or nexus_restart before " +
        "calling nexus_write_file or nexus_execute_command.",
      inputSchema: {
        instance_id: z
          .string()
          .describe("Instance UUID or short ID from nexus_deploy"),
        timeout: z
          .number()
          .int()
          .min(10)
          .max(300)
          .optional()
          .describe(
            "Maximum seconds to wait before returning (default 120, max 300). " +
              "First-deploy cold starts with image pulls typically take 60–90 s."
          ),
      },
    },
    async ({ instance_id, timeout = 120 }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_wait_for_ready",
          instance_id: instance.id,
          api_key_id: keyId,
        });

        const deadline = Date.now() + timeout * 1000;
        let last = await getStatus(instance);

        while (!last.isReady) {
          if (last.status === "suspended") {
            return err(
              "Instance is suspended — workload is not running. Try redeploying."
            );
          }
          // Unrecoverable error — no point waiting
          if (last.status === "error") {
            return ok(
              JSON.stringify(
                { ready: false, timedOut: false, reason: "error", ...last },
                null,
                2
              )
            );
          }
          if (Date.now() >= deadline) {
            return ok(
              JSON.stringify(
                {
                  ready: false,
                  timedOut: true,
                  ...last,
                  message: `Timed out after ${timeout}s. Last status: ${last.status} — ${last.message}`,
                },
                null,
                2
              )
            );
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 5000));
          last = await getStatus(instance);
        }

        return ok(
          JSON.stringify(
            {
              ready: true,
              timedOut: false,
              ...last,
              message: `Instance is ready. Public URL: ${last.publicUrl}`,
            },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
