"use client";

import { useState, useTransition } from "react";
import { createApiKey, revokeApiKey } from "./actions";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

interface KeysClientProps {
  initialKeys: ApiKey[];
}

export default function KeysClient({ initialKeys }: KeysClientProps) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [isPending, startTransition] = useTransition();

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Success modal state (shows full key ONCE)
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newKeyPrefix, setNewKeyPrefix] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Revoke confirmation state
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // ── Create API Key ──────────────────────────────────────────────────────
  const handleCreate = () => {
    setCreateError(null);

    startTransition(async () => {
      const result = await createApiKey(createName);

      if (result.ok && result.key && result.prefix) {
        // Success — show the key once
        setNewKey(result.key);
        setNewKeyPrefix(result.prefix);
        setShowCreateModal(false);
        setShowSuccessModal(true);
        setCreateName("");

        // Add to keys list (without the full key)
        const newKeyItem: ApiKey = {
          id: crypto.randomUUID(), // Temporary ID (will refresh on next page load)
          name: createName.trim(),
          key_prefix: result.prefix,
          created_at: new Date().toISOString(),
          last_used_at: null,
        };
        setKeys([newKeyItem, ...keys]);
      } else {
        setCreateError(result.error ?? "Failed to create API key");
      }
    });
  };

  // ── Copy to Clipboard ───────────────────────────────────────────────────
  const handleCopy = async () => {
    if (newKey) {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Revoke API Key ──────────────────────────────────────────────────────
  const handleRevoke = (keyId: string) => {
    setRevokeError(null);

    startTransition(async () => {
      const result = await revokeApiKey(keyId);

      if (result.ok) {
        // Success — remove from list
        setKeys(keys.filter((k) => k.id !== keyId));
        setRevokeKeyId(null);
      } else {
        setRevokeError(result.error ?? "Failed to revoke API key");
      }
    });
  };

  // ── Format dates ────────────────────────────────────────────────────────
  const formatDate = (isoString: string | null) => {
    if (!isoString) return "Never";
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <>
      {/* Create button */}
      <div className="mb-6">
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={isPending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          Create API Key
        </button>
      </div>

      {/* Keys table */}
      {keys.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-600 dark:text-gray-400">
            No API keys yet. Create your first key to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Key Prefix
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Last Used
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {keys.map((key) => (
                <tr key={key.id}>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                    {key.name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-gray-600 dark:text-gray-400">
                    {key.key_prefix}•••
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(key.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(key.last_used_at)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                    <button
                      onClick={() => setRevokeKeyId(key.id)}
                      disabled={isPending}
                      className="text-red-600 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Create API Key
            </h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Choose a descriptive name for this key. You&apos;ll see the full key only once.
            </p>

            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g., Production Bot, Cursor Agent"
              maxLength={50}
              className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />

            {createError && (
              <p className="mb-4 text-sm text-red-600 dark:text-red-400">{createError}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateName("");
                  setCreateError(null);
                }}
                disabled={isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isPending || !createName.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {isPending ? "Creating..." : "Create Key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success modal (shows full key ONCE) */}
      {showSuccessModal && newKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              API Key Created
            </h3>
            <div className="mb-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-900/30">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                ⚠️ Save this key now — you won&apos;t see it again!
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Store it securely (e.g., in your password manager or environment variables).
              </p>
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">
                Your API Key
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKey}
                  readOnly
                  className="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
                <button
                  onClick={handleCopy}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <p className="mb-6 text-xs text-gray-600 dark:text-gray-400">
              Prefix: <span className="font-mono">{newKeyPrefix}</span> (shown in the keys table)
            </p>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setNewKey(null);
                  setNewKeyPrefix(null);
                  setCopied(false);
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke confirmation modal */}
      {revokeKeyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Revoke API Key
            </h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              This will permanently delete the key. Any applications using it will
              immediately lose access.
            </p>

            {keys.find((k) => k.id === revokeKeyId)?.name === "Local Default Key" && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  This is your MCP bootstrap key.
                </p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Claude Desktop and any agents using this key will lose access immediately.
                  Update your MCP config with a new key after revoking.
                </p>
              </div>
            )}

            {revokeError && (
              <p className="mb-4 text-sm text-red-600 dark:text-red-400">{revokeError}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setRevokeKeyId(null);
                  setRevokeError(null);
                }}
                disabled={isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevoke(revokeKeyId)}
                disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
              >
                {isPending ? "Revoking..." : "Revoke Key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
