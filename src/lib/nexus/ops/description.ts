/**
 * ops/description.ts — Instance description update
 *
 * Updates the user_description field on an instance row.
 * DB-only operation — no K8s interaction required.
 * Used by: UI PATCH /api/instances/[id]/description
 * Audit: INSTANCE_DESCRIPTION_UPDATE
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { ServerError } from "@/lib/nexus/errors";
import type { InstanceRow, AuditCtx } from "@/lib/nexus/types";

/**
 * Update the user_description field for an instance.
 * Ownership verification is the adapter's responsibility.
 *
 * @param instance - Pre-fetched instance row (adapter must verify ownership)
 * @param userDescription - New description string, or null to clear it
 * @param audit - Audit context (userId, optional apiKeyId)
 */
export async function updateDescription(
  instance: InstanceRow,
  userDescription: string | null,
  audit: AuditCtx
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("instances")
    .update({ user_description: userDescription })
    .eq("id", instance.id);

  if (error) {
    console.error("[description] DB update failed:", error);
    throw new ServerError("Failed to update description");
  }

  await logAction(audit.userId, "INSTANCE_DESCRIPTION_UPDATE", "success", {
    instanceId: instance.id,
    description: userDescription,
    ...(audit.apiKeyId && { api_key_id: audit.apiKeyId }),
  });
}
