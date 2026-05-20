import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStatus } from "@/lib/nexus/ops/status";

// ---------------------------------------------------------------------------
// GET /api/v1/workloads/[id]/status — thin adapter (M2M API key auth)
// Auth: Bearer token validated by middleware → x-user-id header injected
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth from middleware headers ──────────────────────────────────────────
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Fetch instance (supports full UUID or shortId) ────────────────────────
  const isUuid = id.includes("-") && id.length > 30;
  const query = supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id, created_at");

  const { data: instance, error: fetchErr } = isUuid
    ? await query.eq("id", id).single()
    : await query.eq("subdomain", `inst-${id}`).single();

  if (fetchErr || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (instance.user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Operation ─────────────────────────────────────────────────────────────
  const result = await getStatus(instance);
  // M2M clients receive enrichment fields (subdomain, created_at, internalUrl)
  // Strip 'details' — not part of M2M contract
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { details: _d, ...m2mResult } = result;
  return NextResponse.json(m2mResult);
}
