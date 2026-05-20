import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listFiles } from "@/lib/nexus/ops/files";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// GET /api/v1/workloads/[id]/files/list — thin adapter (M2M API key auth)
//
// Query params:
//   path  (optional) — subdirectory to list, relative to codeMountPath
// ---------------------------------------------------------------------------

// ── Shared: auth + ownership check ──────────────────────────────────────────
async function resolveInstance(req: NextRequest, id: string) {
  const userId = req.headers.get("x-user-id");
  const apiKeyId = req.headers.get("x-api-key-id");
  if (!userId || !apiKeyId) return { error: "Missing authentication context", status: 401 } as const;

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
  if (balance <= 0 && !isVip) return { error: "Insufficient balance", status: 402 } as const;

  const isUuid = id.includes("-") && id.length > 30;
  const query = supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id");
  const { data: instance, error: fetchErr } = isUuid
    ? await query.eq("id", id).single()
    : await query.eq("subdomain", `inst-${id}`).single();
  if (fetchErr || !instance) return { error: "Instance not found", status: 404 } as const;
  if (instance.user_id !== userId) return { error: "Forbidden", status: 403 } as const;

  return { instance, userId, apiKeyId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await resolveInstance(req, id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const dirPath = req.nextUrl.searchParams.get("path") ?? undefined;

  if (dirPath && (dirPath.includes("..") || dirPath.includes("~"))) {
    return NextResponse.json(
      { error: "Invalid path — directory traversal not allowed" },
      { status: 400 }
    );
  }

  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", ctx.apiKeyId);

  try {
    const result = await listFiles(ctx.instance, dirPath, {
      userId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
    });
    return NextResponse.json({
      ok: true,
      files: result.files,
      count: result.count,
      basePath: result.basePath,
    });
  } catch (err) {
    return toResponse(err);
  }
}
