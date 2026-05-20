import HealthClient from "./health-client";

export const dynamic = "force-dynamic";

export default function ClusterHealthPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Cluster Health</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Reconcile K3s deployments against database records. Detect zombie resources and ghost instances.
        </p>
      </div>
      <HealthClient />
    </div>
  );
}
