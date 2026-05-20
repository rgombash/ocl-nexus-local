/**
 * DELETE /api/v1/workloads/[id] — thin adapter (M2M API key auth)
 * Auth: Bearer token validated by middleware → x-user-id + x-api-key-id headers
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { deleteWorkload } from "@/lib/nexus/ops/delete";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// DELETE /api/v1/workloads/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth from middleware headers ──────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  const apiKeyId = req.headers.get("x-api-key-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    await deleteWorkload(instance, {
      userId,
      ...(apiKeyId && { apiKeyId }),
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toResponse(err);
  }
}
