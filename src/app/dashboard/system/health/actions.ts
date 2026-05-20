"use server";

import * as k8s from "@kubernetes/client-node";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getLocalKubeconfig } from "@/lib/nexus/client";
import { logAction } from "@/lib/audit";

const LOCAL_USER_ID =
  process.env.LOCAL_DEV_USER_ID ?? "00000000-0000-0000-0000-000000000000";

// Namespace for the single local dev user: u-00000000
const NAMESPACE = `u-${LOCAL_USER_ID.replace(/-/g, "").substring(0, 8)}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mismatch {
  shortId: string;
  type: "zombie" | "ghost";
  instanceId?: string;
  subdomain?: string;
  dbStatus?: string;
}

export interface ReconciliationResult {
  mismatches: Mismatch[];
  k8sDeployments: string[];
  dbInstances: { id: string; subdomain: string; status: string }[];
  nodeMetrics?: {
    podCount: number;
    nodeConditions: { type: string; status: string }[];
    allocatable: Record<string, string>;
    capacity: Record<string, string>;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildClients() {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(getLocalKubeconfig());
  return {
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    appsApi: kc.makeApiClient(k8s.AppsV1Api),
    networkingApi: kc.makeApiClient(k8s.NetworkingV1Api),
  };
}

// ---------------------------------------------------------------------------
// Reconcile: compare K8s deployments vs DB instances
// ---------------------------------------------------------------------------

export async function reconcileLocal(): Promise<ReconciliationResult> {
  const { data: dbRows } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, status");

  const dbInstances = (dbRows ?? []).map((r) => ({
    id: r.id as string,
    subdomain: r.subdomain as string,
    status: r.status as string,
  }));

  const dbShortIds = new Set(
    dbInstances.map((i) => i.subdomain.replace("inst-", ""))
  );

  let k8sDeployments: string[] = [];
  let nodeMetrics: ReconciliationResult["nodeMetrics"];

  try {
    const { coreApi, appsApi } = buildClients();

    const deployList = await appsApi.listNamespacedDeployment({ namespace: NAMESPACE });
    k8sDeployments = (deployList.items ?? [])
      .map((d) => d.metadata?.name ?? "")
      .filter((n) => n.startsWith("app-"))
      .map((n) => n.replace("app-", ""));

    try {
      const [podList, nodeList] = await Promise.all([
        coreApi.listNamespacedPod({ namespace: NAMESPACE }),
        coreApi.listNode(),
      ]);
      const k8sNode = nodeList.items?.[0];
      const allocatable: Record<string, string> = {};
      const capacity: Record<string, string> = {};
      for (const [k, v] of Object.entries(k8sNode?.status?.allocatable ?? {}))
        allocatable[k] = String(v);
      for (const [k, v] of Object.entries(k8sNode?.status?.capacity ?? {}))
        capacity[k] = String(v);

      nodeMetrics = {
        podCount: (podList.items ?? []).length,
        nodeConditions: (k8sNode?.status?.conditions ?? []).map((c) => ({
          type: c.type ?? "",
          status: c.status ?? "",
        })),
        allocatable,
        capacity,
      };
    } catch (e) {
      console.error("[health] metrics error:", e);
    }
  } catch (err) {
    return {
      mismatches: [],
      k8sDeployments: [],
      dbInstances,
      error: `K3s connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const k8sSet = new Set(k8sDeployments);
  const mismatches: Mismatch[] = [];

  for (const shortId of k8sDeployments) {
    if (!dbShortIds.has(shortId))
      mismatches.push({ shortId, type: "zombie" });
  }

  for (const inst of dbInstances) {
    const shortId = inst.subdomain.replace("inst-", "");
    if (!k8sSet.has(shortId))
      mismatches.push({
        shortId,
        type: "ghost",
        instanceId: inst.id,
        subdomain: inst.subdomain,
        dbStatus: inst.status,
      });
  }

  return { mismatches, k8sDeployments, dbInstances, nodeMetrics };
}

// ---------------------------------------------------------------------------
// Delete zombie: remove all K8s resources for a shortId
// ---------------------------------------------------------------------------

export async function deleteZombieResources(
  shortId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { coreApi, appsApi, networkingApi } = buildClients();

    await Promise.allSettled([
      appsApi.deleteNamespacedDeployment({ name: `app-${shortId}`, namespace: NAMESPACE }),
      coreApi.deleteNamespacedService({ name: `svc-${shortId}`, namespace: NAMESPACE }),
      networkingApi.deleteNamespacedIngress({ name: `ingress-${shortId}`, namespace: NAMESPACE }),
      coreApi.deleteNamespacedPersistentVolumeClaim({ name: `pvc-${shortId}`, namespace: NAMESPACE }),
      coreApi.deleteNamespacedPersistentVolumeClaim({ name: `pvc-code-${shortId}`, namespace: NAMESPACE }),
    ]);

    await logAction(LOCAL_USER_ID, "ZOMBIE_NAMESPACE_DELETE", "success", {
      short_id: shortId,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Mark ghost instance as error in DB
// ---------------------------------------------------------------------------

export async function markGhostError(
  instanceId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from("instances")
    .update({ status: "error" })
    .eq("id", instanceId);

  if (error) return { ok: false, error: error.message };

  await logAction(LOCAL_USER_ID, "GHOST_INSTANCE_MARK_ERROR", "success", {
    instance_id: instanceId,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Prune all zombies at once
// ---------------------------------------------------------------------------

export async function pruneAllZombies(): Promise<{
  ok: boolean;
  deleted: number;
  errors: string[];
}> {
  const result = await reconcileLocal();
  if (result.error) return { ok: false, deleted: 0, errors: [result.error] };

  const zombies = result.mismatches.filter((m) => m.type === "zombie");
  let deleted = 0;
  const errors: string[] = [];

  for (const zombie of zombies) {
    const res = await deleteZombieResources(zombie.shortId);
    if (res.ok) deleted++;
    else errors.push(`${zombie.shortId}: ${res.error}`);
  }

  await logAction(
    LOCAL_USER_ID,
    "PRUNE_ALL_ZOMBIES",
    errors.length === 0 ? "success" : "failure",
    { deleted, errors }
  );

  return { ok: errors.length === 0, deleted, errors };
}
