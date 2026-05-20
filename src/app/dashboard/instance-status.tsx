"use client";

import { useEffect, useState } from "react";

interface InstanceStatusProps {
  instanceId: string;
  initialDbStatus: string;
}

type PodStatus = "pulling" | "starting" | "running" | "error" | "suspended";

const badgeConfig: Record<PodStatus, { bg: string; text: string; label: string }> = {
  pulling: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-300", label: "Pulling Image" },
  starting: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-300", label: "Starting" },
  running: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-300", label: "Running" },
  error: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-300", label: "Error" },
  suspended: { bg: "bg-gray-100 dark:bg-gray-700", text: "text-gray-800 dark:text-gray-300", label: "Suspended" },
};

export default function InstanceStatus({ instanceId, initialDbStatus }: InstanceStatusProps) {
  const [podStatus, setPodStatus] = useState<PodStatus | null>(
    initialDbStatus === "suspended" ? "suspended" : null
  );
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    // Don't poll if suspended — that's a billing state, not a K8s state
    if (initialDbStatus === "suspended") return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/instances/${instanceId}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setPodStatus(data.status);
        setMessage(data.message ?? "");
      } catch {
        // Network error — keep retrying
      }
    }

    // Initial fetch
    poll();

    // Poll every 5 seconds while not running
    const interval = setInterval(() => {
      if (!cancelled) poll();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [instanceId, initialDbStatus]);

  // Stop polling once running (clean up via a separate effect)
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (podStatus === "running") setStopped(true);
  }, [podStatus]);

  // If we haven't fetched yet and DB says active, show a temporary badge
  if (!podStatus && initialDbStatus === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        active
      </span>
    );
  }

  if (!podStatus) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
        checking…
      </span>
    );
  }

  const cfg = badgeConfig[podStatus];

  return (
    <div>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
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
        {!stopped && podStatus !== "running" && podStatus !== "error" && podStatus !== "suspended" && (
          <svg className="ml-0.5 h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </span>
      {message && podStatus !== "running" && (
        <p className="mt-1 text-xs text-gray-500">{message}</p>
      )}
    </div>
  );
}
