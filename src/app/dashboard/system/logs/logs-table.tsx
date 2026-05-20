"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

type AuditLog = {
  id: string;
  user_id: string | null;
  action: string;
  status: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, { icon: string; color: string }> = {
  INSTANCE_DEPLOY_START: { icon: "🚀", color: "text-blue-600 dark:text-blue-400" },
  INSTANCE_DEPLOY_SUCCESS: { icon: "✅", color: "text-green-600 dark:text-green-400" },
  INSTANCE_DEPLOY_FAILURE: { icon: "💥", color: "text-red-600 dark:text-red-400" },
  INSTANCE_DELETE_START: { icon: "🗑️", color: "text-orange-600 dark:text-orange-400" },
  INSTANCE_DELETE_SUCCESS: { icon: "✅", color: "text-green-600 dark:text-green-400" },
  INSTANCE_DELETE_FAILURE: { icon: "💥", color: "text-red-600 dark:text-red-400" },
  INSTANCE_RESTART: { icon: "🔄", color: "text-amber-600 dark:text-amber-400" },
  INSTANCE_RESTART_FAILURE: { icon: "💥", color: "text-red-600 dark:text-red-400" },
  INSTANCE_REDEPLOY: { icon: "⬆️", color: "text-blue-600 dark:text-blue-400" },
  INSTANCE_REDEPLOY_FAILURE: { icon: "💥", color: "text-red-600 dark:text-red-400" },
  PAYMENT_TOPUP: { icon: "💰", color: "text-purple-600 dark:text-purple-400" },
  WELCOME_CREDIT_CLAIMED: { icon: "🎁", color: "text-green-600 dark:text-green-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "success"
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      : status === "failure"
        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function MetadataCell({ metadata }: { metadata: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(metadata);

  if (entries.length === 0) return <span className="text-gray-300">—</span>;

  if (!expanded) {
    const preview = entries
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(", ");
    return (
      <button
        onClick={() => setExpanded(true)}
        className="group flex items-center gap-1 text-left font-mono text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        title="Click to expand"
      >
        <span className="max-w-[200px] truncate">{preview}</span>
        <svg
          className="h-3 w-3 shrink-0 text-gray-400 group-hover:text-gray-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(false)}
        className="mb-1 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
        collapse
      </button>
      <pre className="max-w-md whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </div>
  );
}

function timeSince(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatTimestamp(date: string): string {
  // e.g. "2026-03-31 14:32:07 UTC"
  return new Date(date).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default function LogsTable({
  logs,
  page,
  totalPages,
}: {
  logs: AuditLog[];
  page: number;
  totalPages: number;
}) {
  const [filter, setFilter] = useState<string>("all");
  const router = useRouter();
  const pathname = usePathname();

  const actions = Array.from(new Set(logs.map((l) => l.action)));
  const filtered = filter === "all" ? logs : logs.filter((l) => l.action === filter);

  return (
    <>
      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">Filter:</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
        >
          <option value="all">All actions ({logs.length})</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a} ({logs.filter((l) => l.action === a).length})
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Showing {filtered.length} of {logs.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Time</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Action</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">User</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">IP</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.length > 0 ? (
              filtered.map((log) => {
                const label = ACTION_LABELS[log.action];
                return (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-200">
                        {formatTimestamp(log.created_at)}
                      </span>
                      {" "}
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        ({timeSince(log.created_at)})
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className={`font-mono text-xs ${label?.color ?? "text-gray-700 dark:text-gray-300"}`}>
                        {label?.icon ? `${label.icon} ` : ""}
                        {log.action}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {log.user_id?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500 dark:text-gray-400">
                      {log.ip_address ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <MetadataCell metadata={log.metadata} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                  No audit logs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => router.push(`${pathname}?page=${page - 1}`)}
            disabled={page <= 1}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/50"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => router.push(`${pathname}?page=${page + 1}`)}
            disabled={page >= totalPages}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/50"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
