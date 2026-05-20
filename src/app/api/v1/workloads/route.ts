/**
 * POST /api/v1/workloads — Deploy a workload (M2M API key auth)
 * GET  /api/v1/workloads — List all workloads (M2M API key auth)
 *
 * Thin adapters. Core deploy logic in src/lib/nexus/ops/deploy.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hasFlag } from "@/lib/flags";
import { logAction } from "@/lib/audit";
import { deployWorkload } from "@/lib/nexus/ops/deploy";
import { toResponse } from "@/lib/nexus/errors";
import { INFRA_DOMAIN } from "@/lib/config/nexus";
import { isAuthorized, getAuthorizationError } from "@/lib/auth/authorization";

// ---------------------------------------------------------------------------
// POST /api/v1/workloads
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // ── Auth (injected by middleware) ─────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  const apiKeyId = req.headers.get("x-api-key-id");
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Parse body ────────────────────────────────────────────────────────────
  let blueprintId = "openclaw";
  let configSetId: string | null = null;
  let userDescription: string | null = null;
  try {
    const body = await req.json();
    if (body.blueprintId && typeof body.blueprintId === "string") blueprintId = body.blueprintId;
    if (body.blueprint_id && typeof body.blueprint_id === "string") blueprintId = body.blueprint_id;
    if (body.configSetId && typeof body.configSetId === "string") configSetId = body.configSetId;
    if (body.config_set_id && typeof body.config_set_id === "string") configSetId = body.config_set_id;
    if (body.userDescription && typeof body.userDescription === "string") {
      userDescription = body.userDescription.trim() || null;
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  // ── Balance check (bypassed in local mode) ────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("balance, flags")
    .eq("id", userId)
    .single();

  if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!isAuthorized(profile)) {
    const error = getAuthorizationError(profile);
    return NextResponse.json({ error }, { status: 402 });
  }

  // ── Validate config set ownership ─────────────────────────────────────────
  if (configSetId) {
    const { data: configSet } = await supabaseAdmin
      .from("config_sets")
      .select("id")
      .eq("id", configSetId)
      .eq("user_id", userId)
      .single();
    if (!configSet) {
      return NextResponse.json({ error: "Config set not found" }, { status: 404 });
    }
  }

  const useStaging = hasFlag(
    profile?.flags as Record<string, unknown> | null | undefined,
    "use_staging_node",
    false
  ) as boolean;

  // ── Update API key last_used_at ────────────────────────────────────────────
  if (apiKeyId) {
    await supabaseAdmin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", apiKeyId);
  }

  // ── Deploy ────────────────────────────────────────────────────────────────
  try {
    const result = await deployWorkload(
      {
        userId,
        blueprintId,
        configSetId,
        userDescription,
        useStaging,
        apiKeyId,
      },
    );
    return NextResponse.json(
      {
        ok: true,
        subdomain: result.subdomain,
        instanceId: result.instanceId,
        instance_id: result.instanceId,
        internalUrl: result.internalUrl,
        publicUrl: `https://${result.subdomain}.${INFRA_DOMAIN}`,
      },
      { status: 200 }
    );
  } catch (err) {
    return toResponse(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/workloads — List workloads
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  const apiKeyId = req.headers.get("x-api-key-id");
  if (!userId || !apiKeyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKeyId);

  const { data: instances, error } = await supabaseAdmin
    .from("instances")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch instances:", error);
    return NextResponse.json({ error: "Failed to fetch workloads" }, { status: 500 });
  }

  const workloads = (instances || []).map((instance) => {
    const shortId = instance.subdomain.replace("inst-", "");
    const internalUrl = `http://svc-${shortId}:80`;
    return {
      id: instance.id,
      subdomain: instance.subdomain,
      blueprint_id: instance.blueprint_id,
      status: instance.status,
      created_at: instance.created_at,
      node_id: instance.node_id,
      user_description: instance.user_description,
      config_set_id: instance.config_set_id,
      internalUrl,
    };
  });

  await logAction(userId, "WORKLOAD_LIST_M2M", "success", {
    workload_count: workloads.length,
    api_key_id: apiKeyId,
  });

  return NextResponse.json({ ok: true, workloads, count: workloads.length });
}
