/**
 * POST /api/instances/deploy — thin adapter (UI session auth)
 *
 * Auth + balance + validation → deployWorkload() → format response.
 * Core K8s provisioning lives in src/lib/nexus/ops/deploy.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hasFlag } from "@/lib/flags";
import { deployWorkload } from "@/lib/nexus/ops/deploy";
import { toResponse } from "@/lib/nexus/errors";
import { isAuthorized, getAuthorizationError } from "@/lib/auth/authorization";

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Parse body ────────────────────────────────────────────────────────────
  let blueprintId = "openclaw";
  let configSetId: string | null = null;
  let userDescription: string | null = null;
  try {
    const body = await req.json();
    if (body.blueprintId && typeof body.blueprintId === "string") blueprintId = body.blueprintId;
    if (body.configSetId && typeof body.configSetId === "string") configSetId = body.configSetId;
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
    .eq("id", user.id)
    .single();

  if (!isAuthorized(profile)) {
    const error = getAuthorizationError(profile);
    return NextResponse.json({ error }, { status: 403 });
  }

  // ── Validate config set ownership ─────────────────────────────────────────
  if (configSetId) {
    const { data: configSet } = await supabaseAdmin
      .from("config_sets")
      .select("id")
      .eq("id", configSetId)
      .eq("user_id", user.id)
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

  // ── Deploy ────────────────────────────────────────────────────────────────
  try {
    const result = await deployWorkload(
      { userId: user.id, blueprintId, configSetId, userDescription, useStaging },
    );
    return NextResponse.json(
      { ok: true, subdomain: result.subdomain, instance_id: result.instanceId },
      { status: 200 }
    );
  } catch (err) {
    return toResponse(err);
  }
}
