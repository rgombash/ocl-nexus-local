import { createSupabaseServerClient } from "@/lib/supabase-server";
import { hasFlag } from "@/lib/flags";
import { redirect } from "next/navigation";
import Link from "next/link";
import InstanceCardClient from "./instance-card-client";
import WorkloadGallery from "./workload-gallery";
import InstancesPoller from "./instances-poller";
import { getStableBlueprints } from "@/lib/nexus/blueprints";
import { isAuthorized } from "@/lib/auth/authorization";
import { INFRA_DOMAIN } from "@/lib/config/nexus";
import { isLocalMode } from "@/lib/auth/dev-user";
import K3sStatusPill from "./k3s-status-pill";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("email, display_name, flags, max_instances")
    .eq("id", user.id)
    .single();

  const isVip = hasFlag<boolean>(
    profile?.flags as Record<string, unknown> | null | undefined,
    "is_vip",
    false
  ) === true;
  const isAuth = isAuthorized(profile);
  const showBetaFeatures = hasFlag<boolean>(
    profile?.flags as Record<string, unknown> | null | undefined,
    "show_beta_features",
    false
  ) === true;

  const { data: instances } = await supabase
    .from("instances")
    .select("id, subdomain, status, gateway_token, blueprint_id, config_set_id, user_description, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const instanceLimit = profile?.max_instances ?? 5;
  const atLimit = !isVip && instanceLimit !== null && (instances?.length ?? 0) >= instanceLimit;

  const { data: tenantConfig } = await supabase
    .from("tenant_configs")
    .select("api_key, provider_keys")
    .eq("user_id", user.id)
    .single();

  const hasLlmKeys = !!(
    tenantConfig &&
    (
      (tenantConfig.provider_keys &&
        typeof tenantConfig.provider_keys === "object" &&
        Object.keys(tenantConfig.provider_keys as Record<string, unknown>).length > 0) ||
      tenantConfig.api_key
    )
  );

  const { data: configSets } = isAuth
    ? await supabase
        .from("config_sets")
        .select("id, name, description")
        .eq("user_id", user.id)
        .order("name", { ascending: true })
    : { data: null };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
        </div>
        <div className="flex items-center gap-2">
          <K3sStatusPill />
        </div>
      </div>

      <InstancesPoller />

      {isAuth && (
        <div className="mb-8">
          <WorkloadGallery
            blueprints={getStableBlueprints().filter(
              (bp) => showBetaFeatures || !["openclaw", "nanoclaw"].includes(bp.id)
            )}
            hasLlmKeys={hasLlmKeys}
            atLimit={atLimit}
            configSets={configSets ?? []}
          />
        </div>
      )}

      {instances && instances.length > 0 ? (
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Your Workloads ({instances.length})
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Manage your deployed instances
              </p>
            </div>
            {!isVip && (() => {
              const limit = profile?.max_instances ?? 5;
              const count = instances.length;
              const pct = count / limit;
              const colour = pct >= 1
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                : pct >= 0.8
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
              return (
                <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${colour}`}>
                  {count} / {limit} workloads
                </span>
              );
            })()}
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {instances.map((instance) => (
              <InstanceCardClient
                key={instance.id}
                instanceId={instance.id}
                subdomain={instance.subdomain}
                publicUrl={`${isLocalMode() ? "http" : "https"}://${instance.subdomain}.${INFRA_DOMAIN}`}
                initialDbStatus={instance.status}
                blueprintId={instance.blueprint_id ?? "openclaw"}
                currentConfigSetId={instance.config_set_id}
                userDescription={instance.user_description}
                createdAt={instance.created_at}
                configSets={configSets ?? []}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
            <svg className="h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            No workloads deployed yet
          </h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Get started by deploying your first workload from the gallery above
          </p>
          <Link
            href="/docs"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            Read the Quick Start Guide
          </Link>
        </div>
      )}
    </main>
  );
}
