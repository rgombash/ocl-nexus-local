import { supabaseAdmin } from "@/lib/supabase-admin";
import { headers } from "next/headers";

// ---------------------------------------------------------------------------
// Lightweight audit logger — writes to public.audit_logs
// ---------------------------------------------------------------------------

export type AuditAction =
  | "INSTANCE_DEPLOY_START"
  | "INSTANCE_DEPLOY_SUCCESS"
  | "INSTANCE_DEPLOY_FAILURE"
  | "INSTANCE_DELETE_START"
  | "INSTANCE_DELETE_SUCCESS"
  | "INSTANCE_DELETE_FAILURE"
  | "INSTANCE_RESTART"
  | "INSTANCE_RESTART_FAILURE"
  | "INSTANCE_REDEPLOY"
  | "INSTANCE_REDEPLOY_FAILURE"
  | "PAYMENT_TOPUP"
  | "WELCOME_CREDIT_CLAIMED"
  | "BACKUP_CREATE_START"
  | "BACKUP_CREATE_FAILURE"
  | "BACKUP_DELETE"
  | "SYSTEM_CRON_BACKUP_START"
  | "SYSTEM_CRON_BACKUP_COMPLETE"
  | "SYSTEM_CRON_SYNC_BACKUP_STATUSES"
  | "SYSTEM_MAINTENANCE_BYPASS"
  | "ZOMBIE_NAMESPACE_DELETE"
  | "GHOST_INSTANCE_MARK_ERROR"
  | "PRUNE_ALL_ZOMBIES"
  | "INSTANCE_SUSPENDED_INSUFFICIENT_FUNDS"
  | "SYSTEM_CRON_USAGE_METER"
  | "SYSTEM_CRON_PRUNE_BURN_RECORDS"
  | "NAMESPACE_CREATE"
  | "NAMESPACE_REUSE"
  | "CONFIG_SET_CREATE"
  | "CONFIG_SET_UPDATE"
  | "CONFIG_SET_DELETE"
  | "CONFIG_VARIABLE_CREATE"
  | "CONFIG_VARIABLE_UPDATE"
  | "CONFIG_VARIABLE_DELETE"
  | "CONFIG_SET_CHANGE"
  | "SECRET_SYNC_SUCCESS"
  | "SECRET_SYNC_FAILURE"
  | "LOGS_VIEW"
  | "SHELL_COMMAND_EXECUTE"
  | "SHELL_COMMAND_FAILURE"
  | "INSTANCE_DESCRIPTION_UPDATE"
  | "API_KEY_CREATE"
  | "API_KEY_REVOKE"
  | "API_KEY_USE"
  | "FILES_UPLOAD"
  | "REMOTE_EXECUTE"
  | "LOGS_VIEW_M2M"
  | "FILE_READ_M2M"
  | "BLUEPRINT_LIST_M2M"
  | "WORKLOAD_LIST_M2M"
  | "FILES_LIST"
  | "FILES_DELETE"
  | "MCP_TOOL_CALL"
  | "INSTANCE_LIMIT_REACHED";

export type AuditStatus = "started" | "success" | "failure";

/**
 * Log a significant action to public.audit_logs.
 *
 * Automatically captures the caller's IP from request headers when
 * called inside a server component or route handler.
 */
export async function logAction(
  userId: string | null,
  action: AuditAction,
  status: AuditStatus,
  metadata?: Record<string, unknown>
) {
  let ipAddress: string | null = null;
  try {
    const hdrs = await headers();
    ipAddress =
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      hdrs.get("x-real-ip") ??
      null;
  } catch {
    // headers() unavailable outside request context — skip IP capture
  }

  const { error } = await supabaseAdmin.from("audit_logs").insert({
    user_id: userId,
    action,
    status,
    metadata: metadata ?? {},
    ip_address: ipAddress,
  });

  if (error) {
    console.error("[audit] Failed to write audit log:", error);
  }
}
