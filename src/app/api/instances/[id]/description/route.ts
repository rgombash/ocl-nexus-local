import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { updateDescription } from "@/lib/nexus/ops/description";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// PATCH /api/instances/[id]/description — thin adapter
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Ownership check ───────────────────────────────────────────────────────
  const { data: instance } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id")
    .eq("id", params.id)
    .single();

  if (!instance || instance.user_id !== user.id) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let userDescription: string | null = null;
  try {
    const body = await req.json();
    if (body.userDescription !== undefined) {
      userDescription =
        typeof body.userDescription === "string"
          ? body.userDescription.trim() || null
          : null;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    await updateDescription(instance, userDescription, { userId: user.id });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toResponse(err);
  }
}
