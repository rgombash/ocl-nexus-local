import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { restartWorkload } from "@/lib/nexus/ops/restart";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// POST /api/instances/[id]/restart — thin adapter (UI session auth)
// Admins can restart any instance (is_admin flag bypass).
// ---------------------------------------------------------------------------

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Fetch instance ────────────────────────────────────────────────────────
  const { data: instance, error: fetchErr } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id")
    .eq("id", id)
    .single();

  if (fetchErr || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // ── Ownership check (admin bypass) ────────────────────────────────────────
  if (instance.user_id !== user.id) {
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("flags")
      .eq("id", user.id)
      .single();
    const isAdmin =
      profile?.flags &&
      typeof profile.flags === "object" &&
      (profile.flags as Record<string, unknown>).is_admin === true;
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    await restartWorkload(instance, { userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
