/**
 * ops/delete.ts — Workload deletion
 *
 * Deletes all K8s resources for an instance, removes the Cloudflare DNS record,
 * then deletes the DB row and syncs the node tenant count.
 *
 * The namespace is NOT deleted — it persists for the user's other instances.
 * safeDelete pattern: ignores 404 (resource already gone), logs other errors,
 * but continues cleanup to avoid leaving orphaned resources.
 *
 * Used by: UI DELETE /api/instances/[id]
 *          M2M DELETE /api/v1/workloads/[id]
 * Audit: INSTANCE_DELETE_START | INSTANCE_DELETE_SUCCESS
 */
import * as k8s from "@kubernetes/client-node";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { getUserNamespace } from "@/lib/config/nexus";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import type { InstanceRow, AuditCtx } from "@/lib/nexus/types";

/** Silently ignore 404s; log other errors but continue. */
async function safeDelete(
  fn: () => Promise<unknown>,
  resourceName: string
): Promise<void> {
  try {
    await fn();
    console.log(`[delete] Deleted ${resourceName}`);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 404) {
      console.log(`[delete] ${resourceName} already gone — skipping`);
    } else {
      console.error(`[delete] Failed to delete ${resourceName}:`, err);
    }
  }
}

/**
 * Delete a workload and all associated resources.
 * Ownership verification is the adapter's responsibility.
 * Never throws — errors are logged and cleanup continues as far as possible.
 *
 * @param instance - Pre-fetched instance row (adapter must verify ownership)
 * @param audit - Audit context (userId, optional apiKeyId)
 */
export async function deleteWorkload(
  instance: InstanceRow,
  audit: AuditCtx
): Promise<void> {
  await logAction(audit.userId, "INSTANCE_DELETE_START", "started", {
    instance_id: instance.id,
    subdomain: instance.subdomain,
    ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
  });

  const shortId = instance.subdomain.replace("inst-", "");
  const namespace = getUserNamespace(instance.user_id);

  // ── K8s cleanup ───────────────────────────────────────────────────────────
  const { isLocalMode } = await import("@/lib/auth/dev-user");
  const isLocal = isLocalMode();

  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  // In local mode the nodes table has no row (mock node is never persisted),
  // but we still need to clean up K8s resources using the local kubeconfig.
  if (node?.kubeconfig || isLocal) {
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromString(getNodeKubeconfig(node ?? { kubeconfig: "" }));
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      const appsApi = kc.makeApiClient(k8s.AppsV1Api);
      const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
      const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

      await safeDelete(
        () => appsApi.deleteNamespacedDeployment({ name: `app-${shortId}`, namespace }),
        `Deployment app-${shortId}`
      );
      await safeDelete(
        () => coreApi.deleteNamespacedService({ name: `svc-${shortId}`, namespace }),
        `Service svc-${shortId}`
      );
      // Cloud mode: Traefik CRDs. Local mode: these 404 and are ignored by safeDelete.
      await safeDelete(
        () =>
          customApi.deleteNamespacedCustomObject({
            group: "traefik.io",
            version: "v1alpha1",
            namespace,
            plural: "ingressroutes",
            name: `ingress-${shortId}`,
          }),
        `IngressRoute ingress-${shortId}`
      );
      await safeDelete(
        () =>
          customApi.deleteNamespacedCustomObject({
            group: "traefik.io",
            version: "v1alpha1",
            namespace,
            plural: "middlewares",
            name: `auth-${shortId}`,
          }),
        `Middleware auth-${shortId}`
      );
      // Local mode: standard K8s Ingress. Cloud mode: this 404s and is ignored.
      await safeDelete(
        () =>
          networkingApi.deleteNamespacedIngress({
            name: `ingress-${shortId}`,
            namespace,
          }),
        `Ingress ingress-${shortId}`
      );
      await safeDelete(
        () =>
          coreApi.deleteNamespacedPersistentVolumeClaim({
            name: `pvc-${shortId}`,
            namespace,
          }),
        `PVC pvc-${shortId}`
      );
      await safeDelete(
        () =>
          coreApi.deleteNamespacedPersistentVolumeClaim({
            name: `pvc-code-${shortId}`,
            namespace,
          }),
        `PVC pvc-code-${shortId}`
      );

      console.log(`[delete] Cleaned up all K8s resources for instance ${shortId}`);
    } catch (err) {
      console.error(`[delete] K8s cleanup failed:`, err);
      // Continue with DNS + DB cleanup
    }
  }

  // ── DB cleanup ────────────────────────────────────────────────────────────
  // Delete first so that the subsequent COUNT reflects reality
  await supabaseAdmin.from("instances").delete().eq("id", instance.id);

  if (node) {
    const { count: liveCount } = await supabaseAdmin
      .from("instances")
      .select("*", { count: "exact", head: true })
      .eq("node_id", instance.node_id)
      .in("status", ["active", "provisioning"]);

    await supabaseAdmin
      .from("nodes")
      .update({ current_tenant_count: liveCount ?? 0 })
      .eq("id", instance.node_id);
  }

  await logAction(audit.userId, "INSTANCE_DELETE_SUCCESS", "success", {
    instance_id: instance.id,
    subdomain: instance.subdomain,
    ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
  });
}
