"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface CockpitModalProps {
  instanceId: string;
  subdomain: string;
  blueprintId: string;
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "logs" | "shell" | "info";

export default function CockpitModal({
  instanceId,
  subdomain,
  blueprintId,
  isOpen,
  onClose,
}: CockpitModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("logs");
  const [logs, setLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [shellCommand, setShellCommand] = useState("");
  const [shellOutput, setShellOutput] = useState<string[]>([]);
  const [shellLoading, setShellLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const shellEndRef = useRef<HTMLDivElement>(null);
  
  // Fetch logs — stable reference so useEffect deps don't cause a re-fetch loop
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/instances/${instanceId}/logs?lines=200`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || "No logs available");
      } else {
        setLogs("Failed to fetch logs");
      }
    } catch {
      setLogs("Network error fetching logs");
    } finally {
      setLogsLoading(false);
    }
  }, [instanceId]);

  // Auto-refresh logs
  useEffect(() => {
    if (!isOpen || activeTab !== "logs" || !autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [isOpen, activeTab, autoRefresh, fetchLogs]);

  // Initial logs fetch when tab opens
  useEffect(() => {
    if (isOpen && activeTab === "logs") {
      fetchLogs();
    }
  }, [isOpen, activeTab, fetchLogs]);

  // Execute shell command
  const executeShellCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shellCommand.trim()) return;

    setShellLoading(true);
    const cmd = shellCommand.trim();
    
    // Add command to output
    setShellOutput(prev => [...prev, `$ ${cmd}`, "..."]);
    
    try {
      const res = await fetch(`/api/instances/${instanceId}/shell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });

      if (res.ok) {
        const data = await res.json();
        const lines = (data.output || "(no output)").split("\n");
        setShellOutput(prev => [
          ...prev.slice(0, -1), // Remove "..."
          ...lines,
          "", // Empty line separator
        ]);
      } else {
        const data = await res.json();
        setShellOutput(prev => [
          ...prev.slice(0, -1), // Remove "..."
          `Error: ${data.error || "Command failed"}`,
          "", // Empty line separator
        ]);
      }
    } catch {
      setShellOutput(prev => [
        ...prev.slice(0, -1), // Remove "..."
        "Network error executing command",
        "", // Empty line separator
      ]);
    } finally {
      setShellLoading(false);
      setShellCommand("");
      
      // Scroll to bottom
      setTimeout(() => {
        shellEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  // Copy internal URL — K8s Service always exposes :80 regardless of blueprint port
  const copyInternalUrl = () => {
    const shortId = subdomain.replace("inst-", "");
    const internalUrl = `http://svc-${shortId}:80`;
    navigator.clipboard.writeText(internalUrl);
    alert(`Copied: ${internalUrl}`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Workload Cockpit
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {subdomain}.localhost
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("logs")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              activeTab === "logs"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            📜 Logs
          </button>
          <button
            onClick={() => setActiveTab("shell")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              activeTab === "shell"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            💻 Shell
          </button>
          <button
            onClick={() => setActiveTab("info")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              activeTab === "info"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            ℹ️ Info
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "logs" && (
            <div className="flex h-full flex-col">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={fetchLogs}
                    disabled={logsLoading}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                  >
                    {logsLoading ? "Refreshing..." : "Refresh"}
                  </button>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    Auto-refresh (5s)
                  </label>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Last 200 lines
                </p>
              </div>
              <pre className="flex-1 overflow-auto rounded-lg bg-gray-900 p-4 font-mono text-xs leading-relaxed text-green-400">
                {logs || "Loading logs..."}
              </pre>
            </div>
          )}

          {activeTab === "shell" && (
            <div className="flex h-full flex-col">
              <div className="mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Execute commands directly in your container. Simple whitespace-split parsing.
                </p>
              </div>
              
              <div className="mb-4 flex-1 overflow-auto rounded-lg bg-gray-900 p-4 font-mono text-xs leading-relaxed text-green-400">
                {shellOutput.length === 0 ? (
                  <p className="text-gray-500">No commands executed yet. Try: ls -la</p>
                ) : (
                  <>
                    {shellOutput.map((line, idx) => (
                      <div key={idx}>{line}</div>
                    ))}
                    <div ref={shellEndRef} />
                  </>
                )}
              </div>

              <form onSubmit={executeShellCommand} className="flex gap-2">
                <input
                  type="text"
                  value={shellCommand}
                  onChange={(e) => setShellCommand(e.target.value)}
                  placeholder="Enter command (e.g., ls -la, pwd, cat file.txt)"
                  disabled={shellLoading}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={shellLoading || !shellCommand.trim()}
                  className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {shellLoading ? "Running..." : "Execute"}
                </button>
              </form>
            </div>
          )}

          {activeTab === "info" && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                  Internal Service Discovery
                </h3>
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                  Use this URL to connect other services within the OCL Nexus cluster to this workload.
                </p>
                
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
                  <label className="mb-2 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Internal Nexus URL
                  </label>
                  <div className="flex gap-2">
                    <code className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                      http://svc-{subdomain.replace("inst-", "")}:80
                    </code>
                    <button
                      onClick={copyInternalUrl}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    ⚠️ This URL only works within the K3s cluster, not from external networks.
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                  External Access
                </h3>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
                  <label className="mb-2 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Public URL
                  </label>
                  <code className="block rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                    http://{subdomain}.localhost
                  </code>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                  Workload Details
                </h3>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-gray-400">Blueprint:</dt>
                      <dd className="font-medium text-gray-900 dark:text-white">{blueprintId}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-gray-400">Subdomain:</dt>
                      <dd className="font-medium text-gray-900 dark:text-white">{subdomain}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-gray-400">Instance ID:</dt>
                      <dd className="font-mono text-xs text-gray-600 dark:text-gray-400">{instanceId}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
