"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Blueprint } from "@/lib/nexus/blueprints";

interface WorkloadCardProps {
  blueprint: Blueprint;
  hasLlmKeys: boolean;
  atLimit: boolean;
  onDeploy: (blueprintId: string, configSetId?: string, userDescription?: string) => Promise<void>;
  configSets?: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
}

function WorkloadCard({
  blueprint,
  hasLlmKeys,
  atLimit,
  onDeploy,
  configSets,
}: WorkloadCardProps) {
  const [isDeploying, setIsDeploying] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [selectedConfigSet, setSelectedConfigSet] = useState<string>("");
  const [userDescription, setUserDescription] = useState<string>("");

  const canDeploy = (!blueprint.requiresLlmKeys || hasLlmKeys) && !atLimit;
  const deployDisabledReason = atLimit
    ? "Instance limit reached — terminate a workload to free a slot"
    : blueprint.requiresLlmKeys && !hasLlmKeys
    ? "Please configure LLM keys first"
    : null;

  const handleDeployClick = () => {
    if (!canDeploy) return;
    setShowDeployModal(true);
  };

  const handleConfirmDeploy = async () => {
    setIsDeploying(true);
    try {
      await onDeploy(
        blueprint.id,
        selectedConfigSet || undefined,
        userDescription || undefined
      );
      setShowDeployModal(false);
      setSelectedConfigSet("");
      setUserDescription("");
    } catch (error) {
      console.error("Deployment failed:", error);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <>
      <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-2xl dark:bg-blue-900/30">
              {blueprint.icon}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {blueprint.displayName}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {blueprint.category}
              </p>
            </div>
          </div>
          {!blueprint.isStable && (
            <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
              Experimental
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mb-4 flex-grow text-sm text-gray-600 dark:text-gray-300">
          {blueprint.description}
        </p>

        {/* Deploy Button */}
        <button
          onClick={handleDeployClick}
          disabled={!canDeploy || isDeploying}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          title={deployDisabledReason || undefined}
        >
          {isDeploying ? "Deploying..." : "Deploy"}
        </button>

        {/* Disabled Reason */}
        {deployDisabledReason && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            {deployDisabledReason}
          </p>
        )}
      </div>

      {/* Deploy Modal */}
      {showDeployModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Deploy {blueprint.displayName}
            </h3>

            {/* Description */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Description (optional)
              </label>
              <textarea
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                placeholder="e.g., Production workspace, Testing environment..."
                rows={2}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>

            {/* Config Set Selector */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Environment Configuration
              </label>
              <select
                value={selectedConfigSet}
                onChange={(e) => setSelectedConfigSet(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">None (no environment variables)</option>
                {configSets?.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                    {set.description ? ` — ${set.description}` : ""}
                  </option>
                ))}
              </select>
              {configSets && configSets.length === 0 && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  No config sets available. Visit{" "}
                  <a href="/dashboard/configs" className="text-blue-600 hover:underline dark:text-blue-400">
                    Config Vault
                  </a>{" "}
                  to create one.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleConfirmDeploy}
                disabled={isDeploying}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {isDeploying ? "Deploying..." : "Deploy"}
              </button>
              <button
                onClick={() => {
                  setShowDeployModal(false);
                  setSelectedConfigSet("");
                }}
                disabled={isDeploying}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface WorkloadGalleryProps {
  blueprints: Blueprint[];
  hasLlmKeys: boolean;
  atLimit: boolean;
  configSets?: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
}

export default function WorkloadGallery({
  blueprints,
  hasLlmKeys,
  atLimit,
  configSets,
}: WorkloadGalleryProps) {
  const router = useRouter();

  const handleDeploy = async (
    blueprintId: string,
    configSetId?: string,
    userDescription?: string
  ) => {
    const body: {
      blueprintId: string;
      configSetId?: string;
      userDescription?: string;
    } = { blueprintId };
    if (configSetId) {
      body.configSetId = configSetId;
    }
    if (userDescription) {
      body.userDescription = userDescription;
    }

    const res = await fetch("/api/instances/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorData = await res.json();
      alert(`Deployment failed: ${errorData.error}`);
      return;
    }

    // Refresh the page to show the new instance
    router.refresh();
  };

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Choose a Workload
        </h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-right max-w-xs">
          Running on local K3s node.{" "}
          For 24/7 availability on dedicated EU-based NVMe infrastructure,{" "}
          visit{" "}
          <a href="https://oclnexus.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">
            oclnexus.com
          </a>.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {blueprints.map((blueprint) => (
          <WorkloadCard
            key={blueprint.id}
            blueprint={blueprint}
            hasLlmKeys={hasLlmKeys}
            atLimit={atLimit}
            onDeploy={handleDeploy}
            configSets={configSets}
          />
        ))}
      </div>
    </div>
  );
}
