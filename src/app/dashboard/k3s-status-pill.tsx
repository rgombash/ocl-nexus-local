"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "ready" | "offline";

export default function K3sStatusPill() {
  const [status, setStatus] = useState<Status>("checking");
  const [nodeName, setNodeName] = useState("");

  async function poll() {
    try {
      const res = await fetch("/api/k3s/status");
      const data = await res.json();
      setStatus(data.ready ? "ready" : "offline");
      if (data.nodeName) setNodeName(data.nodeName);
    } catch {
      setStatus("offline");
    }
  }

  useEffect(() => {
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
        K3s…
      </span>
    );
  }

  if (status === "ready") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-sm font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300"
        title={nodeName || "K3s cluster ready"}
      >
        <span className="h-2 w-2 rounded-full bg-green-500" />
        K3s Ready
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-sm font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300"
      title="K3s cluster unreachable"
    >
      <span className="h-2 w-2 rounded-full bg-red-500" />
      K3s Offline
    </span>
  );
}
