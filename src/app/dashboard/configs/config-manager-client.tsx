"use client";

import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Trash2, Plus, Edit2, Save } from "lucide-react";

interface ConfigSet {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface ConfigVariable {
  id: string;
  key: string;
  created_at: string;
  updated_at: string;
}

interface VariableWithValue extends ConfigVariable {
  value?: string;
  isRevealed?: boolean;
}

export default function ConfigManagerClient() {
  const [sets, setSets] = useState<ConfigSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [variables, setVariables] = useState<VariableWithValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Create/Edit Set Modal State
  const [showSetModal, setShowSetModal] = useState(false);
  const [isEditingSet, setIsEditingSet] = useState(false);
  const [setName, setSetName] = useState("");
  const [setDescription, setSetDescription] = useState("");

  // Variable Editor State
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [showNewVarForm, setShowNewVarForm] = useState(false);

  // Load config sets on mount
  const loadConfigSets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/config-sets");
      if (!res.ok) throw new Error("Failed to load config sets");
      const data = await res.json();
      setSets(data.sets);
      
      // Auto-select first set if available
      if (data.sets.length > 0 && !activeSetId) {
        setActiveSetId(data.sets[0].id);
      }
    } catch (err) {
      console.error("Failed to load config sets:", err);
    } finally {
      setLoading(false);
    }
  }, [activeSetId]);

  useEffect(() => {
    loadConfigSets();
  }, [loadConfigSets]);

  // Load variables when active set changes
  useEffect(() => {
    if (activeSetId) {
      loadVariables(activeSetId);
    } else {
      setVariables([]);
    }
  }, [activeSetId]);

  async function loadVariables(setId: string) {
    try {
      const res = await fetch(`/api/config-sets/${setId}/variables`);
      if (!res.ok) throw new Error("Failed to load variables");
      const data = await res.json();
      setVariables(data.variables.map((v: ConfigVariable) => ({ ...v, isRevealed: false })));
    } catch (err) {
      console.error("Failed to load variables:", err);
    }
  }

  async function createOrUpdateSet() {
    if (!setName.trim()) {
      alert("Set name is required");
      return;
    }

    try {
      const url = isEditingSet && activeSetId 
        ? `/api/config-sets/${activeSetId}`
        : "/api/config-sets";
      const method = isEditingSet ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: setName, description: setDescription }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save set");
      }

      const data = await res.json();
      await loadConfigSets();
      
      if (!isEditingSet) {
        setActiveSetId(data.set.id);
      }

      setShowSetModal(false);
      setSetName("");
      setSetDescription("");
      setSaveStatus(isEditingSet ? "Set updated" : "Set created");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save set");
    }
  }

  async function deleteSet(setId: string) {
    if (!confirm("Delete this config set? All variables will be deleted.")) return;

    try {
      const res = await fetch(`/api/config-sets/${setId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete set");
      }

      setSets(sets.filter((s) => s.id !== setId));
      if (activeSetId === setId) {
        setActiveSetId(sets[0]?.id || null);
      }
      setSaveStatus("Set deleted");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete set");
    }
  }

  async function revealValue(varId: string) {
    if (!activeSetId) return;

    try {
      const res = await fetch(`/api/config-sets/${activeSetId}/variables/${varId}`);
      if (!res.ok) throw new Error("Failed to load variable value");
      const data = await res.json();

      setVariables((vars) =>
        vars.map((v) =>
          v.id === varId ? { ...v, value: data.variable.value, isRevealed: true } : v
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load variable");
    }
  }

  function hideValue(varId: string) {
    setVariables((vars) =>
      vars.map((v) => (v.id === varId ? { ...v, value: undefined, isRevealed: false } : v))
    );
  }

  async function saveVariable(key: string, value: string) {
    if (!activeSetId) return;
    if (!key.trim() || !value.trim()) {
      alert("Key and value are required");
      return;
    }

    try {
      const res = await fetch(`/api/config-sets/${activeSetId}/variables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.toUpperCase().trim(), value }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save variable");
      }

      await loadVariables(activeSetId);
      setShowNewVarForm(false);
      setNewVarKey("");
      setNewVarValue("");
      setSaveStatus("Variable saved");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save variable");
    }
  }

  async function deleteVariable(varId: string) {
    if (!activeSetId) return;
    if (!confirm("Delete this variable?")) return;

    try {
      const res = await fetch(`/api/config-sets/${activeSetId}/variables/${varId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete variable");

      setVariables(variables.filter((v) => v.id !== varId));
      setSaveStatus("Variable deleted");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete variable");
    }
  }

  const activeSet = sets.find((s) => s.id === activeSetId);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900">
      {/* Sidebar: Config Sets List */}
      <div className="w-64 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Config Sets</h2>
          <button
            onClick={() => {
              setIsEditingSet(false);
              setSetName("");
              setSetDescription("");
              setShowSetModal(true);
            }}
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Create new set"
          >
            <Plus className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        <div className="overflow-y-auto">
          {sets.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No config sets yet.
              <br />
              Click + to create one.
            </div>
          ) : (
            sets.map((set) => (
              <button
                key={set.id}
                onClick={() => setActiveSetId(set.id)}
                className={`w-full border-b border-gray-100 px-4 py-3 text-left transition-colors dark:border-gray-700 ${
                  activeSetId === set.id
                    ? "bg-blue-50 dark:bg-blue-900/20"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                }`}
              >
                <div className="font-medium text-gray-900 dark:text-white">{set.name}</div>
                {set.description && (
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                    {set.description}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Content: Variable Editor */}
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {activeSet?.name || "Configuration Vault"}
              </h1>
              {activeSet?.description && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {activeSet.description}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {activeSet && (
                <>
                  <button
                    onClick={() => {
                      setIsEditingSet(true);
                      setSetName(activeSet.name);
                      setSetDescription(activeSet.description || "");
                      setShowSetModal(true);
                    }}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <Edit2 className="inline h-4 w-4 mr-1" />
                    Edit Set
                  </button>
                  <button
                    onClick={() => deleteSet(activeSet.id)}
                    className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="inline h-4 w-4 mr-1" />
                    Delete Set
                  </button>
                </>
              )}
            </div>
          </div>

          {saveStatus && (
            <div className="mt-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-400">
              {saveStatus}
            </div>
          )}
        </div>

        {activeSet ? (
          <div className="p-6">
            {/* Variables List */}
            <div className="space-y-2">
              {variables.map((variable) => (
                <div
                  key={variable.id}
                  className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex-1">
                    <div className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                      {variable.key}
                    </div>
                    <div className="mt-1 font-mono text-sm text-gray-600 dark:text-gray-400">
                      {variable.isRevealed && variable.value ? (
                        <input
                          type="text"
                          value={variable.value}
                          readOnly
                          className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                      ) : (
                        "••••••••••••••••"
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {variable.isRevealed ? (
                      <button
                        onClick={() => hideValue(variable.id)}
                        className="rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Hide value"
                      >
                        <EyeOff className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      </button>
                    ) : (
                      <button
                        onClick={() => revealValue(variable.id)}
                        className="rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Reveal value"
                      >
                        <Eye className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteVariable(variable.id)}
                      className="rounded p-2 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Delete variable"
                    >
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Variable Form */}
            {showNewVarForm ? (
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Key (uppercase, e.g., API_KEY)
                    </label>
                    <input
                      type="text"
                      value={newVarKey}
                      onChange={(e) => setNewVarKey(e.target.value.toUpperCase())}
                      placeholder="OPENAI_API_KEY"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Value
                    </label>
                    <input
                      type="text"
                      value={newVarValue}
                      onChange={(e) => setNewVarValue(e.target.value)}
                      placeholder="sk-..."
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveVariable(newVarKey, newVarValue)}
                      className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <Save className="h-4 w-4" />
                      Save Variable
                    </button>
                    <button
                      onClick={() => {
                        setShowNewVarForm(false);
                        setNewVarKey("");
                        setNewVarValue("");
                      }}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowNewVarForm(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-4 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-300"
              >
                <Plus className="h-4 w-4" />
                Add Variable
              </button>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p>Select a config set to manage variables</p>
              <p className="mt-2 text-sm">or create a new one to get started</p>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Set Modal */}
      {showSetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {isEditingSet ? "Edit Config Set" : "Create Config Set"}
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Name
                </label>
                <input
                  type="text"
                  value={setName}
                  onChange={(e) => setSetName(e.target.value)}
                  placeholder="Production"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Description (optional)
                </label>
                <textarea
                  value={setDescription}
                  onChange={(e) => setSetDescription(e.target.value)}
                  placeholder="API keys for production environment"
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={createOrUpdateSet}
                  className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {isEditingSet ? "Save Changes" : "Create Set"}
                </button>
                <button
                  onClick={() => {
                    setShowSetModal(false);
                    setSetName("");
                    setSetDescription("");
                  }}
                  className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
