import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { deleteWorkload } from "@/lib/nexus/ops/delete";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// DELETE /api/instances/[id] — thin adapter (UI session auth)
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
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
    .select("id, subdomain, node_id, user_id, status, blueprint_id")
    .eq("id", id)
    .single();

  if (fetchErr || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (instance.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    await deleteWorkload(instance, { userId: user.id });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toResponse(err);
  }
}
