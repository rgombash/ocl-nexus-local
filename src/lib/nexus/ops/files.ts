/**
 * ops/files.ts — File shipment and retrieval for code PVCs.
 *
 * writeFile: base64-encodes content → printf | base64 -d > path (avoids shell escaping)
 * readFile: cat or base64 command → returns content in requested encoding
 *
 * Path traversal protection: rejects paths containing ".."
 *
 * Used by: M2M POST /api/v1/workloads/[id]/files
 *          M2M GET  /api/v1/workloads/[id]/files
 * Audit: FILES_UPLOAD
 */
import * as k8s from "@kubernetes/client-node";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { getUserNamespace } from "@/lib/config/nexus";
import { getBlueprint } from "@/lib/nexus/blueprints";
import { executeCommand } from "@/lib/k8s/exec-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import {
  ServerError,
  BadRequestError,
  PodNotReadyError,
} from "@/lib/nexus/errors";
import type { InstanceRow, FileWriteResult, FileWriteBatchResult, FileWriteBatchItemResult, FileReadResult, FileListResult, FileDeleteResult, AuditCtx } from "@/lib/nexus/types";

// ---------------------------------------------------------------------------
// Internal: find the running pod for an instance
// ---------------------------------------------------------------------------
async function findPod(
  kubeconfig: string,
  namespace: string,
  blueprintId: string,
  shortId: string
): Promise<string> {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const podList = await coreApi.listNamespacedPod({
    namespace,
    labelSelector: `app=${blueprintId},instance=${shortId}`,
  });
  if (!podList.items || podList.items.length === 0) {
    throw new PodNotReadyError("Pod not found or not running");
  }
  return podList.items[0].metadata!.name!;
}

// ---------------------------------------------------------------------------
// Internal: resolve and validate path
// ---------------------------------------------------------------------------
function resolvePath(
  rawPath: string,
  codeMountPath: string
): { cleanPath: string; fullPath: string; dirPath: string } {
  if (rawPath.includes("..")) {
    throw new BadRequestError("Path must not contain '..' (traversal not allowed)");
  }
  // Strip the codeMountPath prefix if the caller already passed an absolute
  // container path (e.g. "/app/output.txt" with codeMountPath="/app").
  // Without this, the full path would be "/app/app/output.txt".
  const stripped = rawPath.startsWith(codeMountPath)
    ? rawPath.slice(codeMountPath.length)
    : rawPath;
  const cleanPath = stripped.startsWith("/") ? stripped : `/${stripped}`;
  const fullPath = `${codeMountPath}${cleanPath}`;
  const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
  return { cleanPath, fullPath, dirPath };
}

// ---------------------------------------------------------------------------
// Public: write file
// ---------------------------------------------------------------------------

/**
 * Write a file to the instance's code PVC.
 *
 * @param instance  - Pre-fetched instance row (adapter verifies ownership + balance)
 * @param path      - Relative path within the code mount (e.g. "scripts/main.py")
 * @param content   - File content
 * @param encoding  - Content encoding: "utf8" | "base64"
 * @param audit     - Audit context
 */
export async function writeFile(
  instance: InstanceRow,
  path: string,
  content: string,
  encoding: "utf8" | "base64",
  audit: AuditCtx
): Promise<FileWriteResult> {
  if (instance.status !== "active") {
    throw new BadRequestError("Instance is not active");
  }

  const blueprintId = instance.blueprint_id ?? "openclaw";
  let blueprint;
  try {
    blueprint = getBlueprint(blueprintId);
  } catch {
    throw new ServerError("Invalid blueprint configuration");
  }
  if (!blueprint.codePersistence) {
    throw new BadRequestError("This workload does not support code persistence");
  }

  const { cleanPath, fullPath, dirPath } = resolvePath(path, blueprint.codeMountPath);

  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();
  if (!node?.kubeconfig) throw new ServerError("Node configuration unavailable");

  const namespace = getUserNamespace(instance.user_id);
  const shortId = instance.subdomain.replace("inst-", "");
  const kubeconfig = getNodeKubeconfig(node);

  let podName: string;
  try {
    podName = await findPod(kubeconfig, namespace, blueprintId, shortId);
  } catch (err) {
    if (err instanceof PodNotReadyError) throw err;
    console.error("[files] Failed to find pod:", err);
    throw new ServerError("Failed to locate workload pod");
  }

  try {
    // Always transmit as base64 to avoid shell escaping issues
    const base64Content =
      encoding === "base64"
        ? content
        : Buffer.from(content, "utf8").toString("base64");

    await executeCommand(
      kubeconfig,
      namespace,
      podName,
      blueprintId,
      ["sh", "-c", `mkdir -p "${dirPath}"`],
      10_000
    );
    await executeCommand(
      kubeconfig,
      namespace,
      podName,
      blueprintId,
      ["sh", "-c", `printf "%s" "${base64Content}" | base64 -d > "${fullPath}"`],
      15_000
    );
    await executeCommand(
      kubeconfig,
      namespace,
      podName,
      blueprintId,
      ["sh", "-c", `chown 1000:1000 "${fullPath}" && chmod 644 "${fullPath}"`],
      10_000
    );

    await logAction(audit.userId, "FILES_UPLOAD", "success", {
      instance_id: instance.id,
      file_path: cleanPath,
      file_size_bytes: content.length,
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });

    return { path: cleanPath, fullPath };
  } catch (err) {
    console.error("[files] Failed to write file:", err);
    await logAction(audit.userId, "FILES_UPLOAD", "failure", {
      instance_id: instance.id,
      file_path: cleanPath,
      error: err instanceof Error ? err.message : "Unknown error",
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });
    throw new ServerError(
      err instanceof Error ? err.message : "Failed to write file"
    );
  }
}

// ---------------------------------------------------------------------------
// Public: write multiple files (batch)
// ---------------------------------------------------------------------------

/**
 * Write multiple files to the instance's code PVC in a single op.
 *
 * Amortises the kubeconfig decrypt + pod lookup across all files.
 * Files are written sequentially to avoid flooding the K8s exec server.
 * Individual file failures are captured per-result — does NOT throw on
 * partial failures.
 *
 * @param instance - Pre-fetched instance row (adapter verifies ownership + balance)
 * @param files    - Array of { path, content, encoding } descriptors (max 20)
 * @param audit    - Audit context
 */
export async function writeFiles(
  instance: InstanceRow,
  files: Array<{ path: string; content: string; encoding: "utf8" | "base64" }>,
  audit: AuditCtx
): Promise<FileWriteBatchResult> {
  if (instance.status !== "active") {
    throw new BadRequestError("Instance is not active");
  }

  const blueprintId = instance.blueprint_id ?? "openclaw";
  let blueprint;
  try {
    blueprint = getBlueprint(blueprintId);
  } catch {
    throw new ServerError("Invalid blueprint configuration");
  }
  if (!blueprint.codePersistence) {
    throw new BadRequestError("This workload does not support code persistence");
  }

  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();
  if (!node?.kubeconfig) throw new ServerError("Node configuration unavailable");

  const namespace = getUserNamespace(instance.user_id);
  const shortId = instance.subdomain.replace("inst-", "");
  const kubeconfig = getNodeKubeconfig(node);

  let podName: string;
  try {
    podName = await findPod(kubeconfig, namespace, blueprintId, shortId);
  } catch (e) {
    if (e instanceof PodNotReadyError) throw e;
    console.error("[files] writeFiles: Failed to find pod:", e);
    throw new ServerError("Failed to locate workload pod");
  }

  const results: FileWriteBatchItemResult[] = [];
  let uploaded = 0;
  let failed = 0;
  let total_bytes = 0;

  for (const file of files) {
    // Resolve path — capture errors per-file rather than aborting the batch
    let cleanPath: string;
    let fullPath: string;
    let dirPath: string;
    try {
      ({ cleanPath, fullPath, dirPath } = resolvePath(file.path, blueprint.codeMountPath));
    } catch (e) {
      results.push({
        path: file.path,
        status: "failed",
        error: e instanceof Error ? e.message : "Invalid path",
      });
      failed++;
      continue;
    }

    try {
      const base64Content =
        file.encoding === "base64"
          ? file.content
          : Buffer.from(file.content, "utf8").toString("base64");

      await executeCommand(
        kubeconfig, namespace, podName, blueprintId,
        ["sh", "-c", `mkdir -p "${dirPath}"`],
        10_000
      );
      await executeCommand(
        kubeconfig, namespace, podName, blueprintId,
        ["sh", "-c", `printf "%s" "${base64Content}" | base64 -d > "${fullPath}"`],
        15_000
      );
      await executeCommand(
        kubeconfig, namespace, podName, blueprintId,
        ["sh", "-c", `chown 1000:1000 "${fullPath}" && chmod 644 "${fullPath}"`],
        10_000
      );

      await logAction(audit.userId, "FILES_UPLOAD", "success", {
        instance_id: instance.id,
        file_path: cleanPath,
        file_size_bytes: file.content.length,
        ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
      });

      results.push({ path: cleanPath, status: "success", size: file.content.length });
      uploaded++;
      total_bytes += file.content.length;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Write failed";
      console.error(`[files] writeFiles: Failed to write ${cleanPath}:`, e);
      await logAction(audit.userId, "FILES_UPLOAD", "failure", {
        instance_id: instance.id,
        file_path: cleanPath,
        error: errMsg,
        ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
      });
      results.push({ path: cleanPath, status: "failed", error: errMsg });
      failed++;
    }
  }

  return {
    uploaded,
    failed,
    total_bytes,
    results,
    message: `Uploaded ${uploaded}/${files.length} files successfully`,
  };
}

// ---------------------------------------------------------------------------
// Public: read file
// ---------------------------------------------------------------------------

/**
 * Read a file from the instance's code PVC.
 *
 * @param instance  - Pre-fetched instance row (adapter verifies ownership + balance)
 * @param path      - Relative path within the code mount
 * @param encoding  - Desired response encoding: "utf8" | "base64"
 * @param audit     - Audit context
 */
export async function readFile(
  instance: InstanceRow,
  path: string,
  encoding: "utf8" | "base64",
  audit: AuditCtx
): Promise<FileReadResult> {
  if (instance.status !== "active") {
    throw new BadRequestError("Instance is not active");
  }

  const blueprintId = instance.blueprint_id ?? "openclaw";
  let blueprint;
  try {
    blueprint = getBlueprint(blueprintId);
  } catch {
    throw new ServerError("Invalid blueprint configuration");
  }
  if (!blueprint.codePersistence) {
    throw new BadRequestError("This workload does not support code persistence");
  }

  const { cleanPath, fullPath } = resolvePath(path, blueprint.codeMountPath);

  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();
  if (!node?.kubeconfig) throw new ServerError("Node configuration unavailable");

  const namespace = getUserNamespace(instance.user_id);
  const shortId = instance.subdomain.replace("inst-", "");
  const kubeconfig = getNodeKubeconfig(node);

  let podName: string;
  try {
    podName = await findPod(kubeconfig, namespace, blueprintId, shortId);
  } catch (err) {
    if (err instanceof PodNotReadyError) throw err;
    console.error("[files] Failed to find pod:", err);
    throw new ServerError("Failed to locate workload pod");
  }

  try {
    const readCmd =
      encoding === "base64"
        ? `base64 "${fullPath}"`
        : `cat "${fullPath}"`;

    const content = await executeCommand(
      kubeconfig,
      namespace,
      podName,
      blueprintId,
      ["sh", "-c", readCmd],
      15_000
    );

    return {
      content,
      encoding,
      path: cleanPath,
      fullPath,
    };
  } catch (err) {
    console.error("[files] Failed to read file:", err);
    throw new ServerError(
      err instanceof Error ? err.message : "Failed to read file"
    );
  }

  // audit unused in GET path currently (kept for symmetry — add if needed)
  void audit;
}

// ---------------------------------------------------------------------------
// Public: list files
// ---------------------------------------------------------------------------

/**
 * List files inside the instance's code PVC.
 *
 * Uses `find` with -maxdepth 3 to return a recursive tree without
 * descending into hidden directories. Returns paths relative to codeMountPath.
 *
 * @param instance  - Pre-fetched instance row
 * @param dirPath   - Optional subdirectory path to list (defaults to mount root)
 * @param audit     - Audit context
 */
export async function listFiles(
  instance: InstanceRow,
  dirPath: string | undefined,
  audit: AuditCtx
): Promise<FileListResult> {
  if (instance.status !== "active") {
    throw new BadRequestError("Instance is not active");
  }

  const blueprintId = instance.blueprint_id ?? "openclaw";
  let blueprint;
  try {
    blueprint = getBlueprint(blueprintId);
  } catch {
    throw new ServerError("Invalid blueprint configuration");
  }
  if (!blueprint.codePersistence) {
    throw new BadRequestError("This workload does not support code persistence");
  }

  // Resolve the directory to list
  let targetPath = blueprint.codeMountPath;
  if (dirPath) {
    if (dirPath.includes("..")) {
      throw new BadRequestError("Path must not contain '..' (traversal not allowed)");
    }
    const stripped = dirPath.startsWith(blueprint.codeMountPath)
      ? dirPath.slice(blueprint.codeMountPath.length)
      : dirPath;
    const clean = stripped.startsWith("/") ? stripped : `/${stripped}`;
    targetPath = `${blueprint.codeMountPath}${clean}`;
  }

  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();
  if (!node?.kubeconfig) throw new ServerError("Node configuration unavailable");

  const namespace = getUserNamespace(instance.user_id);
  const shortId = instance.subdomain.replace("inst-", "");
  const kubeconfig = getNodeKubeconfig(node);

  let podName: string;
  try {
    podName = await findPod(kubeconfig, namespace, blueprintId, shortId);
  } catch (err) {
    if (err instanceof PodNotReadyError) throw err;
    console.error("[files] Failed to find pod:", err);
    throw new ServerError("Failed to locate workload pod");
  }

  try {
    const raw = await executeCommand(
      kubeconfig,
      namespace,
      podName,
      blueprintId,
      [
        "sh",
        "-c",
        `find "${targetPath}" -maxdepth 3 -not -path '*/.*' | sort`,
      ],
      15_000
    );

    const mountPrefix = blueprint.codeMountPath;
    const files = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      // Strip the codeMountPath prefix so paths are relative
      .map((l) => (l.startsWith(mountPrefix) ? l.slice(mountPrefix.length) || "/" : l));

    await logAction(audit.userId, "FILES_LIST", "success", {
      instance_id: instance.id,
      dir_path: targetPath,
      file_count: files.length,
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });

    return { files, count: files.length, basePath: targetPath };
  } catch (err) {
    console.error("[files] Failed to list files:", err);
    await logAction(audit.userId, "FILES_LIST", "failure", {
      instance_id: instance.id,
      dir_path: targetPath,
      error: err instanceof Error ? err.message : "Unknown error",
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });
    throw new ServerError(
      err instanceof Error ? err.message : "Failed to list files"
    );
  }
}

// ---------------------------------------------------------------------------
// Public: delete file or directory
// ---------------------------------------------------------------------------

/**
 * Delete a file or directory inside the instance's code PVC.
 *
 * @param instance  - Pre-fetched instance row
 * @param path      - Relative path to delete (e.g. "scripts/old.py")
 * @param audit     - Audit context
 */
export async function deleteFile(
  instance: InstanceRow,
  path: string,
  audit: AuditCtx
): Promise<FileDeleteResult> {
  if (instance.status !== "active") {
    throw new BadRequestError("Instance is not active");
  }

  const blueprintId = instance.blueprint_id ?? "openclaw";
  let blueprint;
  try {
    blueprint = getBlueprint(blueprintId);
  } catch {
    throw new ServerError("Invalid blueprint configuration");
  }
  if (!blueprint.codePersistence) {
    throw new BadRequestError("This workload does not support code persistence");
  }

  if (path.includes("..")) {
    throw new BadRequestError("Path must not contain '..' (traversal not allowed)");
  }

  const stripped = path.startsWith(blueprint.codeMountPath)
    ? path.slice(blueprint.codeMountPath.length)
    : path;
  const cleanPath = stripped.startsWith("/") ? stripped : `/${stripped}`;
  const fullPath = `${blueprint.codeMountPath}${cleanPath}`;

  // Prevent deleting the mount root itself
  if (fullPath === blueprint.codeMountPath || fullPath === `${blueprint.codeMountPath}/`) {
    throw new BadRequestError("Cannot delete the root code directory");
  }

  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();
  if (!node?.kubeconfig) throw new ServerError("Node configuration unavailable");

  const namespace = getUserNamespace(instance.user_id);
  const shortId = instance.subdomain.replace("inst-", "");
  const kubeconfig = getNodeKubeconfig(node);

  let podName: string;
  try {
    podName = await findPod(kubeconfig, namespace, blueprintId, shortId);
  } catch (err) {
    if (err instanceof PodNotReadyError) throw err;
    console.error("[files] Failed to find pod:", err);
    throw new ServerError("Failed to locate workload pod");
  }

  try {
    await executeCommand(
      kubeconfig,
      namespace,
      podName,
      blueprintId,
      ["sh", "-c", `rm -rf "${fullPath}"`],
      15_000
    );

    await logAction(audit.userId, "FILES_DELETE", "success", {
      instance_id: instance.id,
      file_path: cleanPath,
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });

    return { path: cleanPath, fullPath };
  } catch (err) {
    console.error("[files] Failed to delete file:", err);
    await logAction(audit.userId, "FILES_DELETE", "failure", {
      instance_id: instance.id,
      file_path: cleanPath,
      error: err instanceof Error ? err.message : "Unknown error",
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });
    throw new ServerError(
      err instanceof Error ? err.message : "Failed to delete file"
    );
  }
}

