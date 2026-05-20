/**
 * OCL Nexus — Kubernetes client factory.
 *
 * Two functions:
 *   getK8sClients(kubeconfig)  — standard clients for read/create/delete
 *   getPatchClient(kubeconfig) — AppsV1Api pre-configured for strategic-merge-patch
 *
 * Both accept an ALREADY-DECRYPTED kubeconfig string.
 * Callers must call decrypt() from @/lib/encryption before passing here.
 *
 * CRITICAL — PATCH operations:
 *   Never use kc.makeApiClient(k8s.AppsV1Api) for PATCH.
 *   makeApiClient() defaults to application/json-patch+json → HTTP 400.
 *   getPatchClient() bakes the correct Content-Type into every request.
 *   Never pass _options to patchNamespacedDeployment — it replaces the entire
 *   configuration including baseServer, causing "absolute base url" errors.
 *
 * NEXUS LOCAL MODE:
 *   getLocalKubeconfig() — reads kubeconfig from KUBECONFIG_PATH env var
 */
import * as k8s from "@kubernetes/client-node";
import { readFileSync } from "fs";
import { decrypt } from "@/lib/encryption";
import { ServerError } from "./errors";

// ---------------------------------------------------------------------------
// Standard clients (read / create / delete)
// ---------------------------------------------------------------------------

/** Standard K8s API clients for read/create/delete operations. */
export interface K8sClients {
  kc: k8s.KubeConfig;
  coreApi: k8s.CoreV1Api;
  appsApi: k8s.AppsV1Api;
  customApi: k8s.CustomObjectsApi;
}

/** Build standard K8s API clients from a decrypted kubeconfig string. */
export function getK8sClients(kubeconfig: string): K8sClients {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  return {
    kc,
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    appsApi: kc.makeApiClient(k8s.AppsV1Api),
    customApi: kc.makeApiClient(k8s.CustomObjectsApi),
  };
}

// ---------------------------------------------------------------------------
// Patch client (strategic-merge-patch)
// ---------------------------------------------------------------------------

/**
 * Build an AppsV1Api pre-configured for strategic-merge-patch.
 * Required for all PATCH operations on Deployments.
 */
export function getPatchClient(kubeconfig: string): k8s.AppsV1Api {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  const cluster = kc.getCurrentCluster();
  if (!cluster) {
    throw new ServerError("No active cluster in kubeconfig");
  }
  return new k8s.AppsV1Api(
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
}

// ---------------------------------------------------------------------------
// Local mode helpers
// ---------------------------------------------------------------------------

/**
 * Read kubeconfig from local file (for Nexus Local mode).
 * Path is defined in KUBECONFIG_PATH environment variable.
 */
export function getLocalKubeconfig(): string {
  const kubeconfigPath = process.env.KUBECONFIG_PATH;
  if (!kubeconfigPath) {
    throw new ServerError("KUBECONFIG_PATH environment variable is not set");
  }
  try {
    const kubeconfigContent = readFileSync(kubeconfigPath, "utf8");
    // In local mode, K3s generates kubeconfig with server: https://0.0.0.0:6443
    // Replace with container-accessible hostname
    return kubeconfigContent.replace(
      "https://0.0.0.0:6443",
      "https://nexus-k3s:6443"
    );
  } catch (error) {
    throw new ServerError(
      `Failed to read kubeconfig from ${kubeconfigPath}: ${error}`
    );
  }
}

/**
 * Mock node object for local mode.
 * In local mode, there's only one "node" (the local K3s cluster).
 */
export interface MockNode {
  id: string;
  ip_address: string;
  kubeconfig: string;
  current_tenant_count: number;
  max_tenants: number;
}

/**
 * Get mock node for local mode.
 * Returns a node object compatible with cloud mode node selection.
 */
export function getLocalNode(): MockNode {
  const kubeconfig = getLocalKubeconfig();
  return {
    id: "11111111-1111-1111-1111-111111111111", // Fixed UUID for local node
    ip_address: "127.0.0.1",
    kubeconfig,
    current_tenant_count: 0,
    max_tenants: 999,
  };
}

/**
 * Get kubeconfig string from a node object, handling encryption.
 * In local mode, kubeconfig is plain text; in cloud mode, it's encrypted.
 */
export function getNodeKubeconfig(node: { kubeconfig: string }): string {
  // Check for local mode
  const isLocal = process.env.NEXUS_MODE === "local";
  
  if (isLocal) {
    // Local mode: read kubeconfig from file (with server address replacement)
    return getLocalKubeconfig();
  } else {
    // Cloud mode: kubeconfig is encrypted, needs decryption
    return decrypt(node.kubeconfig);
  }
}
