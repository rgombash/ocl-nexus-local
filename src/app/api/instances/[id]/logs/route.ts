import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getLogs } from "@/lib/nexus/ops/logs";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// GET /api/instances/[id]/logs — thin adapter (UI session auth)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Ownership check ───────────────────────────────────────────────────────
  const { data: instance } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id")
    .eq("id", id)
    .single();

  if (!instance || instance.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Query params ──────────────────────────────────────────────────────────
  const tailLines = parseInt(
    request.nextUrl.searchParams.get("lines") || "200",
    10
  );

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    const result = await getLogs(instance, tailLines, { userId: user.id });
    return NextResponse.json(result);
  } catch (err) {
    return toResponse(err);
  }
}
