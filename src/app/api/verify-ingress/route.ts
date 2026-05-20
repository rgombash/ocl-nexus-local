import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { validateApiKey } from "@/lib/auth/api-auth";
import { hasFlag } from "@/lib/flags";
import { isLocalMode } from "@/lib/auth/dev-user";
import { INFRA_DOMAIN } from "@/lib/config/nexus";

// In local mode, we need Node.js runtime for postgres package
// In cloud mode, we can use Edge runtime for performance
export const runtime = process.env.NEXUS_MODE === "local" ? "nodejs" : "edge";

// ── Module-level auth cache ───────────────────────────────────────────────────
// Edge workers reuse the module across warm requests. Caching by auth identity
// (token / userId / subdomain) rather than the full request tuple means agents
// hitting varied paths on the same service still get cache hits on the DB lookups.

interface CacheEntry<T> { value: T; expiresAt: number }

const TTL_KEY      = 5 * 60 * 1000;  // 5 min — keys are revoked rarely
const TTL_USER     =      60 * 1000;  // 60 s  — balance changes infrequently
const TTL_INSTANCE =      30 * 1000;  // 30 s  — matches Traefik cache window

const keyCache      = new Map<string, CacheEntry<{ userId: string; keyId: string }>>();
const userCache     = new Map<string, CacheEntry<{ balance: number; isVip: boolean }>>();
const instanceCache = new Map<string, CacheEntry<{ userId: string; status: string }>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, k: string): T | null {
  const e = map.get(k);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { map.delete(k); return null; }
  return e.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, k: string, v: T, ttlMs: number): void {
  if (map.size >= 500) map.clear(); // safety cap against unique-key floods
  map.set(k, { value: v, expiresAt: Date.now() + ttlMs });
}

async function resolveUser(userId: string): Promise<{ balance: number; isVip: boolean } | null> {
  const hit = cacheGet(userCache, userId);
  if (hit) return hit;
  const { data } = await supabaseAdmin
    .from("users")
    .select("balance, flags")
    .eq("id", userId)
    .single();
  if (!data) return null;
  const result = {
    balance: parseFloat(String(data.balance ?? 0)),
    isVip: hasFlag<boolean>(
      data.flags as Record<string, unknown> | null | undefined,
      "is_vip",
      false
    ),
  };
  cacheSet(userCache, userId, result, TTL_USER);
  return result;
}

async function resolveInstance(subdomain: string): Promise<{ userId: string; status: string } | null> {
  const hit = cacheGet(instanceCache, subdomain);
  if (hit) return hit;
  const { data, error } = await supabaseAdmin
    .from("instances")
    .select("user_id, status")
    .eq("subdomain", subdomain)
    .single();
  if (error || !data) return null;
  const result = { userId: data.user_id, status: data.status };
  cacheSet(instanceCache, subdomain, result, TTL_INSTANCE);
  return result;
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/verify-ingress
 *
 * Traefik ForwardAuth endpoint. Called by Traefik on every request to
 * tenant subdomains before forwarding traffic to the tenant container.
 *
 * Authentication Methods (in order):
 *   1. Local mode bypass (always allow if subdomain exists)
 *   2. Supabase session cookies (user login via dashboard)
 *   3. Bearer token (API key for automated tools/agents)
 *
 * Flow:
 *   1. Extract subdomain from X-Forwarded-Host or ?subdomain= param
 *   2. Local mode: verify subdomain exists, return 200 OK
 *   3. Cloud mode: authenticate user, verify ownership, check balance
 *   4. Return 200 (allow), 401/redirect (not logged in), or 403 (not owner / inactive)
 */
export async function GET(request: NextRequest) {
  // ── 1. Extract subdomain ────────────────────────────────────────────────
  // Prefer ?subdomain= query param (set per-tenant in the ForwardAuth URL)
  // because Vercel overwrites X-Forwarded-Host with its own domain.
  const paramSubdomain = request.nextUrl.searchParams.get("subdomain");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? "";
  const hostOnly = forwardedHost.split(":")[0];
  const subdomain = paramSubdomain || hostOnly.split(".")[0];

  console.log("[verify-ingress] subdomain:", subdomain, "(param:", paramSubdomain, "host:", forwardedHost, ")");

  // ── LOCAL MODE BYPASS ──────────────────────────────────────────────────
  // In local mode, there's only one user and no billing. Just verify the
  // instance exists and allow all traffic.
  if (isLocalMode()) {
    console.log("[verify-ingress] Local mode: checking instance existence");
    
    const { data: instance } = await supabaseAdmin
      .from("instances")
      .select("id, status")
      .eq("subdomain", subdomain)
      .single();
    
    if (!instance) {
      console.log("[verify-ingress] Local mode: instance not found", subdomain);
      return new NextResponse(`Instance not found: ${subdomain}`, { status: 404 });
    }
    
    console.log("[verify-ingress] Local mode: access granted", subdomain);
    return new NextResponse("OK", { status: 200 });
  }
  // ────────────────────────────────────────────────────────────────────────

  if (!subdomain) {
    return new NextResponse("Missing subdomain", { status: 400 });
  }

  // ── 2. Determine auth method upfront ────────────────────────────────────
  // If a Bearer token is present skip session auth entirely — saves one
  // Supabase Auth network RTT on every M2M request (would always be null).
  const authHeader = request.headers.get("authorization");
  const hasBearerToken = authHeader?.startsWith("Bearer ");

  const response = NextResponse.next();

  let authenticatedUserId: string | null = null;
  let authMethod: "session" | "api_key" = "session";

  if (!hasBearerToken) {
    // ── 2a. Session auth (browser users) ──────────────────────────────────
    // Traefik forwards the browser's cookies so we can reconstruct a Supabase
    // server client that reads the user's auth session.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            response.cookies.set({ name, value, ...options, domain: `.${INFRA_DOMAIN}` });
          },
          remove(name: string, options: CookieOptions) {
            response.cookies.set({ name, value: "", ...options, domain: `.${INFRA_DOMAIN}` });
          },
        },
      }
    );

    const { data: { user: sessionUser } } = await supabase.auth.getUser();

    if (sessionUser) {
      console.log("[verify-ingress] Authenticated via session:", sessionUser.id);
      authenticatedUserId = sessionUser.id;
      authMethod = "session";
    }
  } else {
    // ── 2b. Bearer token auth (M2M agents) ────────────────────────────────
    const token = authHeader!.substring(7);

    // Key validation — cache-first (5 min TTL)
    let validatedKey = cacheGet(keyCache, token);
    if (!validatedKey) {
      const fromDb = await validateApiKey(token);
      if (fromDb) {
        cacheSet(keyCache, token, fromDb, TTL_KEY);
        validatedKey = fromDb;
      }
    }

    if (validatedKey) {
      // User profile + instance ownership — cache-aware, parallel on misses.
      // resolveUser / resolveInstance each return cached data or fetch from DB;
      // calling them inside Promise.all means any cache misses fire in parallel.
      const [userProfile, instanceData] = await Promise.all([
        resolveUser(validatedKey.userId),
        resolveInstance(subdomain),
      ]);

      if (!userProfile) {
        console.log("[verify-ingress] User profile missing for:", validatedKey.userId);
        return new NextResponse("Unauthorized", { status: 401 });
      }

      if (!(userProfile.balance > 0 || userProfile.isVip)) {
        console.log("[verify-ingress] Insufficient balance:", validatedKey.userId);
        return new NextResponse("Payment required", { status: 402 });
      }

      authenticatedUserId = validatedKey.userId;
      authMethod = "api_key";

      if (!instanceData) {
        console.log("[verify-ingress] Instance not found for subdomain:", subdomain);
        return new NextResponse(`Instance not found in DB for subdomain: ${subdomain}`, { status: 403 });
      }
      if (instanceData.status !== "active") {
        console.log("[verify-ingress] Instance not active:", subdomain, "status:", instanceData.status);
        return new NextResponse(`Instance not active (status: ${instanceData.status})`, { status: 403 });
      }
      if (instanceData.userId !== authenticatedUserId) {
        console.log("[verify-ingress] Owner mismatch:", instanceData.userId, "!=", authenticatedUserId);
        return new NextResponse("Forbidden", { status: 403 });
      }

      console.log(`[verify-ingress] Access granted via ${authMethod}:`, authenticatedUserId, "→", subdomain);
      return new NextResponse("OK", {
        status: 200,
        headers: { "x-forwarded-user": authenticatedUserId },
      });
    }
  }

  // No authenticated user — redirect to login
  if (!authenticatedUserId) {
    console.log("[verify-ingress] No authenticated user — redirecting to login");
    const loginUrl = new URL(
      "/login",
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.oclhosting.com"
    ).toString();
    return NextResponse.redirect(loginUrl, 302);
  }

  // ── 3. Session path: verify ownership ───────────────────────────────────
  const instanceData = await resolveInstance(subdomain);

  if (!instanceData) {
    console.log("[verify-ingress] Instance not found for subdomain:", subdomain);
    return new NextResponse(`Instance not found in DB for subdomain: ${subdomain}`, { status: 403 });
  }
  if (instanceData.status !== "active") {
    console.log("[verify-ingress] Instance not active:", subdomain, "status:", instanceData.status);
    return new NextResponse(`Instance not active (status: ${instanceData.status})`, { status: 403 });
  }
  if (instanceData.userId !== authenticatedUserId) {
    console.log("[verify-ingress] Owner mismatch:", instanceData.userId, "!=", authenticatedUserId);
    return new NextResponse("Forbidden", { status: 403 });
  }

  // ── 4. All checks pass — allow Traefik to forward the request ───────────
  console.log(`[verify-ingress] Access granted via ${authMethod}:`, authenticatedUserId, "→", subdomain);
  return new NextResponse("OK", {
    status: 200,
    headers: { "x-forwarded-user": authenticatedUserId },
  });
}
