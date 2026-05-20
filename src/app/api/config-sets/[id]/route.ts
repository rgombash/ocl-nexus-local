import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { decrypt } from "@/lib/encryption";
import { deleteConfigSetFromK8s } from "@/lib/k8s/sync-secrets";

// ---------------------------------------------------------------------------
// GET /api/config-sets/[id]
// Get a specific config set (without variables)
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: set, error } = await supabase
    .from("config_sets")
    .select("id, name, description, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !set) {
    return NextResponse.json({ error: "Config set not found" }, { status: 404 });
  }

  return NextResponse.json({ set });
}

// ---------------------------------------------------------------------------
// PUT /api/config-sets/[id]
// Update a config set (name and/or description only)
// Body: { name?: string, description?: string }
// ---------------------------------------------------------------------------
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify ownership
  const { data: existing } = await supabase
    .from("config_sets")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Config set not found" }, { status: 404 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, description } = body;

  // Build update object
  const updates: { name?: string; description?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name must be a non-empty string" },
        { status: 400 }
      );
    }
    if (name.trim().length > 100) {
      return NextResponse.json(
        { error: "Name must be 100 characters or less" },
        { status: 400 }
      );
    }
    updates.name = name.trim();
  }

  if (description !== undefined) {
    updates.description = description?.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Check for duplicate name if renaming
  if (updates.name) {
    const { data: duplicate } = await supabase
      .from("config_sets")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", updates.name)
      .neq("id", id)
      .single();

    if (duplicate) {
      return NextResponse.json(
        { error: "A config set with this name already exists" },
        { status: 409 }
      );
    }
  }

  const { data: updatedSet, error } = await supabase
    .from("config_sets")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    console.error("[config-sets PUT] Error updating set:", error);
    return NextResponse.json(
      { error: "Failed to update config set" },
      { status: 500 }
    );
  }

  await logAction(user.id, "CONFIG_SET_UPDATE", "success", {
    set_id: id,
    updates,
  });

  return NextResponse.json({ set: updatedSet });
}

// ---------------------------------------------------------------------------
// DELETE /api/config-sets/[id]
// Delete a config set and its variables
// Also deletes the K8s Secret if the user has any active instances
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    .select("id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!set) {
    return NextResponse.json({ error: "Config set not found" }, { status: 404 });
  }

  // Check if any instances are using this config set
  const { data: instances } = await supabase
    .from("instances")
    .select("id, subdomain")
    .eq("config_set_id", id)
    .eq("user_id", user.id);

  if (instances && instances.length > 0) {
    return NextResponse.json(
      {
        error: "Cannot delete config set in use by instances",
        instances: instances.map((i: { subdomain: string }) => i.subdomain),
      },
      { status: 409 }
    );
  }

  // Try to delete K8s Secret (best-effort, may not exist)
  try {
    // Get any node's kubeconfig (we need it to connect to K8s)
    const { data: node } = await supabaseAdmin
      .from("nodes")
      .select("kubeconfig")
      .eq("status", "active")
      .limit(1)
      .single();

    if (node) {
      const kubeconfigDecrypted = decrypt(node.kubeconfig);
      await deleteConfigSetFromK8s(user.id, id, kubeconfigDecrypted);
    }
  } catch (err) {
    console.warn(`[config-sets DELETE] Failed to delete K8s Secret for set ${id}:`, err);
    // Continue with DB deletion even if K8s deletion fails
  }

  // Delete from database (CASCADE will delete all variables)
  const { error } = await supabase
    .from("config_sets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[config-sets DELETE] Error deleting set:", error);
    return NextResponse.json(
      { error: "Failed to delete config set" },
      { status: 500 }
    );
  }

  await logAction(user.id, "CONFIG_SET_DELETE", "success", {
    set_id: id,
    name: set.name,
  });

  return NextResponse.json({ success: true });
}
