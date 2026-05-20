import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStatus } from "@/lib/nexus/ops/status";

// ---------------------------------------------------------------------------
// GET /api/instances/[id]/status — thin adapter (UI session auth)
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
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
    .select("id, subdomain, node_id, user_id, status, blueprint_id, created_at")
    .eq("id", id)
    .single();

  if (!instance || instance.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Operation ─────────────────────────────────────────────────────────────
  const result = await getStatus(instance);

  // UI clients don't need enrichment fields (subdomain etc.)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { subdomain: _s, created_at: _c, internalUrl: _i, ...uiResult } = result;
  return NextResponse.json(uiResult);
}


