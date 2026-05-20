/**
 * OCL Nexus — Blueprint Registry
 *
 * This file defines all available workload blueprints that can be deployed
 * on the OCL Nexus platform. Each blueprint specifies the container image,
 * port configuration, resource requirements, and UI metadata.
 */

// ---------------------------------------------------------------------------
// Blueprint Type Definitions
// ---------------------------------------------------------------------------

/**
 * A Blueprint defines a deployable workload template.
 */
export interface Blueprint {
  /** Unique identifier for the blueprint */
  id: string;

  /** Human-readable display name */
  displayName: string;

  /** Short description for the UI */
  description: string;

  /** Container image (with tag) */
  image: string;

  /** The internal port the container listens on */
  port: number;

  /** Whether this blueprint requires LLM API keys to be configured */
  requiresLlmKeys: boolean;

  /** Whether this workload requires persistent disk storage */
  persistence: boolean;

  /** Size of the PVC (e.g., '1Gi', '10Gi') — only used if persistence is true */
  pvcSize: string;

  /** Whether this workload gets a dedicated code/infrastructure state volume */
  codePersistence: boolean;

  /** Internal container path for code volume (e.g., '/app') */
  codeMountPath: string;

  /** Size of the code PVC (e.g., '250Mi') — only used if codePersistence is true */
  codePvcSize: string;

  /** Optional: Custom environment variables to inject */
  envVars?: Array<{ name: string; value: string }>;

  /** Optional: Init container logic (for workspace setup, etc.) */
  hasInitContainer?: boolean;

  /**
   * Runtime metadata for AI agent consumption.
   * Surfaced by nexus_list_blueprints so agents can choose the right blueprint.
   */
  runtimeInfo?: {
    /** Short runtime descriptor (e.g. "Python 3.12") */
    runtime: string;
    /** Available package managers / tools */
    packageManagers: string[];
    /** Whether the Nexus Entrypoint / nexus-start.sh workflow applies */
    serviceMode: boolean;
    /** Agent-facing guidance (shown in nexus_list_blueprints) */
    notes: string;
  };

  /** Icon emoji or character for UI display */
  icon: string;

  /** Category for grouping in the UI */
  category: "ai-assistant" | "sandbox" | "tool" | "other";

  /** Container resource envelope */
  resources: {
    memoryLimit: string;
    memoryRequest: string;
    cpuLimit: string;
    cpuRequest: string;
  };

  /** Whether the blueprint is production-ready */
  isStable: boolean;
}

// ---------------------------------------------------------------------------
// Blueprint Registry
// ---------------------------------------------------------------------------

/**
 * The centralized registry of all available blueprints.
 * This is the single source of truth for workload definitions.
 */
export const BLUEPRINTS: Record<string, Blueprint> = {
  openclaw: {
    id: "openclaw",
    displayName: "OpenClaw",
    description:
      "Full-featured AI coding assistant with multi-LLM support, code execution, and persistent workspace.",
    image: "ghcr.io/openclaw/openclaw:latest",
    port: 18789,
    requiresLlmKeys: true,
    persistence: true,
    pvcSize: "10Gi",
    codePersistence: false, // Existing 10Gi data volume handles state
    codeMountPath: "",
    codePvcSize: "",
    hasInitContainer: true,
    runtimeInfo: {
      runtime: "OpenClaw AI Workspace",
      packageManagers: [],
      serviceMode: false,
      notes: "Full AI coding assistant. Requires LLM API keys via config set. Web UI on port 18789.",
    },
    icon: "🦀",
    category: "ai-assistant",
    isStable: true,
    resources: {
      memoryLimit: "4Gi",
      memoryRequest: "512Mi",
      cpuLimit: "1000m",
      cpuRequest: "100m",
    },
  },

  nanoclaw: {
    id: "nanoclaw",
    displayName: "NanoClaw",
    description:
      "Lightweight AI assistant with natural language interface. Perfect for quick tasks and experimentation.",
    image: "qwibitai/nanoclaw:latest",
    port: 8080,
    requiresLlmKeys: true,
    persistence: true,
    pvcSize: "2Gi",
    codePersistence: false,
    codeMountPath: "",
    codePvcSize: "",
    runtimeInfo: {
      runtime: "NanoClaw Lightweight AI",
      packageManagers: [],
      serviceMode: false,
      notes: "Lightweight AI assistant. Requires LLM API keys via config set. Web UI on port 8080.",
    },
    icon: "🐚",
    category: "ai-assistant",
    isStable: true,
    resources: {
      memoryLimit: "2Gi",
      memoryRequest: "512Mi",
      cpuLimit: "1000m",
      cpuRequest: "250m",
    },
  },

  "python-sandbox": {
    id: "python-sandbox",
    displayName: "Python Sandbox",
    description:
      "Isolated Python 3.12 environment with pip, venv, and Homebrew. UI deployment initializes an idle container; use via MCP for autonomous code shipment, execution, and service management.",
    image: "ghcr.io/rgombash/nexus-python-sandbox:latest",
    port: 8000,
    requiresLlmKeys: false,
    persistence: false,
    pvcSize: "0Gi",
    codePersistence: true,
    codeMountPath: "/app",
    codePvcSize: "250Mi",
    runtimeInfo: {
      runtime: "Python 3.12",
      packageManagers: ["pip3", "venv", "homebrew"],
      serviceMode: true,
      notes: "Upload app code to /app, add nexus-start.sh (pip3 install + exec python3), call nexus_restart to activate. Use pip3 with --break-system-packages.",
    },
    icon: "🐍",
    category: "sandbox",
    isStable: true,
    resources: {
      memoryLimit: "2Gi",
      memoryRequest: "256Mi",
      cpuLimit: "1000m",
      cpuRequest: "100m",
    },
  },

  "nodejs-sandbox": {
    id: "nodejs-sandbox",
    displayName: "Node.js Sandbox",
    description:
      "Isolated Node.js 20 environment with pnpm and Homebrew. UI deployment initializes an idle container; use via MCP for autonomous code shipment, execution, and service management.",
    image: "ghcr.io/rgombash/nexus-nodejs-sandbox:latest",
    port: 3000,
    requiresLlmKeys: false,
    persistence: false,
    pvcSize: "0Gi",
    codePersistence: true,
    codeMountPath: "/app",
    codePvcSize: "250Mi",
    runtimeInfo: {
      runtime: "Node.js 20",
      packageManagers: ["npm", "pnpm", "homebrew"],
      serviceMode: true,
      notes: "Upload app code to /app, add nexus-start.sh (npm install + exec node app.js), call nexus_restart to activate. Service listens on port 3000.",
    },
    icon: "📦",
    category: "sandbox",
    isStable: true,
    resources: {
      memoryLimit: "2Gi",
      memoryRequest: "256Mi",
      cpuLimit: "1000m",
      cpuRequest: "100m",
    },
  },

  "hello-world": {
    id: "hello-world",
    displayName: "Hello World",
    description:
      "A tiny test container to verify networking and SSO. Perfect for testing deployments.",
    image: "nginxdemos/hello:latest",
    port: 80,
    requiresLlmKeys: false,
    persistence: false,
    pvcSize: "0Gi",
    codePersistence: false,
    codeMountPath: "",
    codePvcSize: "",
    runtimeInfo: {
      runtime: "nginx",
      packageManagers: [],
      serviceMode: false,
      notes: "Static nginx test server. Use for connectivity and DNS verification only.",
    },
    icon: "👋",
    category: "tool",
    isStable: true,
    resources: {
      memoryLimit: "256Mi",
      memoryRequest: "64Mi",
      cpuLimit: "200m",
      cpuRequest: "50m",
    },
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Get a blueprint by ID.
 * @throws Error if blueprint not found
 */
export function getBlueprint(blueprintId: string): Blueprint {
  const blueprint = BLUEPRINTS[blueprintId];
  if (!blueprint) {
    throw new Error(`Blueprint not found: ${blueprintId}`);
  }
  return blueprint;
}

/**
 * Get all blueprints (including experimental ones).
 */
export function getAllBlueprints(): Blueprint[] {
  return Object.values(BLUEPRINTS);
}

/**
 * Get all stable blueprints (for the public workload gallery).
 */
export function getStableBlueprints(): Blueprint[] {
  return Object.values(BLUEPRINTS).filter((bp) => bp.isStable);
}

/**
 * Get all blueprints in a specific category.
 */
export function getBlueprintsByCategory(
  category: Blueprint["category"]
): Blueprint[] {
  return Object.values(BLUEPRINTS).filter((bp) => bp.category === category);
}

/**
 * Check if a blueprint exists.
 */
export function blueprintExists(blueprintId: string): boolean {
  return blueprintId in BLUEPRINTS;
}
