import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { writeFile, readFile, deleteFile } from "@/lib/nexus/ops/files";
import { toResponse } from "@/lib/nexus/errors";

// ---------------------------------------------------------------------------
// POST /api/v1/workloads/[id]/files — thin adapter (M2M API key auth)
// GET  /api/v1/workloads/[id]/files — thin adapter (M2M API key auth)
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await resolveInstance(req, id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let path: string, content: string, encoding: "utf8" | "base64";
  try {
    const body = await req.json();
    path = body.path;
    content = body.content;
    encoding = body.encoding || "utf8";
    if (!path || typeof path !== "string") throw new Error("Missing or invalid 'path' field");
    if (!content || typeof content !== "string") throw new Error("Missing or invalid 'content' field");
    if (encoding !== "utf8" && encoding !== "base64") throw new Error("Invalid encoding — must be 'utf8' or 'base64'");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request body" },
      { status: 400 }
    );
  }

  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", ctx.apiKeyId);

  try {
    const result = await writeFile(ctx.instance, path, content, encoding, {
      userId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
    });
    return NextResponse.json({
      ok: true,
      path: result.path,
      fullPath: result.fullPath,
      message: "File uploaded successfully",
    });
  } catch (err) {
    return toResponse(err);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await resolveInstance(req, id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const searchParams = req.nextUrl.searchParams;
  const path = searchParams.get("path");
  const encoding = (searchParams.get("encoding") || "utf8") as "utf8" | "base64";

  if (!path) {
    return NextResponse.json({ error: "Missing required query parameter: path" }, { status: 400 });
  }
  if (encoding !== "utf8" && encoding !== "base64") {
    return NextResponse.json({ error: "Invalid encoding — must be 'utf8' or 'base64'" }, { status: 400 });
  }
  if (path.includes("..") || path.includes("~")) {
    return NextResponse.json({ error: "Invalid path — directory traversal not allowed" }, { status: 400 });
  }
  if (path.startsWith("/") && !path.startsWith("/app")) {
    return NextResponse.json({ error: "Invalid path — only paths within code directory allowed" }, { status: 400 });
  }

  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", ctx.apiKeyId);

  try {
    const result = await readFile(ctx.instance, path, encoding, {
      userId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
    });
    await logAction(ctx.userId, "FILE_READ_M2M", "success", {
      instance_id: ctx.instance.id,
      file_path: result.path,
      file_size_bytes: result.content.length,
      encoding,
      api_key_id: ctx.apiKeyId,
    });
    return NextResponse.json({
      ok: true,
      path: result.path,
      fullPath: result.fullPath,
      content: result.content.trim(),
      encoding,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logAction(ctx.userId, "FILE_READ_M2M", "failure", {
      instance_id: ctx.instance.id,
      file_path: path,
      error: errMsg,
      api_key_id: ctx.apiKeyId,
    });
    if (errMsg.includes("No such file") || errMsg.includes("cannot open")) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return toResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await resolveInstance(req, id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const path = req.nextUrl.searchParams.get("path");

  if (!path) {
    return NextResponse.json(
      { error: "Missing required query parameter: path" },
      { status: 400 }
    );
  }
  if (path.includes("..") || path.includes("~")) {
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
    const result = await deleteFile(ctx.instance, path, {
      userId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
    });
    return NextResponse.json({
      ok: true,
      path: result.path,
      fullPath: result.fullPath,
      message: "File deleted successfully",
    });
  } catch (err) {
    return toResponse(err);
  }
}

