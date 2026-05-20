/**
 * GET /api/v1/blueprints - Discover available blueprints (API key auth)
 * 
 * Returns the complete blueprint registry for programmatic discovery.
 * Agents use this to determine what workloads can be deployed.
 * 
 * Auth: Requires valid Nexus API Key (Bearer token)
 * Audit: BLUEPRINT_LIST_M2M
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { BLUEPRINTS } from "@/lib/nexus/blueprints";

// ---------------------------------------------------------------------------
// GET /api/v1/blueprints
//
// 1. Verify API key auth (middleware sets x-user-id header)
// 2. Update last_used_at timestamp for API key
// 3. Return complete blueprint registry
// 4. Log BLUEPRINT_LIST_M2M audit action
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // ── 1. Auth check ────────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  const apiKeyId = req.headers.get("x-api-key-id");

  if (!userId || !apiKeyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Update API key last_used_at ────────────────────────────────────────
  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKeyId);

  // ── 3. Return blueprint registry ──────────────────────────────────────────
  // Convert BLUEPRINTS object to array and ensure all fields are included
  const blueprints = Object.values(BLUEPRINTS);

  // ── 4. Audit log ───────────────────────────────────────────────────────────
  await logAction(userId, "BLUEPRINT_LIST_M2M", "success", {
    blueprint_count: blueprints.length,
    api_key_id: apiKeyId,
  });

  return NextResponse.json({
    ok: true,
    blueprints,
    count: blueprints.length,
  });
}
