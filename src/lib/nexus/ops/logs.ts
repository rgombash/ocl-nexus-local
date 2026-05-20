/**
 * ops/logs.ts — Pod log retrieval
 *
 * Fetches the last N lines of stdout/stderr from the primary container.
 * Targets the pod by dual label selector: app={blueprintId},instance={shortId}
 * Container name always matches blueprintId (e.g. "python-sandbox", "openclaw").
 *
 * Used by: UI GET /api/instances/[id]/logs
 *          M2M GET /api/v1/workloads/[id]/logs
 * K8s pattern: coreApi.readNamespacedPodLog (makeApiClient is fine for reads)
 * Audit: LOGS_VIEW (UI) | LOGS_VIEW_M2M (M2M)
 */
import * as k8s from "@kubernetes/client-node";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { getUserNamespace } from "@/lib/config/nexus";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { ServerError } from "@/lib/nexus/errors";
import type { InstanceRow, LogsResult, AuditCtx } from "@/lib/nexus/types";

/**
 * Fetch pod logs for an instance.
 * Ownership verification is the adapter's responsibility.
 *
 * @param instance - Pre-fetched instance row (adapter must verify ownership)
 * @param tailLines - Number of log lines to fetch (1–10 000)
 * @param audit - Audit context (userId, optional apiKeyId)
 * @returns LogsResult — logs string + metadata
 */
export async function getLogs(
  instance: InstanceRow,
  tailLines: number,
  audit: AuditCtx
): Promise<LogsResult> {
  const isM2M = !!audit.apiKeyId;
  const auditAction = isM2M ? "LOGS_VIEW_M2M" : "LOGS_VIEW";

  // ── Fetch node kubeconfig ─────────────────────────────────────────────────
  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  if (!node?.kubeconfig) {
    throw new ServerError("Node kubeconfig unavailable");
  }

  const namespace = getUserNamespace(instance.user_id);
  const blueprintId = instance.blueprint_id ?? "openclaw";
  const shortId = instance.subdomain.replace("inst-", "");

  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(getNodeKubeconfig(node));
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    // Find the pod for this instance (dual label selector for shared namespace)
    const podList = await coreApi.listNamespacedPod({
      namespace,
      labelSelector: `app=${blueprintId},instance=${shortId}`,
    });

    const pods = podList.items;
    if (!pods || pods.length === 0) {
      return { logs: "", lineCount: 0, message: "No pod found for this instance" };
    }

    const pod = pods[0];
    const podName = pod.metadata?.name;
    if (!podName) {
      throw new ServerError("Pod name not available");
    }

    // Container name always matches blueprintId
    const logsText = await coreApi.readNamespacedPodLog({
      name: podName,
      namespace,
      container: blueprintId,
      tailLines,
      timestamps: false,
    });

    // ── Init container logs (auto-included when main container is struggling) ──
    // Fetched automatically when: container is in a waiting/terminated state, OR
    // restartCount > 0 (CrashLoopBackOff). Helps agents debug permission / image errors.
    let initLogs: string | undefined;
    const cs = pod.status?.containerStatuses?.[0];
    const initContainerStatuses = pod.status?.initContainerStatuses ?? [];
    const mainContainerStruggling =
      !!cs?.state?.waiting ||
      !!cs?.state?.terminated ||
      (cs?.restartCount ?? 0) > 0;

    if (mainContainerStruggling && initContainerStatuses.length > 0) {
      const parts: string[] = [];
      for (const ics of initContainerStatuses) {
        try {
          const text = await coreApi.readNamespacedPodLog({
            name: podName,
            namespace,
            container: ics.name,
            tailLines: 10,
            timestamps: false,
          });
          if (text) parts.push(`--- [init: ${ics.name}] ---\n${text}`);
        } catch {
          // Init container may not have logs yet — skip silently
        }
      }
      if (parts.length > 0) initLogs = parts.join("\n");
    }

    await logAction(audit.userId, auditAction, "success", {
      instance_id: instance.id,
      subdomain: instance.subdomain,
      lines: tailLines,
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });

    const lineCount = logsText
      ? logsText.split("\n").filter(Boolean).length
      : 0;

    return { logs: logsText ?? "", podName, tailLines, lineCount, ...(initLogs ? { initLogs } : {}) };
  } catch (err) {
    const k8sErr = err as { code?: number };

    await logAction(audit.userId, auditAction, "failure", {
      instance_id: instance.id,
      error: err instanceof Error ? err.message : String(err),
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });

    // 404 = container not ready yet — return empty, don't error
    if (k8sErr.code === 404) {
      return {
        logs: "",
        lineCount: 0,
        message: "Container not ready yet — logs not available",
      };
    }

    if (err instanceof ServerError) throw err;
    throw new ServerError("Failed to fetch logs");
  }
}
