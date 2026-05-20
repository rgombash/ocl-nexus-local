import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getLogs } from "@/lib/nexus/ops/logs";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// GET /api/v1/workloads/[id]/logs — thin adapter (M2M API key auth)
// Auth: Bearer token validated by middleware → x-user-id + x-api-key-id headers
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth from middleware headers ──────────────────────────────────────────
  const userId = request.headers.get("x-user-id");
  const apiKeyId = request.headers.get("x-api-key-id");
  if (!userId || !apiKeyId) {
    return NextResponse.json({ error: "Missing authentication context" }, { status: 401 });
  }

  // ── Query params ──────────────────────────────────────────────────────────
  const lines = parseInt(request.nextUrl.searchParams.get("lines") || "200", 10);
  if (isNaN(lines) || lines < 1 || lines > 10000) {
    return NextResponse.json({ error: "Invalid lines parameter (1-10000)" }, { status: 400 });
  }

  // ── Ownership check (supports full UUID or shortId) ───────────────────────
  const isUuid = id.includes("-") && id.length > 30;
  const query = supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id");
  const { data: instance, error: fetchErr } = isUuid
    ? await query.eq("id", id).single()
    : await query.eq("subdomain", `inst-${id}`).single();

  if (fetchErr || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (instance.user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Balance check ─────────────────────────────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("balance, flags")
    .eq("id", userId)
    .single();

  const balance = parseFloat(String(profile?.balance ?? 0));
  const isVip =
    profile?.flags &&
    typeof profile.flags === "object" &&
    (profile.flags as Record<string, unknown>).is_vip === true;

  if (balance <= 0 && !isVip) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 402 });
  }

  // ── Update API key last_used_at ───────────────────────────────────────────
  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKeyId);

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    const result = await getLogs(instance, lines, { userId, apiKeyId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toResponse(err);
  }
}


