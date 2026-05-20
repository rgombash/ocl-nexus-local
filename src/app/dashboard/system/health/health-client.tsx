"use client";

import { useEffect, useState } from "react";
import type { ReconciliationResult, Mismatch } from "./actions";
import {
  reconcileLocal,
  deleteZombieResources,
  markGhostError,
  pruneAllZombies,
} from "./actions";

export default function HealthClient() {
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pruneConfirm, setPruneConfirm] = useState(false);
  const [pruneResult, setPruneResult] = useState<{ deleted: number; errors: string[] } | null>(null);

  async function runReconcile() {
    setLoading(true);
    setPruneConfirm(false);
    setPruneResult(null);
    try {
      setResult(await reconcileLocal());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runReconcile(); }, []);

  async function handleDeleteZombie(shortId: string) {
    setActionLoading(shortId);
    try {
      const res = await deleteZombieResources(shortId);
      if (res.ok) {
        setResult((prev) =>
          prev
            ? {
                ...prev,
                mismatches: prev.mismatches.filter((m) => m.shortId !== shortId),
                k8sDeployments: prev.k8sDeployments.filter((id) => id !== shortId),
              }
            : prev
        );
      } else {
        alert(`Failed: ${res.error}`);
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkGhost(instanceId: string, shortId: string) {
    setActionLoading(shortId);
    try {
      const res = await markGhostError(instanceId);
      if (res.ok) {
        setResult((prev) =>
          prev
            ? {
                ...prev,
                mismatches: prev.mismatches.map((m) =>
                  m.shortId === shortId ? { ...m, dbStatus: "error" } : m
                ),
              }
            : prev
        );
      } else {
        alert(`Failed: ${res.error}`);
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handlePruneAll() {
    setActionLoading("prune-all");
    setPruneResult(null);
    try {
      const res = await pruneAllZombies();
      setPruneResult({ deleted: res.deleted, errors: res.errors });
      setPruneConfirm(false);
      setResult(await reconcileLocal());
    } finally {
      setActionLoading(null);
    }
  }

  const zombies = result?.mismatches.filter((m) => m.type === "zombie") ?? [];
  const ghosts = result?.mismatches.filter((m) => m.type === "ghost") ?? [];

  return (
    <div className="space-y-8">
      {/* Refresh button */}
      <div className="flex justify-end">
        <button
          onClick={runReconcile}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {loading ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <svg className="h-6 w-6 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">
            Reconciling K3s cluster against database…
          </span>
        </div>
      )}

      {/* Error */}
      {result?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">{result.error}</p>
        </div>
      )}

      {result && !result.error && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="K3s Deployments" value={result.k8sDeployments.length} />
            <SummaryCard label="DB Instances" value={result.dbInstances.length} />
            <SummaryCard label="Zombies" value={zombies.length} variant={zombies.length > 0 ? "warning" : "ok"} />
            <SummaryCard label="Ghosts" value={ghosts.length} variant={ghosts.length > 0 ? "warning" : "ok"} />
          </div>

          {/* Cluster metrics */}
          {result.nodeMetrics && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">Cluster Metrics</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Workload Pods</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{result.nodeMetrics.podCount}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">CPU</p>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {result.nodeMetrics.allocatable.cpu ?? "?"} allocatable / {result.nodeMetrics.capacity.cpu ?? "?"} total
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Memory</p>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {result.nodeMetrics.allocatable.memory ?? "?"} allocatable / {result.nodeMetrics.capacity.memory ?? "?"} total
                  </p>
                </div>
              </div>
              {result.nodeMetrics.nodeConditions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {result.nodeMetrics.nodeConditions.map((c) => (
                    <span
                      key={c.type}
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        c.type === "Ready" && c.status === "True"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : c.type === "Ready"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : c.status === "False"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}
                    >
                      {c.type}: {c.status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Prune all zombies */}
          {zombies.length > 0 && (
            <div className="flex items-center gap-3">
              {!pruneConfirm ? (
                <button
                  onClick={() => setPruneConfirm(true)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                >
                  Prune All Zombies ({zombies.length})
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-900/20">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Delete {zombies.length} zombie deployment{zombies.length !== 1 ? "s" : ""} and all their K8s resources?
                  </p>
                  <button
                    onClick={handlePruneAll}
                    disabled={actionLoading === "prune-all"}
                    className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
                  >
                    {actionLoading === "prune-all" ? "Pruning…" : "Yes, Prune All"}
                  </button>
                  <button
                    onClick={() => setPruneConfirm(false)}
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Prune result feedback */}
          {pruneResult && (
            <div className={`rounded-lg border p-4 ${pruneResult.errors.length > 0 ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20" : "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20"}`}>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Deleted {pruneResult.deleted} zombie deployment{pruneResult.deleted !== 1 ? "s" : ""}.
              </p>
              {pruneResult.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-red-600 dark:text-red-400">
                  {pruneResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* Mismatches table */}
          {result.mismatches.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    {["Instance ID", "Type", "Details", "Action"].map((h, i) => (
                      <th key={h} className={`px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 ${i === 3 ? "text-right" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                  {result.mismatches.map((m) => (
                    <MismatchRow
                      key={m.shortId}
                      mismatch={m}
                      actionLoading={actionLoading}
                      onDeleteZombie={handleDeleteZombie}
                      onMarkGhost={handleMarkGhost}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center dark:border-green-800 dark:bg-green-900/20">
              <svg className="mx-auto h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="mt-2 text-sm font-medium text-green-700 dark:text-green-400">
                All clear — K3s and DB are in sync.
              </p>
            </div>
          )}

          {/* Detail lists */}
          <div className="grid gap-6 lg:grid-cols-2">
            <DetailList
              title={`K3s Deployments (${result.k8sDeployments.length})`}
              items={result.k8sDeployments.map((id) => `app-${id}`)}
            />
            <DetailList
              title={`DB Instances (${result.dbInstances.length})`}
              items={result.dbInstances.map((i) => ({ label: i.subdomain, badge: i.status }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, variant = "neutral" }: {
  label: string; value: number; variant?: "neutral" | "ok" | "warning";
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${variant === "ok" ? "text-green-600 dark:text-green-400" : variant === "warning" ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function DetailList({ title, items }: {
  title: string;
  items: (string | { label: string; badge: string })[];
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">None</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {items.map((item, i) =>
            typeof item === "string" ? (
              <li key={i} className="font-mono text-xs text-gray-600 dark:text-gray-400">{item}</li>
            ) : (
              <li key={i} className="flex items-center justify-between font-mono text-xs text-gray-600 dark:text-gray-400">
                <span>{item.label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  item.badge === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : item.badge === "error" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                }`}>{item.badge}</span>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

function MismatchRow({ mismatch, actionLoading, onDeleteZombie, onMarkGhost }: {
  mismatch: Mismatch;
  actionLoading: string | null;
  onDeleteZombie: (shortId: string) => void;
  onMarkGhost: (instanceId: string, shortId: string) => void;
}) {
  const isLoading = actionLoading === mismatch.shortId;
  return (
    <tr>
      <td className="whitespace-nowrap px-6 py-4 font-mono text-sm text-gray-900 dark:text-white">
        inst-{mismatch.shortId}
      </td>
      <td className="whitespace-nowrap px-6 py-4">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
          mismatch.type === "zombie"
            ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
            : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
        }`}>
          {mismatch.type === "zombie" ? "🧟 Zombie" : "👻 Ghost"}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
        {mismatch.type === "zombie"
          ? "K3s resources exist, no DB record"
          : <>DB record ({mismatch.subdomain}), status: <strong>{mismatch.dbStatus}</strong></>
        }
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-right">
        {mismatch.type === "zombie" ? (
          <button
            onClick={() => onDeleteZombie(mismatch.shortId)}
            disabled={isLoading}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {isLoading ? "Deleting…" : "Delete Resources"}
          </button>
        ) : mismatch.dbStatus !== "error" ? (
          <button
            onClick={() => onMarkGhost(mismatch.instanceId!, mismatch.shortId)}
            disabled={isLoading}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
          >
            {isLoading ? "Updating…" : "Mark as Error"}
          </button>
        ) : (
          <span className="text-xs text-gray-400">Already marked</span>
        )}
      </td>
    </tr>
  );
}
