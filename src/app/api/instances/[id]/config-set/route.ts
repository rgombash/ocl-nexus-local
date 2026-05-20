import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { updateConfigSet } from "@/lib/nexus/ops/config-set";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// PATCH /api/instances/[id]/config-set — thin adapter (UI session auth)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Ownership check ───────────────────────────────────────────────────────
  const { data: instance, error: fetchErr } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id, config_set_id")
    .eq("id", id)
    .single();

  if (fetchErr || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (instance.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let newConfigSetId: string | null = null;
  try {
    const body = await request.json();
    if (body.configSetId !== undefined) {
      newConfigSetId = body.configSetId === "" ? null : body.configSetId;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── Validate config set ownership ─────────────────────────────────────────
  if (newConfigSetId) {
    const { data: configSet } = await supabaseAdmin
      .from("config_sets")
      .select("id")
      .eq("id", newConfigSetId)
      .eq("user_id", user.id)
      .single();
    if (!configSet) {
      return NextResponse.json({ error: "Config set not found" }, { status: 404 });
    }
  }

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    await updateConfigSet(instance, newConfigSetId, { userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
