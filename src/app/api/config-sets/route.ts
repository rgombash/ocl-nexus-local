import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { logAction } from "@/lib/audit";

// ---------------------------------------------------------------------------
// GET /api/config-sets
// List all config sets for the authenticated user
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sets, error } = await supabase
    .from("config_sets")
    .select("id, name, description, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[config-sets GET] Error fetching sets:", error);
    return NextResponse.json(
      { error: "Failed to fetch config sets" },
      { status: 500 }
    );
  }

  return NextResponse.json({ sets: sets ?? [] });
}

// ---------------------------------------------------------------------------
// POST /api/config-sets
// Create a new config set
// Body: { name: string, description?: string }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, description } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Name is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  if (name.trim().length > 100) {
    return NextResponse.json(
      { error: "Name must be 100 characters or less" },
      { status: 400 }
    );
  }

  // Check for duplicate name
  const { data: existing } = await supabase
    .from("config_sets")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", name.trim())
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "A config set with this name already exists" },
      { status: 409 }
    );
  }

  const { data: newSet, error } = await supabase
    .from("config_sets")
    .insert({
      user_id: user.id,
      name: name.trim(),
      description: description?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    console.error("[config-sets POST] Error creating set:", error);
    return NextResponse.json(
      { error: "Failed to create config set" },
      { status: 500 }
    );
  }

  await logAction(user.id, "CONFIG_SET_CREATE", "success", {
    set_id: newSet.id,
    name: newSet.name,
  });

  return NextResponse.json({ set: newSet }, { status: 201 });
}
