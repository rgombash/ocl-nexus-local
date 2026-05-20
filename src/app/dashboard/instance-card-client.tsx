"use client";

import { useEffect, useRef, useState } from "react";
import DeleteInstanceButton from "./delete-instance-button";
import { getBlueprint } from "@/lib/nexus/blueprints";
import CockpitModal from "./cockpit-modal";

type PodStatus = "pulling" | "starting" | "running" | "error" | "suspended";

const badgeConfig: Record<PodStatus, { bg: string; text: string; label: string }> = {
  pulling:   { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-300", label: "Pulling Image" },
  starting:  { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-300", label: "Starting" },
  running:   { bg: "bg-green-100 dark:bg-green-900/30",  text: "text-green-800 dark:text-green-300",  label: "Running" },
  error:     { bg: "bg-red-100 dark:bg-red-900/30",      text: "text-red-800 dark:text-red-300",      label: "Error" },
  suspended: { bg: "bg-gray-100 dark:bg-gray-700",        text: "text-gray-800 dark:text-gray-300",    label: "Suspended" },
};

interface Props {
  instanceId: string;
  subdomain: string;
  publicUrl: string;
  initialDbStatus: string;
  blueprintId?: string;
  currentConfigSetId?: string | null;
  userDescription?: string | null;
  createdAt?: string | null;
  configSets?: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
}

function formatAge(createdAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days < 30) return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  return remainingDays > 0 ? `${months}mo ${remainingDays}d` : `${months}mo`;
}

export default function InstanceCardClient({
  instanceId,
  subdomain,
  publicUrl,
  initialDbStatus,
  blueprintId = "openclaw",
  currentConfigSetId,
  userDescription: initialUserDescription,
  createdAt,
  configSets,
}: Props) {
  const [podStatus, setPodStatus] = useState<PodStatus | null>(
    initialDbStatus === "suspended" ? "suspended" : null
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [restartLoading, setRestartLoading] = useState(false);
  const [configChangeLoading, setConfigChangeLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showCockpitModal, setShowCockpitModal] = useState(false);
  const [selectedConfigSet, setSelectedConfigSet] = useState<string>(currentConfigSetId ?? "");
  const [userDescription, setUserDescription] = useState<string>(initialUserDescription ?? "");
  const mounted = useRef(true);

  // Get blueprint metadata for display
  const blueprint = getBlueprint(blueprintId);
  const displayName = blueprint?.displayName ?? "Unknown Workload";
  const icon = blueprint?.icon ?? "📦";

  // K8s cluster-internal URL for pod-to-pod communication (Service always exposes :80)
  const shortId = subdomain.replace("inst-", "");
  const internalUrl = `http://svc-${shortId}:80`;

  const [internalUrlCopied, setInternalUrlCopied] = useState(false);
  const [publicUrlCopied, setPublicUrlCopied] = useState(false);

  async function handleCopyInternalUrl() {
    await navigator.clipboard.writeText(internalUrl);
    setInternalUrlCopied(true);
    setTimeout(() => setInternalUrlCopied(false), 2000);
  }

  async function handleCopyPublicUrl() {
    await navigator.clipboard.writeText(publicUrl);
    setPublicUrlCopied(true);
    setTimeout(() => setPublicUrlCopied(false), 2000);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (initialDbStatus === "suspended") return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/instances/${instanceId}/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setPodStatus(data.status);
          setStatusMessage(data.message ?? "");
        }
      } catch {
        // Network error — keep retrying
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [instanceId, initialDbStatus]);

  const isRunning = podStatus === "running";
  const isSuspended = initialDbStatus === "suspended";

  async function handleRestart() {
    if (
      !confirm(
        "Restart your instance? This will briefly take it offline while Kubernetes starts a fresh pod. Your data is preserved."
      )
    )
      return;
    setActionError(null);
    setRestartLoading(true);
    try {
      const res = await fetch(`/api/instances/${instanceId}/restart`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        if (mounted.current) setActionError(data.error ?? "Restart failed.");
      }
    } catch {
      if (mounted.current) setActionError("Network error — could not restart instance.");
    } finally {
      if (mounted.current) setRestartLoading(false);
    }
  }

  async function handleConfigChange() {
    setConfigChangeLoading(true);
    setActionError(null);
    try {
      // Update description first
      const descRes = await fetch(`/api/instances/${instanceId}/description`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userDescription: userDescription || null }),
      });
      if (!descRes.ok) {
        const data = await descRes.json();
        if (mounted.current) setActionError(data.error ?? "Failed to update description.");
        setConfigChangeLoading(false);
        return;
      }

      // Update config set (this triggers restart)
      const res = await fetch(`/api/instances/${instanceId}/config-set`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configSetId: selectedConfigSet || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (mounted.current) setActionError(data.error ?? "Failed to change config set.");
      } else {
        setShowConfigModal(false);
        // Refresh page to show updated config and description
        window.location.reload();
      }
    } catch {
      if (mounted.current) setActionError("Network error — could not save changes.");
    } finally {
      if (mounted.current) setConfigChangeLoading(false);
    }
  }

  // ── Status badge ──────────────────────────────────────────────────────────
  let statusBadge: React.ReactNode;
  if (podStatus) {
    const cfg = badgeConfig[podStatus];
    statusBadge = (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}
      >
        {podStatus === "pulling" || podStatus === "starting" ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
        ) : podStatus === "running" ? (
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        ) : podStatus === "suspended" ? (
          <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        )}
        {cfg.label}
        {podStatus !== "running" && podStatus !== "error" && podStatus !== "suspended" && (
          <svg className="ml-0.5 h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </span>
    );
  } else if (initialDbStatus === "active") {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        active
      </span>
    );
  } else {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
        checking…
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Row 1: icon indents only the instance type + subdomain */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-2xl dark:bg-blue-900/30">
            {icon}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{displayName}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {subdomain}.localhost
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {statusBadge}
          {blueprint.codePersistence && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
              </svg>
              Code: {blueprint.codePvcSize}
            </span>
          )}
        </div>
      </div>

      {/* User description — prominent */}
      {userDescription && (
        <p className="mt-3 text-base font-semibold text-gray-800 dark:text-gray-100">
          {userDescription}
        </p>
      )}

      {/* URL row */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Internal URL — chip + copy stay together */}
        <div className="inline-flex shrink-0 items-center gap-1">
        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-300"
          title="Internal Kubernetes service URL for pod-to-pod communication"
        >
          <span className="font-sans font-medium text-slate-500 dark:text-slate-400">Internal</span>
          {internalUrl}
        </span>
        <button
          onClick={handleCopyInternalUrl}
          className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-300 dark:hover:bg-slate-500"
          title="Copy internal URL"
        >
          {internalUrlCopied ? (
            <>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
              </svg>
              Copy
            </>
          )}
        </button>
        </div>
        {/* External URL — chip + copy stay together */}
        <div className="inline-flex shrink-0 items-center gap-1">
        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-50 px-2 py-1 font-mono text-xs text-teal-700 dark:bg-teal-900/20 dark:text-teal-300"
          title="Public workload URL"
        >
          <span className="font-sans font-medium text-teal-500 dark:text-teal-400">External</span>
          {publicUrl}
        </span>
        <button
          onClick={handleCopyPublicUrl}
          className="inline-flex items-center gap-1 rounded-md bg-teal-100 px-2 py-1 text-xs font-medium text-teal-700 transition hover:bg-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:hover:bg-teal-900/50"
          title="Copy public URL"
        >
          {publicUrlCopied ? (
            <>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
              </svg>
              Copy
            </>
          )}
        </button>
        </div>
      </div>

      {statusMessage && podStatus !== "running" && (
        <p className="mt-3 text-xs text-gray-500">{statusMessage}</p>
      )}
      {isSuspended && (
        <p className="mt-3 text-xs text-amber-600">Re-subscribe to reactivate your instance</p>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isRunning && !isSuspended && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Open
          </a>
        )}
        {!isSuspended && (
          <>
            <button
              onClick={handleRestart}
              disabled={!isRunning || restartLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40"
            >
              {restartLoading ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              )}
              {restartLoading ? "Restarting…" : "Restart"}
            </button>

            <button
              onClick={() => setShowConfigModal(true)}
              disabled={!isRunning || restartLoading || configChangeLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 shadow-sm transition hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-700/50 dark:bg-purple-900/20 dark:text-purple-300 dark:hover:bg-purple-900/40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              Config
            </button>

            <button
              onClick={() => setShowCockpitModal(true)}
              disabled={!isRunning || restartLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 shadow-sm transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-green-700/50 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Cockpit
            </button>

            <DeleteInstanceButton instanceId={instanceId} />
          </>
        )}
      </div>

      {actionError && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          {actionError}
        </p>
      )}

      {createdAt && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Age: {formatAge(createdAt)}
        </div>
      )}

      {/* Config Set Change Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Configure Instance
            </h3>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Description (optional)
              </label>
              <textarea
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                placeholder="e.g., Production workspace, Testing environment..."
                rows={2}
                disabled={configChangeLoading}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Environment Configuration
              </label>
              <select
                value={selectedConfigSet}
                onChange={(e) => setSelectedConfigSet(e.target.value)}
                disabled={configChangeLoading}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">None (remove environment variables)</option>
                {configSets?.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                    {set.description ? ` — ${set.description}` : ""}
                  </option>
                ))}
              </select>
              {currentConfigSetId && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Current: {configSets?.find(s => s.id === currentConfigSetId)?.name ?? "Unknown"}
                </p>
              )}
            </div>

            <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
              <p className="font-medium text-amber-900 dark:text-amber-300">⚠️ Instance will restart if config set changes
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Changing the config set will automatically restart your instance (~10 seconds). Description changes take effect immediately.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConfigChange}
                disabled={configChangeLoading || (selectedConfigSet === (currentConfigSetId ?? "") && userDescription === (initialUserDescription ?? ""))}
                className="flex-1 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50"
              >
                {configChangeLoading ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={() => {
                  setShowConfigModal(false);
                  setSelectedConfigSet(currentConfigSetId ?? "");
                  setUserDescription(initialUserDescription ?? "");
                }}
                disabled={configChangeLoading}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cockpit Modal */}
      <CockpitModal
        instanceId={instanceId}
        subdomain={subdomain}
        blueprintId={blueprintId}
        isOpen={showCockpitModal}
        onClose={() => setShowCockpitModal(false)}
      />
    </div>
  );
}
