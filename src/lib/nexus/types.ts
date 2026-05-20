/**
 * OCL Nexus — Shared type definitions.
 *
 * Types that cross the boundary between ops/* functions and route adapters.
 * Kept minimal — only types used by more than one file.
 */

// ---------------------------------------------------------------------------
// Database row shapes
// ---------------------------------------------------------------------------

/**
 * Minimal instance row that all ops functions accept.
 * Route adapters must SELECT at least these columns when pre-fetching.
 */
export interface InstanceRow {
  id: string;
  subdomain: string;
  node_id: string;
  user_id: string;
  status: string;
  blueprint_id: string | null;
  config_set_id?: string | null;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Operation result types
// ---------------------------------------------------------------------------

/** Pod status result returned by getStatus(). */
export interface StatusResult {
  status:
    | "pulling"
    | "starting"
    | "running"
    | "error"
    | "suspended"
    | "unknown";
  message: string;
  /**
   * True ONLY when status === 'running' AND the container has passed its readiness probe.
   * Use this in nexus_wait_for_ready loops — it is the canonical "safe to proceed" signal.
   */
  isReady: boolean;
  /** Full public HTTPS URL (e.g. https://inst-a1b2c3d4.oclhosting.com). */
  publicUrl: string;
  /** Always populated — adapters may omit it from the HTTP response. */
  subdomain: string;
  /** Always populated — adapters may omit it from the HTTP response. */
  created_at?: string;
  /** Always populated — adapters may omit it from the HTTP response. */
  internalUrl: string;
  details?: {
    podName?: string;
    phase?: string;
    containerState?: string;
    restartCount?: number;
    age?: number;
    uptime?: number;
    errorReason?: string;
  };
}

/** Logs result returned by getLogs(). */
export interface LogsResult {
  logs: string;
  podName?: string;
  tailLines?: number;
  lineCount?: number;
  message?: string;
  /**
   * Init container logs, automatically included when the main container is failing or
   * has a restart count > 0. Useful for debugging image pull errors, permission issues, etc.
   */
  initLogs?: string;
}

/** Remote command execution result returned by executeShellCommand(). */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** File write result returned by writeFile(). */
export interface FileWriteResult {
  path: string;
  fullPath: string;
}

/** Per-file result entry in a batch write. */
export interface FileWriteBatchItemResult {
  /** Resolved clean path (relative to codeMountPath). Falls back to the raw input path on failure. */
  path: string;
  status: "success" | "failed";
  /** Content size in bytes (present on success). For base64 inputs this is the encoded char count. */
  size?: number;
  /** Error message (present on failure). */
  error?: string;
}

/** Aggregate result returned by writeFiles(). */
export interface FileWriteBatchResult {
  uploaded: number;
  failed: number;
  total_bytes: number;
  results: FileWriteBatchItemResult[];
  message: string;
}

/** File read result returned by readFile(). */
export interface FileReadResult {
  content: string;
  encoding: "utf8" | "base64";
  path: string;
  fullPath: string;
}

/** File list result returned by listFiles(). */
export interface FileListResult {
  files: string[];
  count: number;
  basePath: string;
}

/** File delete result returned by deleteFile(). */
export interface FileDeleteResult {
  path: string;
  fullPath: string;
}

/** Workload deploy result returned by deployWorkload(). */
export interface DeployResult {
  instanceId: string;
  subdomain: string;
  internalUrl: string;
}

// ---------------------------------------------------------------------------
// Audit metadata helper
// ---------------------------------------------------------------------------

/** Audit call context injected by adapters into ops functions. */
export interface AuditCtx {
  userId: string;
  apiKeyId?: string;
}
