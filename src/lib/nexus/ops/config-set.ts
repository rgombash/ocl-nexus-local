/**
 * ops/config-set.ts — Update config set on a running instance.
 *
 * Syncs new K8s Secret, deletes old one, patches deployment envFrom,
 * restarts the pod (scale 0→2s→1), then updates the DB.
 *
 * Uses promiseMiddleware to force Content-Type: strategic-merge-patch+json
 * (never pass _options to patchNamespacedDeployment — see AGENTS.md).
 *
 * Used by: UI PATCH /api/instances/[id]/config-set
 * Audit: CONFIG_SET_CHANGE
 */
import * as k8s from "@kubernetes/client-node";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { getUserNamespace } from "@/lib/config/nexus";
import { syncConfigSetToK8s, deleteConfigSetFromK8s, getSecretName } from "@/lib/k8s/sync-secrets";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { ServerError, NotFoundError } from "@/lib/nexus/errors";
import type { InstanceRow, AuditCtx } from "@/lib/nexus/types";

/**
 * Update the config set assigned to a running instance.
 *
 * @param instance       - Pre-fetched instance row (adapter verifies ownership + validates config set ownership)
 * @param newConfigSetId - New config set UUID, or null to remove
 * @param audit          - Audit context
 */
export async function updateConfigSet(
  instance: InstanceRow & { config_set_id?: string | null },
  newConfigSetId: string | null,
  audit: AuditCtx
): Promise<void> {
  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  if (!node?.kubeconfig) throw new ServerError("Node kubeconfig not available");

  const nodeKubeconfig = getNodeKubeconfig(node);
  const shortId = instance.subdomain.replace("inst-", "");
  const namespace = getUserNamespace(instance.user_id);
  const deploymentName = `app-${shortId}`;
  const oldConfigSetId = instance.config_set_id;

  // ── K8s Secret sync ───────────────────────────────────────────────────────
  try {
    if (newConfigSetId) {
      await syncConfigSetToK8s(audit.userId, newConfigSetId, nodeKubeconfig);
    }
    if (oldConfigSetId && oldConfigSetId !== newConfigSetId) {
      await deleteConfigSetFromK8s(audit.userId, oldConfigSetId, nodeKubeconfig);
    }
  } catch (err) {
    console.error("[config-set] Secret sync failed:", err);
    throw new ServerError("Failed to sync configuration secrets");
  }

  // ── Patch deployment envFrom + restart ────────────────────────────────────
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(nodeKubeconfig);
    const cluster = kc.getCurrentCluster();
    if (!cluster) throw new ServerError("No active cluster in kubeconfig");

    const appsApi = new k8s.AppsV1Api(
      k8s.createConfiguration({
        baseServer: new k8s.ServerConfiguration(cluster.server, {}),
        authMethods: { default: kc },
        promiseMiddleware: [
          {
            pre: async (ctx) => {
              ctx.setHeaderParam("Content-Type", k8s.PatchStrategy.StrategicMergePatch);
              return ctx;
            },
            post: async (ctx) => ctx,
          },
        ],
      })
    );

    const newEnvFrom = newConfigSetId
      ? [{ secretRef: { name: getSecretName(newConfigSetId) } }]
      : [];

    // Patch envFrom (container name = blueprintId)
    await appsApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace,
      body: {
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: instance.blueprint_id,
                  envFrom: newEnvFrom,
                },
              ],
            },
          },
        },
      },
    });

    // Restart: scale 0 → wait 2s → scale 1
    await appsApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace,
      body: { spec: { replicas: 0 } },
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await appsApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace,
      body: { spec: { replicas: 1 } },
    });
  } catch (err) {
    if (err instanceof ServerError) throw err;
    console.error("[config-set] Deployment patch failed:", err);
    throw new ServerError("Failed to update instance configuration");
  }

  // ── DB update ─────────────────────────────────────────────────────────────
  await supabaseAdmin
    .from("instances")
    .update({ config_set_id: newConfigSetId })
    .eq("id", instance.id);

  await logAction(audit.userId, "CONFIG_SET_CHANGE", "success", {
    instance_id: instance.id,
    subdomain: instance.subdomain,
    old_config_set_id: oldConfigSetId,
    new_config_set_id: newConfigSetId,
  });
}

export { NotFoundError };
