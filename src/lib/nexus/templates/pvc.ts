/**
 * OCL Nexus — PVC manifest builders.
 *
 * Pure functions — no I/O, no side effects.
 * Returned objects are passed directly to coreApi.createNamespacedPersistentVolumeClaim().
 */
import * as k8s from "@kubernetes/client-node";

/** Build a data PVC manifest (workspace storage for openclaw/nanoclaw). */
export function buildDataPvc(
  shortId: string,
  namespace: string,
  size: string
): k8s.V1PersistentVolumeClaim {
  return {
    metadata: {
      name: `pvc-${shortId}`,
      namespace,
      labels: { instance: shortId },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "local-path",
      resources: { requests: { storage: size } },
    },
  };
}

/** Build a code PVC manifest (infrastructure state layer for sandboxes). */
export function buildCodePvc(
  shortId: string,
  namespace: string,
  size: string
): k8s.V1PersistentVolumeClaim {
  return {
    metadata: {
      name: `pvc-code-${shortId}`,
      namespace,
      labels: { instance: shortId, type: "code" },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "local-path",
      resources: { requests: { storage: size } },
    },
  };
}
