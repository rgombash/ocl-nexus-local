import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { restartWorkload } from "@/lib/nexus/ops/restart";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// POST /api/v1/workloads/[id]/restart — thin adapter (M2M API key auth)
// Auth: Bearer token validated by middleware → x-user-id + x-api-key-id headers
// No admin bypass — strict ownership enforced.
// ---------------------------------------------------------------------------

export async function POST(
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

  // ── Update API key last_used_at ───────────────────────────────────────────
  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKeyId);

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    await restartWorkload(instance, { userId, apiKeyId });
    return NextResponse.json({ ok: true, message: "Restart triggered" });
  } catch (err) {
    return toResponse(err);
  }
}
