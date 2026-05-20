import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getDevUser } from "@/lib/auth/dev-user";

// ---------------------------------------------------------------------------
// Server client (Server Components, Route Handlers, Server Actions)
// Reads/writes Supabase auth cookies via Next.js headers.
// Must be called inside a request context (not at module top-level).
//
// Uses the getAll/setAll API (required since @supabase/ssr v0.5+).
// getAll reads the entire cookie jar — the auth-js storage layer can find
// any chunked session cookie without needing per-key hints.
//
// NEXUS LOCAL MODE: Returns mock client that uses postgres directly.
// ---------------------------------------------------------------------------

export function createSupabaseServerClient() {
  const NEXUS_MODE = process.env.NEXUS_MODE;
  
  if (NEXUS_MODE === "local") {
    // Local mode: return mock client with dev user and postgres backend
    // Use dynamic import to avoid bundling postgres in Edge runtime routes
    const devUser = getDevUser();
    
    return {
      auth: {
        getSession: () => Promise.resolve({ 
          data: { session: { user: devUser } }, 
          error: null 
        }),
        getUser: () => Promise.resolve({ 
          data: { user: devUser }, 
          error: null 
        }),
      },
      from: (table: string) => {
        // Dynamic import to avoid Edge runtime issues
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { localDb } = require("@/lib/db/local-client");
        return localDb.from(table);
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        domain: ".oclhosting.com",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, domain: ".oclhosting.com" })
            );
          } catch {
            // Called from a Server Component (read-only context) — safe to ignore.
            // The middleware handles session refresh and will propagate cookies.
          }
        },
      },
    }
  );
}
