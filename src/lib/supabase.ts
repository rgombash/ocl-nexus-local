import { createBrowserClient } from "@supabase/ssr";

// ---------------------------------------------------------------------------
// Browser client (Client Components)
// Uses the anon key – all queries are subject to Row Level Security (RLS).
// Automatically manages auth cookies in the browser.
//
// cookieOptions.domain is set so the PKCE code-verifier cookie is scoped to
// .oclhosting.com — matching the domain used by every server-side client.
// Without this, createBrowserClient stores the verifier as a host-only cookie
// (no Domain attribute) via document.cookie. On a fresh browser session, some
// browsers (Safari ITP, hardened Chrome) restrict host-only cookies set during
// cross-site redirects, causing the verifier to be absent when the server
// reads request.cookies in /auth/callback and PKCE exchange fails.
//
// NEXUS LOCAL MODE: Returns mock client - auth is bypassed in middleware.
// ---------------------------------------------------------------------------

export function createSupabaseBrowserClient() {
  const NEXUS_MODE = process.env.NEXT_PUBLIC_NEXUS_MODE || process.env.NEXUS_MODE;
  
  if (NEXUS_MODE === "local") {
    // Local mode: return mock client (auth handled by middleware)
    return {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        signOut: () => Promise.resolve({ error: null }),
      },
      from: () => ({
        select: () => Promise.resolve({ data: [], error: null }),
      }),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        domain: ".oclhosting.com",
      },
    }
  );
}
