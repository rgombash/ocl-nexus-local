/**
 * src/lib/nexus/index.ts — Barrel export for the Nexus service library.
 *
 * Import from "@/lib/nexus" for convenience.
 */

// Types
export * from "./types";
// Errors
export * from "./errors";
// K8s client helpers
export * from "./client";
// Operations
export { updateDescription } from "./ops/description";
export { getLogs } from "./ops/logs";
export { getStatus } from "./ops/status";
export { restartWorkload } from "./ops/restart";
export { deleteWorkload } from "./ops/delete";
export { executeShellCommand } from "./ops/execute";
export { writeFile, readFile } from "./ops/files";
export { updateConfigSet } from "./ops/config-set";
export { deployWorkload } from "./ops/deploy";
export type { DeployInput } from "./ops/deploy";
