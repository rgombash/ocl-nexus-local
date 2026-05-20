import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { executeShellCommand } from "@/lib/nexus/ops/execute";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// POST /api/v1/workloads/[id]/execute — thin adapter (M2M API key auth)
// Auth: Bearer token validated by middleware → x-user-id + x-api-key-id headers
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth from middleware headers ──────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  const apiKeyId = req.headers.get("x-api-key-id");
  if (!userId || !apiKeyId) {
    return NextResponse.json({ error: "Missing authentication context" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let command: string;
  let workDir: string | undefined;
  try {
    const body = await req.json();
    command = body.command;
    workDir = body.workDir;
    if (!command || typeof command !== "string") throw new Error("Missing or invalid 'command' field");
    if (workDir !== undefined && typeof workDir !== "string") throw new Error("Invalid 'workDir' field");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request body" },
      { status: 400 }
    );
  }

  // ── Balance check ─────────────────────────────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("balance, flags")
    .eq("id", userId)
    .single();
  const balance = parseFloat(String(profile?.balance ?? 0));
  const isVip =
    profile?.flags && typeof profile.flags === "object"
      ? (profile.flags as Record<string, unknown>).is_vip === true
      : false;
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

  // ── Operation ─────────────────────────────────────────────────────────────
  try {
    const result = await executeShellCommand(instance, command, workDir, { userId, apiKeyId });
    return NextResponse.json({
      ok: true,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (err) {
    return toResponse(err);
  }
}
