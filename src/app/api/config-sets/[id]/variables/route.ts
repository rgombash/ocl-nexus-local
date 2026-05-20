import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { encrypt, decrypt } from "@/lib/encryption";
import { syncConfigSetToK8s } from "@/lib/k8s/sync-secrets";

// ---------------------------------------------------------------------------
// GET /api/config-sets/[id]/variables
// List all variables in a config set (values are encrypted in response)
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

  // Verify ownership of the config set
  const { data: set } = await supabase
    .from("config_sets")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!set) {
    return NextResponse.json({ error: "Config set not found" }, { status: 404 });
  }

  const { data: variables, error } = await supabase
    .from("config_variables")
    .select("id, key, created_at, updated_at")
    .eq("set_id", id)
    .order("key", { ascending: true });

  if (error) {
    console.error("[variables GET] Error fetching variables:", error);
    return NextResponse.json(
      { error: "Failed to fetch variables" },
      { status: 500 }
    );
  }

  // Return without values for security (frontend will fetch individual values on demand)
  return NextResponse.json({ variables: variables ?? [] });
}

// ---------------------------------------------------------------------------
// POST /api/config-sets/[id]/variables
// Create or update a variable in a config set
// Body: { key: string, value: string }
// If key exists, it updates the value. If not, creates a new variable.
// After saving, syncs the entire config set to K8s Secret.
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: setId } = await params;
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

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key, value } = body;

  if (!key || typeof key !== "string" || key.trim().length === 0) {
    return NextResponse.json(
      { error: "Key is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  if (value === undefined || typeof value !== "string") {
    return NextResponse.json(
      { error: "Value is required and must be a string" },
      { status: 400 }
    );
  }

  if (key.trim().length > 200) {
    return NextResponse.json(
      { error: "Key must be 200 characters or less" },
      { status: 400 }
    );
  }

  // Validate key format (environment variable naming convention)
  const validKeyPattern = /^[A-Z_][A-Z0-9_]*$/;
  if (!validKeyPattern.test(key.trim())) {
    return NextResponse.json(
      { error: "Key must be uppercase alphanumeric with underscores (e.g., API_KEY)" },
      { status: 400 }
    );
  }

  // Encrypt the value
  const encryptedValue = encrypt(value);

  // Check if variable already exists (UPSERT)
  const { data: existing } = await supabase
    .from("config_variables")
    .select("id")
    .eq("set_id", setId)
    .eq("key", key.trim())
    .single();

  let variable;
  let isUpdate = false;

  if (existing) {
    // Update existing variable
    const { data: updated, error } = await supabase
      .from("config_variables")
      .update({ value: encryptedValue })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      console.error("[variables POST] Error updating variable:", error);
      return NextResponse.json(
        { error: "Failed to update variable" },
        { status: 500 }
      );
    }

    variable = updated;
    isUpdate = true;
  } else {
    // Create new variable
    const { data: created, error } = await supabase
      .from("config_variables")
      .insert({
        set_id: setId,
        key: key.trim(),
        value: encryptedValue,
      })
      .select()
      .single();

    if (error) {
      console.error("[variables POST] Error creating variable:", error);
      return NextResponse.json(
        { error: "Failed to create variable" },
        { status: 500 }
      );
    }

    variable = created;
  }

  // Sync to K8s (best-effort, may fail if no active node)
  try {
    const { data: node } = await supabaseAdmin
      .from("nodes")
      .select("kubeconfig")
      .eq("status", "active")
      .limit(1)
      .single();

    if (node) {
      const kubeconfigDecrypted = decrypt(node.kubeconfig);
      await syncConfigSetToK8s(user.id, setId, kubeconfigDecrypted);
    }
  } catch (err) {
    console.warn(`[variables POST] Failed to sync to K8s:`, err);
    // Don't fail the request if K8s sync fails
  }

  await logAction(
    user.id,
    isUpdate ? "CONFIG_VARIABLE_UPDATE" : "CONFIG_VARIABLE_CREATE",
    "success",
    {
      set_id: setId,
      variable_id: variable.id,
      key: key.trim(),
    }
  );

  return NextResponse.json(
    {
      variable: {
        id: variable.id,
        key: variable.key,
        created_at: variable.created_at,
        updated_at: variable.updated_at,
      },
    },
    { status: isUpdate ? 200 : 201 }
  );
}
