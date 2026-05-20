import { createClient } from "@supabase/supabase-js";
import { localDb } from "@/lib/db/local-client";

// ---------------------------------------------------------------------------
// Admin (server-only) Supabase client
// Uses the service-role key – BYPASSES RLS. Only import this in API routes,
// server actions, or other code that never ships to the browser.
//
// This is in a separate file from the browser client to prevent the
// SUPABASE_SERVICE_ROLE_KEY from being bundled into client-side code.
//
// NEXUS LOCAL MODE: When NEXUS_MODE=local, use local PostgreSQL instead.
// ---------------------------------------------------------------------------

const NEXUS_MODE = process.env.NEXUS_MODE;

// Create the appropriate client based on mode
const client =
  NEXUS_MODE === "local"
    ? ({
        from: (table: string) => localDb.from(table),
        auth: {},
        storage: {},
      } as unknown as ReturnType<typeof createClient>)
    : createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      );

export const supabaseAdmin = client;
