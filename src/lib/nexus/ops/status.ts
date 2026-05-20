/**
 * ops/status.ts — Pod status retrieval
 *
 * Fetches real-time pod status from K8s for a given instance.
 * Returns a StatusResult with all enrichment fields populated.
 *
 * UI adapter omits: subdomain, created_at, internalUrl (UI clients get those
 * from other sources). M2M adapter includes them all.
 *
 * Used by: UI GET /api/instances/[id]/status
 *          M2M GET /api/v1/workloads/[id]/status
 *
 * Status values: suspended | starting | pulling | running | error | unknown
 */
import * as k8s from "@kubernetes/client-node";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { getUserNamespace, INFRA_DOMAIN } from "@/lib/config/nexus";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { InstanceRow, StatusResult } from "@/lib/nexus/types";

/**
 * Fetch pod status for an instance.
 * Ownership verification is the adapter's responsibility.
 *
 * @param instance - Pre-fetched instance row (must include created_at if M2M)
 * @returns StatusResult — always includes status + message + enrichment fields
 */
export async function getStatus(
  instance: InstanceRow
): Promise<StatusResult> {
  const blueprintId = instance.blueprint_id ?? "openclaw";
  const shortId = instance.subdomain.replace("inst-", "");
  // Port 80 is the K8s Service port — targetPort maps it to the container port inside the pod.
  // Use :80 for pod-to-pod calls; apps must still bind to their blueprint port (e.g. 8000).
  const internalUrl = `http://svc-${shortId}:80`;

  const common: Pick<StatusResult, "subdomain" | "created_at" | "internalUrl" | "publicUrl" | "isReady"> = {
    subdomain: instance.subdomain,
    created_at: instance.created_at,
    internalUrl,
    publicUrl: `${process.env.NEXUS_MODE === "local" ? "http" : "https"}://${instance.subdomain}.${INFRA_DOMAIN}`,
    isReady: false,
  };

  // Short-circuit: DB-level suspended state — no K8s call needed
  if (instance.status === "suspended") {
    return {
      status: "suspended",
      message: "Instance suspended — insufficient balance",
      ...common,
    };
  }

  // ── Fetch node kubeconfig ─────────────────────────────────────────────────
  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  if (!node?.kubeconfig) {
    return {
      status: "error",
      message: "Node kubeconfig unavailable",
      ...common,
    };
  }

  const namespace = getUserNamespace(instance.user_id);

  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(getNodeKubeconfig(node));
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const podList = await coreApi.listNamespacedPod({
      namespace,
      labelSelector: `app=${blueprintId},instance=${shortId}`,
    });

    const pods = podList.items;
    if (!pods || pods.length === 0) {
      return {
        status: "starting",
        message: "Waiting for pod to be scheduled",
        ...common,
      };
    }

    const pod = pods[0];
    const podName = pod.metadata?.name ?? "unknown";
    const phase = pod.status?.phase;
    const containerStatuses = pod.status?.containerStatuses;
    const creationTime = pod.metadata?.creationTimestamp;
    const age = creationTime
      ? Math.floor((Date.now() - new Date(creationTime).getTime()) / 1000)
      : 0;

    // ── Check init containers first ────────────────────────────────────────
    const initStatuses = pod.status?.initContainerStatuses;
    if (initStatuses && initStatuses.length > 0) {
      const runningInit = initStatuses.find((s) => s.state?.running);
      const waitingInit = initStatuses.find((s) => s.state?.waiting);
      if (runningInit || waitingInit) {
        const name = (runningInit || waitingInit)?.name ?? "init";
        return {
          status: "starting",
          message: `Running init container: ${name}`,
          details: {
            podName,
            phase: phase ?? "Unknown",
            containerState: "initializing",
            restartCount: 0,
            age,
          },
          ...common,
        };
      }
    }

    // ── No container statuses yet ──────────────────────────────────────────
    if (!containerStatuses || containerStatuses.length === 0) {
      return {
        status: "starting",
        message: "Pod is initializing",
        details: {
          podName,
          phase: phase ?? "Unknown",
          containerState: "pending",
          restartCount: 0,
          age,
        },
        ...common,
      };
    }

    const cs = containerStatuses[0];
    const restartCount = cs.restartCount ?? 0;

    // ── Waiting states ────────────────────────────────────────────────────
    if (cs.state?.waiting) {
      const reason = cs.state.waiting.reason ?? "Unknown";
      if (reason === "ContainerCreating" || reason === "PodInitializing") {
        return {
          status: "pulling",
          message: "Pulling container image",
          details: {
            podName,
            phase: phase ?? "Unknown",
            containerState: reason,
            restartCount,
            age,
          },
          ...common,
        };
      }
      // CrashLoopBackOff, ImagePullBackOff, etc.
      return {
        status: "error",
        message: cs.state.waiting.message ?? reason,
        details: {
          podName,
          phase: phase ?? "Unknown",
          containerState: reason,
          restartCount,
          age,
          errorReason: reason,
        },
        ...common,
      };
    }

    // ── Running + ready ───────────────────────────────────────────────────
    if (phase === "Running" && cs.ready) {
      const startedAt = cs.state?.running?.startedAt;
      const uptime = startedAt
        ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
        : 0;
      return {
        status: "running",
        message: "Instance is running",
        ...common,
        isReady: true,
        details: {
          podName,
          phase: "Running",
          containerState: "running",
          restartCount,
          age,
          uptime,
        },
      };
    }

    // ── Running but not ready ─────────────────────────────────────────────
    if (phase === "Running" && !cs.ready) {
      return {
        status: "starting",
        message: "Container started, waiting for readiness",
        details: {
          podName,
          phase: "Running",
          containerState: "not-ready",
          restartCount,
          age,
        },
        ...common,
      };
    }

    // ── Pod failed / terminated ───────────────────────────────────────────
    if (phase === "Failed" || cs.state?.terminated) {
      return {
        status: "error",
        message:
          cs.state?.terminated?.message ??
          cs.state?.terminated?.reason ??
          "Pod failed",
        details: {
          podName,
          phase: phase ?? "Unknown",
          containerState: "failed",
          restartCount,
          age,
          errorReason: cs.state?.terminated?.reason,
        },
        ...common,
      };
    }

    // ── Fallback ──────────────────────────────────────────────────────────
    return {
      status: "starting",
      message: `Pod phase: ${phase ?? "unknown"}`,
      details: {
        podName,
        phase: phase ?? "Unknown",
        containerState: "unknown",
        restartCount,
        age,
      },
      ...common,
    };
  } catch (err) {
    console.error("[status] K8s error:", err);
    return {
      status: "error",
      message: "Failed to fetch pod status",
      ...common,
    };
  }
}
