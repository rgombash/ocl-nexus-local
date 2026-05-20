/**
 * Kubernetes Secret Syncer for Configuration Vault
 *
 * Syncs encrypted config sets from the database to Kubernetes Secrets
 * in the user's unified namespace (u-{userId}).
 *
 * Each config set becomes a K8s Secret with name: set-{setId-prefix}
 * where setId-prefix is the first 8 characters of the config set UUID.
 */

import * as k8s from "@kubernetes/client-node";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";
import { getUserNamespace } from "@/lib/config/nexus";
import { logAction } from "@/lib/audit";

interface ConfigVariable {
  key: string;
  value: string; // encrypted
}

/**
 * Sync a config set to a Kubernetes Secret in the user's namespace.
 *
 * @param userId - Supabase user UUID
 * @param setId - Config set UUID
 * @param nodeKubeconfig - Raw kubeconfig string from nodes table
 * @returns The secret name created/updated (e.g., "set-a1b2c3d4")
 * @throws Error if sync fails
 */
export async function syncConfigSetToK8s(
  userId: string,
  setId: string,
  nodeKubeconfig: string
): Promise<string> {
  try {
    // 1. Fetch all variables for this config set
    const { data: variables, error: fetchError } = await supabaseAdmin
      .from("config_variables")
      .select("key, value")
      .eq("set_id", setId);

    if (fetchError) {
      throw new Error(`Failed to fetch config variables: ${fetchError.message}`);
    }

    if (!variables || variables.length === 0) {
      throw new Error("Config set has no variables to sync");
    }

    // 2. Decrypt all values
    const decryptedData: Record<string, string> = {};
    for (const variable of variables as ConfigVariable[]) {
      try {
        decryptedData[variable.key] = decrypt(variable.value);
      } catch (decryptError) {
        throw new Error(`Failed to decrypt variable ${variable.key}: ${decryptError}`);
      }
    }

    // 3. Connect to K8s
    const kc = new k8s.KubeConfig();
    kc.loadFromString(nodeKubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    // 4. Calculate secret name and namespace
    const namespace = getUserNamespace(userId);
    const secretName = `set-${setId.replace(/-/g, "").substring(0, 8)}`;

    // 5. Create or update the Secret
    // Kubernetes requires Secret data values to be base64-encoded strings
    const secretData: Record<string, string> = {};
    for (const [key, value] of Object.entries(decryptedData)) {
      secretData[key] = Buffer.from(value, "utf-8").toString("base64");
    }

    const secretManifest: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: secretName,
        namespace,
        labels: {
          "app.kubernetes.io/managed-by": "ocl-nexus",
          "ocl-nexus/config-set-id": setId,
          "ocl-nexus/user-id": userId,
        },
      },
      type: "Opaque",
      data: secretData,
    };

    try {
      // Try to read existing secret
      await coreApi.readNamespacedSecret({ name: secretName, namespace });
      
      // Secret exists — update it
      await coreApi.replaceNamespacedSecret({
        name: secretName,
        namespace,
        body: secretManifest,
      });
      
      console.log(`[sync-secrets] Updated Secret ${secretName} in namespace ${namespace}`);
    } catch (err) {
      const status = (err as { code?: number })?.code;
      if (status === 404) {
        // Secret doesn't exist — create it
        await coreApi.createNamespacedSecret({
          namespace,
          body: secretManifest,
        });
        
        console.log(`[sync-secrets] Created Secret ${secretName} in namespace ${namespace}`);
      } else {
        throw err;
      }
    }

    // 6. Log success
    await logAction(userId, "SECRET_SYNC_SUCCESS", "success", {
      set_id: setId,
      secret_name: secretName,
      namespace,
      variable_count: variables.length,
    });

    return secretName;
  } catch (error) {
    // Log failure
    await logAction(userId, "SECRET_SYNC_FAILURE", "failure", {
      set_id: setId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete a Kubernetes Secret for a config set.
 *
 * @param userId - Supabase user UUID
 * @param setId - Config set UUID
 * @param nodeKubeconfig - Raw kubeconfig string from nodes table
 * @returns true if deleted, false if not found
 */
export async function deleteConfigSetFromK8s(
  userId: string,
  setId: string,
  nodeKubeconfig: string
): Promise<boolean> {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(nodeKubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const namespace = getUserNamespace(userId);
    const secretName = `set-${setId.replace(/-/g, "").substring(0, 8)}`;

    try {
      await coreApi.deleteNamespacedSecret({ name: secretName, namespace });
      console.log(`[sync-secrets] Deleted Secret ${secretName} from namespace ${namespace}`);
      return true;
    } catch (err) {
      const status = (err as { code?: number })?.code;
      if (status === 404) {
        console.log(`[sync-secrets] Secret ${secretName} not found in namespace ${namespace} (already deleted)`);
        return false;
      }
      throw err;
    }
  } catch (error) {
    console.error(`[sync-secrets] Failed to delete Secret for set ${setId}:`, error);
    throw error;
  }
}

/**
 * Get the Secret name for a config set (without syncing).
 *
 * @param setId - Config set UUID
 * @returns The K8s Secret name (e.g., "set-a1b2c3d4")
 */
export function getSecretName(setId: string): string {
  return `set-${setId.replace(/-/g, "").substring(0, 8)}`;
}
