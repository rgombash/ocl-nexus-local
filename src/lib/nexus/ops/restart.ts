/**
 * ops/restart.ts — Workload restart (scale 0 → 1)
 *
 * Triggers a synchronous restart of a deployment by scaling to 0
 * then back to 1. The old pod is killed immediately, and a new pod
 * is created with the current image and filesystem state.
 *
 * K8s PATCH requirement: Must use getPatchClient() (strategic-merge-patch).
 * Using kc.makeApiClient(AppsV1Api) for patches defaults to json-patch+json
 * which causes HTTP 400. See client.ts for the correct pattern.
 *
 * Used by: UI POST /api/instances/[id]/restart
 *          M2M POST /api/v1/workloads/[id]/restart
 * Audit: INSTANCE_RESTART | INSTANCE_RESTART_FAILURE
 */
import * as k8s from "@kubernetes/client-node";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { getUserNamespace } from "@/lib/config/nexus";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { ServerError } from "@/lib/nexus/errors";
import type { InstanceRow, AuditCtx } from "@/lib/nexus/types";

/**
 * Restart a workload by scaling its Deployment to 0 then 1.
 * Ownership verification and admin bypass are the adapter's responsibility.
 *
 * @param instance - Pre-fetched instance row (adapter must verify ownership)
 * @param audit - Audit context (userId, optional apiKeyId)
 * @throws ServerError if K8s patch fails
 */
export async function restartWorkload(
  instance: InstanceRow,
  audit: AuditCtx
): Promise<void> {
  // ── Fetch node kubeconfig ─────────────────────────────────────────────────
  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  if (!node?.kubeconfig) {
    throw new ServerError("Node kubeconfig not available");
  }

  const blueprintId = instance.blueprint_id ?? "openclaw";
  const shortId = instance.subdomain.replace("inst-", "");
  const namespace = getUserNamespace(instance.user_id);
  const deploymentName = `app-${shortId}`;

  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(getNodeKubeconfig(node));

    const cluster = kc.getCurrentCluster();
    if (!cluster) {
      throw new ServerError("No active cluster in kubeconfig");
    }

    // CRITICAL: Build AppsV1Api with promiseMiddleware baked in to force
    // Content-Type: application/strategic-merge-patch+json. Never use
    // kc.makeApiClient(AppsV1Api) for patches — it defaults to json-patch+json.
    // Never pass _options to individual patch calls — it replaces baseServer.
    const appsApi = new k8s.AppsV1Api(
      k8s.createConfiguration({
        baseServer: new k8s.ServerConfiguration(cluster.server, {}),
        authMethods: { default: kc },
        promiseMiddleware: [
          {
            pre: async (ctx) => {
              ctx.setHeaderParam(
                "Content-Type",
                k8s.PatchStrategy.StrategicMergePatch
              );
              return ctx;
            },
            post: async (ctx) => ctx,
          },
        ],
      })
    );

    // Scale 0 → 1: synchronous kill + fresh pod. Pod terminates immediately;
    // status endpoint will return "starting" as soon as scale-down completes.
    await appsApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace,
      body: { spec: { replicas: 0 } },
    });
    await appsApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace,
      body: { spec: { replicas: 1 } },
    });
  } catch (err) {
    if (err instanceof ServerError) throw err;

    console.error("[restart] K8s patch failed:", err);
    await logAction(audit.userId, "INSTANCE_RESTART_FAILURE", "failure", {
      instance_id: instance.id,
      error: err instanceof Error ? err.message : String(err),
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });

    throw new ServerError("Failed to restart instance");
  }

  // ── Audit success ─────────────────────────────────────────────────────────
  await logAction(audit.userId, "INSTANCE_RESTART", "success", {
    instance_id: instance.id,
    subdomain: instance.subdomain,
    blueprint_id: blueprintId,
    ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
  });
}
