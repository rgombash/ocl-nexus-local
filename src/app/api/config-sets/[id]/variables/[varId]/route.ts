import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { decrypt } from "@/lib/encryption";
import { syncConfigSetToK8s } from "@/lib/k8s/sync-secrets";

// ---------------------------------------------------------------------------
// GET /api/config-sets/[id]/variables/[varId]
// Get a specific variable with its decrypted value
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; varId: string }> }
) {
  const { id: setId, varId } = await params;
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify ownership of the config set
  const { data: set } = await supabase
    .from("config_sets")
    .select("id")
    .eq("id", setId)
    .eq("user_id", user.id)
    .single();

  if (!set) {
    return NextResponse.json({ error: "Config set not found" }, { status: 404 });
  }

  // Fetch the variable
  const { data: variable, error } = await supabase
    .from("config_variables")
    .select("id, key, value, created_at, updated_at")
    .eq("id", varId)
    .eq("set_id", setId)
    .single();

  if (error || !variable) {
    return NextResponse.json({ error: "Variable not found" }, { status: 404 });
  }

  // Decrypt the value
  let decryptedValue: string;
  try {
    decryptedValue = decrypt(variable.value);
  } catch (err) {
    console.error("[variable GET] Decryption failed:", err);
    return NextResponse.json(
      { error: "Failed to decrypt variable value" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    variable: {
      id: variable.id,
      key: variable.key,
      value: decryptedValue,
      created_at: variable.created_at,
      updated_at: variable.updated_at,
    },
  });
}

// ---------------------------------------------------------------------------
// DELETE /api/config-sets/[id]/variables/[varId]
// Delete a variable from a config set
// After deletion, re-syncs the config set to K8s Secret
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; varId: string }> }
) {
  const { id: setId, varId } = await params;
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify ownership
  const { data: set } = await supabase
    .from("config_sets")
    .select("id")
    .eq("id", setId)
    .eq("user_id", user.id)
    .single();

  if (!set) {
    return NextResponse.json({ error: "Config set not found" }, { status: 404 });
  }

  // Fetch variable details before deletion
  const { data: variable } = await supabase
    .from("config_variables")
    .select("id, key")
    .eq("id", varId)
    .eq("set_id", setId)
    .single();

  if (!variable) {
    return NextResponse.json({ error: "Variable not found" }, { status: 404 });
  }

  // Delete the variable
  const { error } = await supabase
    .from("config_variables")
    .delete()
    .eq("id", varId)
    .eq("set_id", setId);

  if (error) {
    console.error("[variable DELETE] Error deleting variable:", error);
    return NextResponse.json(
      { error: "Failed to delete variable" },
      { status: 500 }
    );
  }

  // Re-sync to K8s (best-effort)
  try {
    const { data: node } = await supabaseAdmin
      .from("nodes")
      .select("kubeconfig")
      .eq("status", "active")
      .limit(1)
      .single();

    if (node) {
      const kubeconfigDecrypted = decrypt(node.kubeconfig);
      // Check if there are any remaining variables
      const { data: remainingVars } = await supabase
        .from("config_variables")
        .select("id")
        .eq("set_id", setId)
        .limit(1);

      if (remainingVars && remainingVars.length > 0) {
        // Sync updated secret
        await syncConfigSetToK8s(user.id, setId, kubeconfigDecrypted);
      }
      // If no variables remain, the secret will be empty but still exist
      // This is acceptable - it will be deleted when the config set is deleted
    }
  } catch (err) {
    console.warn(`[variable DELETE] Failed to re-sync to K8s:`, err);
    // Don't fail the request if K8s sync fails
  }

  await logAction(user.id, "CONFIG_VARIABLE_DELETE", "success", {
    set_id: setId,
    variable_id: varId,
    key: variable.key,
  });

  return NextResponse.json({ success: true });
}
