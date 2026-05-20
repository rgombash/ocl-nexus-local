import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAction } from "@/lib/audit";
import { hasFlag } from "@/lib/flags";
import { INFRA_DOMAIN, MARKETING_DOMAIN } from "@/lib/config/nexus";
import { validateApiKey } from "@/lib/auth/api-auth";
import { isLocalMode } from "@/lib/auth/dev-user";

// Local mode requires Node.js runtime for postgres package (used by validateApiKey)
// Cloud mode uses Edge runtime for performance
export const runtime = process.env.NEXUS_MODE === "local" ? "nodejs" : "edge";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ── LOCAL MODE BYPASS ────────────────────────────────────────────────────
  // In local mode, skip Supabase authentication entirely.
  // All requests are treated as authenticated with the dev user.
  if (isLocalMode()) {
    // Skip auth processing for server-to-server API routes
    if (
      pathname.startsWith("/api/node/") ||
      pathname === "/api/verify-ingress" ||
      pathname.startsWith("/auth/")
    ) {
      return NextResponse.next();
    }

    // For /api/v1/* routes in local mode:
    // In local mode, we can't use postgres package in Edge runtime middleware
    // So we bypass database validation and accept any well-formed Bearer token
    // Tests can use any nx_ token and it will map to the dev user
    if (pathname.startsWith("/api/v1/")) {
      const authHeader = request.headers.get("authorization");

      // Require Authorization header
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json(
          { error: "Missing or invalid Authorization header" },
          { status: 401 }
        );
      }

      const token = authHeader.substring(7);

      // In local mode: accept any token that starts with nx_ (format check only)
      // This allows tests to work without database queries in Edge runtime
      if (!token.startsWith("nx_") || token.length !== 35) {
        return NextResponse.json(
          { error: "Invalid API key format" },
          { status: 401 }
        );
      }

      // Map to dev user (local mode always uses the same user)
      const devUserId = process.env.LOCAL_DEV_USER_ID || "00000000-0000-0000-0000-000000000000";
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-user-id", devUserId);
      requestHeaders.set("x-api-key-id", "00000000-0000-0000-0000-000000000001"); // Dummy UUID for local mode

      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }

    // Non-API routes: redirect root to dashboard (no login needed)
    if (pathname === "/" || pathname === "/login") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      return NextResponse.redirect(redirectUrl);
    }

    // All other routes pass through (authenticated as dev user)
    return NextResponse.next();
  }

  // ── CLOUD MODE (Original Supabase auth logic) ───────────────────────────

  // Skip maintenance check for the /maintenance page itself (prevent redirect loop)
  // and public marketing pages (/, /privacy, /terms, /login)
  const isMaintenancePage = pathname === "/maintenance";
  const isPublicMarketingPage =
    pathname === "/" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/login";

  // Skip auth processing for server-to-server API routes that use their own
  // Bearer token authorization (e.g. /api/node/bootstrap, /api/node/ready).
  // Also skip redirect logic for /api/verify-ingress — it reads cookies
  // forwarded by Traefik and handles auth internally.
  // Skip /auth/callback entirely — the route handler owns that flow (PKCE exchange).
  if (
    pathname.startsWith("/api/node/") ||
    pathname === "/api/verify-ingress" ||
    pathname.startsWith("/auth/")
  ) {
    return NextResponse.next();
  }

  // ── API Key Authentication (M2M) ─────────────────────────────────────────
  // All /api/v1/* routes require API key authentication via Bearer token.
  // If valid, inject x-user-id header for downstream route handlers.
  if (pathname.startsWith("/api/v1/")) {
    try {
      const authHeader = request.headers.get("authorization");

      // Extract Bearer token
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json(
          { error: "Missing or invalid Authorization header" },
          { status: 401 }
        );
      }

      const token = authHeader.substring(7); // Remove "Bearer " prefix

      // Validate the API key
      const validated = await validateApiKey(token);

      if (!validated) {
        return NextResponse.json(
          { error: "Invalid API key" },
          { status: 401 }
        );
      }

      // Log API key usage (non-blocking)
      void logAction(validated.userId, "API_KEY_USE", "success", {
        keyId: validated.keyId,
        pathname,
      }).catch((err) => {
        console.error("[middleware] Failed to log API_KEY_USE:", err);
      });

      // Inject user_id into request headers for downstream routes
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-user-id", validated.userId);
      requestHeaders.set("x-api-key-id", validated.keyId);

      // Forward request with injected headers
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    } catch (error) {
      console.error("[middleware] API key validation error:", error);
      return NextResponse.json(
        { error: "Internal server error during authentication" },
        { status: 500 }
      );
    }
  }

  // Use @supabase/ssr's getAll/setAll API (required since v0.5+).
  // The setAll callback must:
  //   1. Mutate request.cookies so downstream Server Components see the refreshed token.
  //   2. Re-build supabaseResponse with the mutated request so the response carries
  //      the updated Set-Cookie headers back to the browser.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Apply to request so downstream reads see the refreshed cookies.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Re-build the response so the Set-Cookie headers reach the browser.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              domain: `.${INFRA_DOMAIN}`,
            })
          );
        },
      },
    }
  );

  // Refresh the auth token (important for Server Components).
  // IMPORTANT: use getUser() not getSession() — getUser() validates the JWT
  // server-side and cannot be spoofed by a tampered cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // --- Maintenance Mode Check ---
  // Redirect non-admin users to /maintenance if NEXT_PUBLIC_MAINTENANCE_MODE is "true"
  const maintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";
  const isProtectedRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/api/instances") ||
    pathname.startsWith("/api/v1");

  if (
    maintenanceMode &&
    !isMaintenancePage &&
    !isPublicMarketingPage &&
    isProtectedRoute
  ) {
    // Check if user is an admin
    let isAdmin = false;
    if (user) {
      const { data: profile } = await supabaseAdmin
        .from("users")
        .select("is_admin, flags")
        .eq("id", user.id)
        .single();

      // Check both the is_admin column and the flags.is_admin JSONB field
      isAdmin =
        profile?.is_admin === true ||
        hasFlag<boolean>(
          profile?.flags as Record<string, unknown> | null | undefined,
          "is_admin",
          false
        ) === true;

      // Log admin bypass for audit trail
      if (isAdmin) {
        await logAction(user.id, "SYSTEM_MAINTENANCE_BYPASS", "success", {
          pathname,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Redirect non-admin users to /maintenance page
    if (!isAdmin) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/maintenance";
      return NextResponse.redirect(redirectUrl);
    }
  }

  const host = request.headers.get("host") ?? "";
  const isAppDomain = host.startsWith("app.");
  const isRootDomain = host === INFRA_DOMAIN || host === `www.${INFRA_DOMAIN}`;

  // --- Subdomain routing ---
  // On app domain: root "/" redirects to /login (or /dashboard if logged in)
  if (isAppDomain && pathname === "/") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = user ? "/dashboard" : "/login";
    return NextResponse.redirect(redirectUrl);
  }

  // oclhosting.com root and /docs/* → redirect to marketing domain.
  // Everything else on oclhosting.com passes through untouched.
  if (isRootDomain && (pathname === "/" || pathname.startsWith("/docs"))) {
    const target = new URL(`https://${MARKETING_DOMAIN}${pathname}`);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target);
  }

  // --- Auth protection (applies on all domains) ---
  // Protect /dashboard and /admin routes — redirect to /login if not authenticated
  if (!user && (pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  // Redirect logged-in users away from /login to /dashboard
  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  // Return supabaseResponse (not a plain NextResponse.next()) so that any
  // refreshed session cookies set in setAll() are forwarded to the browser.
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
