/**
 * ops/execute.ts — Remote command execution in a running pod.
 *
 * Finds the pod for the given instance (dual label selector), then
 * executes a shell command with stdout/stderr capture, a 30s timeout,
 * and a 5 MB output cap.
 *
 * Used by: M2M POST /api/v1/workloads/[id]/execute
 * Audit: REMOTE_EXECUTE
 */
import * as k8s from "@kubernetes/client-node";
import { PassThrough } from "stream";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { getUserNamespace } from "@/lib/config/nexus";
import { getBlueprint } from "@/lib/nexus/blueprints";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { ServerError, BadRequestError, PodNotReadyError } from "@/lib/nexus/errors";
import type { InstanceRow, ExecResult, AuditCtx } from "@/lib/nexus/types";

const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB cap

// ---------------------------------------------------------------------------
// Internal stream-based exec helper (re-exported for ops/files.ts)
// ---------------------------------------------------------------------------
export function execWithStreams(
  kubeconfig: string,
  namespace: string,
  podName: string,
  containerName: string,
  command: string[],
  timeoutMs: number
): Promise<ExecResult> {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  const exec = new k8s.Exec(kc);

  return new Promise<ExecResult>((resolve, reject) => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;

    stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        settle(new Error("Command stdout exceeded 5 MB limit"));
        return;
      }
      outChunks.push(Buffer.from(chunk));
    });
    stderr.on("data", (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > MAX_OUTPUT_BYTES) {
        settle(new Error("Command stderr exceeded 5 MB limit"));
        return;
      }
      errChunks.push(Buffer.from(chunk));
    });

    let settled = false;
    const settle = (err?: Error, result?: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.destroy();
      stderr.destroy();
      if (err) reject(err);
      else resolve(result!);
    };

    const timer = setTimeout(() => {
      settle(new Error(`Command timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    exec
      .exec(
        namespace,
        podName,
        containerName,
        command,
        stdout,
        stderr,
        null, // stdin
        false, // tty
        (status: k8s.V1Status) => {
          const stdoutStr = Buffer.concat(outChunks).toString("utf-8");
          const stderrStr = Buffer.concat(errChunks).toString("utf-8");

          if (status.status === "Success") {
            settle(undefined, { stdout: stdoutStr, stderr: stderrStr, exitCode: 0 });
          } else {
            let exitCode = 1;
            const statusDetails = status.details as Record<string, unknown> | undefined;
            if (statusDetails?.causes && Array.isArray(statusDetails.causes)) {
              const exitCause = statusDetails.causes.find(
                (c: { reason?: string; field?: string; message?: string }) =>
                  c.reason === "ExitCode" || c.field === "ExitCode"
              ) as { message?: string } | undefined;
              if (exitCause?.message) exitCode = parseInt(exitCause.message, 10) || 1;
            }
            const statusWithCode = status as { code?: number };
            if (statusWithCode.code !== undefined) exitCode = statusWithCode.code;
            settle(undefined, { stdout: stdoutStr, stderr: stderrStr, exitCode });
          }
        }
      )
      .catch((err: Error) => settle(err));
  });
}

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
// Public op
// ---------------------------------------------------------------------------

/**
 * Execute a shell command inside the workload's pod.
 *
 * @param instance - Pre-fetched instance row (adapter verifies ownership + balance)
 * @param command  - Shell command string to run
 * @param workDir  - Working directory (defaults to blueprint.codeMountPath or /tmp)
 * @param audit    - Audit context
 */
export async function executeShellCommand(
  instance: InstanceRow,
  command: string,
  workDir: string | undefined,
  audit: AuditCtx
): Promise<ExecResult> {
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

  const effectiveWorkDir =
    workDir ?? (blueprint.codePersistence ? blueprint.codeMountPath : "/tmp");

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
    console.error("[execute] Failed to find pod:", err);
    throw new ServerError("Failed to locate workload pod");
  }

  try {
    const result = await execWithStreams(
      kubeconfig,
      namespace,
      podName,
      blueprintId,
      ["sh", "-c", `cd "${effectiveWorkDir}" && ${command}`],
      EXEC_TIMEOUT_MS
    );

    await logAction(audit.userId, "REMOTE_EXECUTE", "success", {
      instance_id: instance.id,
      command: command.substring(0, 200),
      exit_code: result.exitCode,
      stdout_size: result.stdout.length,
      stderr_size: result.stderr.length,
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });

    return result;
  } catch (err) {
    console.error("[execute] Command execution failed:", err);
    await logAction(audit.userId, "REMOTE_EXECUTE", "failure", {
      instance_id: instance.id,
      command: command.substring(0, 200),
      error: err instanceof Error ? err.message : "Unknown error",
      ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
    });
    throw new ServerError(
      err instanceof Error ? err.message : "Command execution failed"
    );
  }
}
