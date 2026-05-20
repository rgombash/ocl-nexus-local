import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hasFlag } from "@/lib/flags";

/**
 * GET /api/v1/test
 *
 * Test endpoint for validating API key authentication.
 *
 * Flow:
 * 1. Middleware validates the API key and injects x-user-id header
 * 2. This endpoint reads the user_id from the header
 * 3. Fetches user profile and checks authorization (balance > 0 || is_vip)
 * 4. Returns user info if authorized, 403 if insufficient balance
 *
 * Usage:
 *   curl -H "Authorization: Bearer nx_..." http://localhost:3000/api/v1/test
 */
export async function GET(request: NextRequest) {
  // ── Extract user_id from middleware-injected header ────────────────────
  const userId = request.headers.get("x-user-id");
  const keyId = request.headers.get("x-api-key-id");

  if (!userId) {
    // This should never happen if middleware is working correctly
    return NextResponse.json(
      { error: "User ID not found in request headers" },
      { status: 500 }
    );
  }

  // ── Fetch user profile ──────────────────────────────────────────────────
  const { data: profile, error } = await supabaseAdmin
    .from("users")
    .select("email, balance, flags")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 404 }
    );
  }

  // ── Authorization check (balance > 0 || is_vip) ────────────────────────
  const isVip = hasFlag<boolean>(
    profile.flags as Record<string, unknown> | null | undefined,
    "is_vip",
    false
  ) === true;

  const balance = parseFloat(String(profile.balance ?? 0));

  if (balance <= 0 && !isVip) {
    return NextResponse.json(
      { error: "Not authorized.", balance, isVip },
      { status: 403 }
    );
  }

  // ── Success response ────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    message: "API key authentication successful",
    user: {
      id: userId,
      email: profile.email,
      balance,
      isVip,
    },
    keyId,
  });
}
