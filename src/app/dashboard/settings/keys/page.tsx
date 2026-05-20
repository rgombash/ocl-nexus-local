import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { hasFlag } from "@/lib/flags";
import KeysClient from "./keys-client";

export default async function ApiKeysPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // ── Authorization check ─────────────────────────────────────────────────
  // Only users with balance or VIP can access settings
  const { data: profile } = await supabase
    .from("users")
    .select("balance, flags")
    .eq("id", user.id)
    .single();

  const isVip = hasFlag<boolean>(
    profile?.flags as Record<string, unknown> | null | undefined,
    "is_vip",
    false
  ) === true;

  const balance = parseFloat(String(profile?.balance ?? 0));
  const hasBalance = balance > 0;

  if (!hasBalance && !isVip) {
    redirect("/dashboard");
  }

  // ── Fetch API keys ──────────────────────────────────────────────────────
  const { data: apiKeys } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">API Keys</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Manage API keys for machine-to-machine authentication. Use these keys
            to access the Nexus API from AI agents, CLI tools, and scripts.
          </p>
        </div>

        {/* Client component with keys table and actions */}
        <KeysClient initialKeys={apiKeys ?? []} />

        {/* Connect to IDE */}
        <div className="mt-12 rounded-xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-900/20">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-blue-900 dark:text-blue-200">
                Connect Your IDE
              </h3>
              <p className="mt-1 text-sm text-blue-800 dark:text-blue-300">
                Copy your API key above, then follow the setup guide to connect Claude Desktop,
                Cursor, or Continue.dev to OCL Nexus via the MCP protocol. Your agent can then
                deploy sandboxes, upload code, and run services autonomously.
              </p>
            </div>
            <Link
              href="/docs"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
              View Setup Guide
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Claude Desktop", "Cursor", "Continue.dev"].map((ide) => (
              <span
                key={ide}
                className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              >
                <svg className="h-3 w-3 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                {ide}
              </span>
            ))}
          </div>
        </div>
      </main>
  );
}
