// ---------------------------------------------------------------------------
// K8s Exec Utility
//
// Runs a command inside a running pod container via the Kubernetes exec API
// and returns stdout as a string.
//
// Uses @kubernetes/client-node v1.x Exec class (WebSocket-backed).
// ---------------------------------------------------------------------------

import * as k8s from "@kubernetes/client-node";
import { PassThrough } from "stream";

const EXEC_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB cap — prevents memory exhaustion from runaway output

/**
 * Execute a command inside a container of a specific pod.
 *
 * @param kubeconfig    - Raw kubeconfig YAML/JSON string
 * @param namespace     - Kubernetes namespace (e.g. "u-c15453c9")
 * @param podName       - Full pod name (e.g. "app-7cd9e6aa-6664499b66-g8vzc")
 * @param containerName - Container name inside the pod (e.g. "openclaw", "nanoclaw")
 * @param command       - argv array (resolved via resolveCommand)
 * @param timeoutMs     - Max ms to wait; if the process produced output but didn't
 *                        exit by this deadline (e.g. interactive pairing flow), the
 *                        accumulated stdout is resolved rather than rejected.
 * @param tty           - Allocate a PTY in the container. Required for commands that
 *                        buffer stdout when connected to a pipe (isatty check). With
 *                        tty:true K8s merges stderr into the stdout WebSocket channel;
 *                        a dummy stdin stream is passed so the process has a fully
 *                        functional controlling terminal without blocking on input.
 * @returns stdout output as a UTF-8 string
 * @throws on timeout with no output, non-zero exit, or WebSocket error
 */
export function executeCommand(
  kubeconfig: string,
  namespace: string,
  podName: string,
  containerName: string,
  command: string[],
  timeoutMs = EXEC_TIMEOUT_MS,
  tty = false
): Promise<string> {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  const exec = new k8s.Exec(kc);

  return new Promise<string>((resolve, reject) => {
    const stdout = new PassThrough();
    // In TTY mode K8s merges stderr into the stdout WebSocket channel, so we
    // don't need a separate stderr stream. For non-TTY we keep stderr to surface
    // error detail in the status callback.
    const stderr = tty ? null : new PassThrough();
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    // quietTimer fires QUIET_MS after the last data chunk arrives, but ONLY once
    // MIN_CONTENT_BYTES have been received. This prevents resolving on just the
    // startup banner (~200 bytes) before the actual QR payload (~3000 bytes) has
    // been printed. Without the threshold, a 10s pause between banner and QR
    // causes the quiet timer to fire and SIGHUP the process before the QR arrives.
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const QUIET_MS = 3000;
    const MIN_CONTENT_BYTES = 500; // banner < 500b; QR >> 500b

    stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        settle(new Error("Command output exceeded 2 MB limit"));
        return;
      }
      outChunks.push(Buffer.from(chunk));
      // Only arm the quiet timer once we've received enough content to know the
      // meaningful output (QR) has started arriving.
      if (tty && outBytes >= MIN_CONTENT_BYTES) {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          settle(undefined, Buffer.concat(outChunks).toString("utf-8"));
        }, QUIET_MS);
      }
    });
    stderr?.on("data", (chunk: Buffer) => errChunks.push(Buffer.from(chunk)));

    let settled = false;
    const settle = (err?: Error, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(quietTimer);
      stdout.destroy();
      stderr?.destroy();
      stdin?.destroy(); // release PTY stdin → SIGHUP → process exits
      if (err) reject(err);
      else resolve(output ?? "");
    };

    // Hard safety timeout: if no output at all, surface an error; if there is
    // output but the quiet timer somehow never fired, resolve with it.
    const timer = setTimeout(() => {
      if (outBytes > 0) {
        settle(undefined, Buffer.concat(outChunks).toString("utf-8"));
      } else {
        settle(new Error(`Command timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    // TTY mode: keep stdin open (do NOT call stdin.end()) so the process does not
    // receive EOF/SIGHUP before it has a chance to print output. The stream is
    // destroyed in settle() when the timeout fires and we've captured the QR.
    const stdin = tty ? new PassThrough() : null;

    exec
      .exec(
        namespace,
        podName,
        containerName, // dynamic container name based on blueprint
        command,
        stdout,
        stderr,   // null in TTY mode — stderr merged into stdout by K8s
        stdin,
        tty,
        (status: k8s.V1Status) => {
          if (status.status === "Success") {
            settle(undefined, Buffer.concat(outChunks).toString("utf-8"));
          } else {
            const errDetail =
              Buffer.concat(errChunks).toString("utf-8").trim() ||
              status.message ||
              "Command exited with non-zero status";
            settle(new Error(errDetail));
          }
        }
      )
      .catch((err: Error) => settle(err));
  });
}
