/**
 * ops/deploy.ts — Deploy a new workload instance.
 *
 * Extracted from /api/instances/deploy and /api/v1/workloads (POST).
 * Core K8s provisioning logic shared between UI (session auth) and M2M (API
 * key auth) deploy routes.
 *
 * Auth, balance checks, and body parsing happen in the adapter. This function
 * takes a fully-validated DeployInput and returns a DeployResult (or throws
 * a NexusError subclass).
 *
 * Audit: INSTANCE_DEPLOY_START, INSTANCE_DEPLOY_SUCCESS, INSTANCE_DEPLOY_FAILURE
 *        NAMESPACE_CREATE, NAMESPACE_REUSE
 */
import * as k8s from "@kubernetes/client-node";
import { randomBytes } from "crypto";
import { logAction } from "@/lib/audit";
import { getBlueprint, blueprintExists } from "@/lib/nexus/blueprints";
import { INFRA_DOMAIN, getUserNamespace } from "@/lib/config/nexus";
import { syncConfigSetToK8s } from "@/lib/k8s/sync-secrets";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getNodeKubeconfig } from "@/lib/nexus/client";
import { decrypt } from "@/lib/encryption";
import {
  BadRequestError,
  ServerError,
  InstanceLimitError,
} from "@/lib/nexus/errors";
import { hasFlag } from "@/lib/flags";
import type { DeployResult } from "@/lib/nexus/types";

export interface DeployInput {
  userId: string;
  blueprintId?: string;           // default "openclaw"
  configSetId?: string | null;
  userDescription?: string | null;
  useStaging?: boolean;           // adapter sets from user flags
  apiKeyId?: string | null;       // M2M only
}

/**
 * Check whether userId is under their instance limit.
 * VIPs bypass the check entirely. null max_instances = unlimited.
 * Throws InstanceLimitError (HTTP 429) if the ceiling is reached.
 */
async function checkInstanceLimit(userId: string): Promise<void> {
  const [countResult, profileResult] = await Promise.all([
    supabaseAdmin
      .from("instances")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabaseAdmin
      .from("users")
      .select("max_instances, flags")
      .eq("id", userId)
      .single(),
  ]);

  const isVip = hasFlag<boolean>(
    profileResult.data?.flags as Record<string, unknown> | null | undefined,
    "is_vip",
    false
  );
  if (isVip) return;

  const limit: number | null = profileResult.data?.max_instances ?? 5;
  if (limit === null) return;

  const current = countResult.count ?? 0;
  if (current >= limit) {
    await logAction(userId, "INSTANCE_LIMIT_REACHED", "failure", { current, limit });
    throw new InstanceLimitError(current, limit);
  }
}

/**
 * Deploy a new workload instance.
 *
 * Pre-conditions (enforced by caller):
 *   - userId is authenticated
 *   - balance > 0 || isVip (caller checks, throws PaymentRequiredError if not)
 *   - configSetId (if provided) belongs to userId (caller validates ownership)
 *
 * @throws BadRequestError, NotFoundError, PaymentRequiredError, ServerError, InstanceLimitError
 */
// audit context reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deployWorkload(
  input: DeployInput,
  /* _audit: AuditCtx */
): Promise<DeployResult> {
  const {
    userId,
    configSetId = null,
    userDescription = null,
    useStaging = false,
    apiKeyId = null,
  } = input;
  const blueprintId = input.blueprintId || "openclaw";

  // Validate blueprint
  if (!blueprintExists(blueprintId)) {
    throw new BadRequestError(`Invalid blueprint: ${blueprintId}`);
  }
  const blueprint = getBlueprint(blueprintId);

  // Enforce instance limit (VIPs bypass; null max_instances = unlimited)
  await checkInstanceLimit(userId);

  // Config set secret name (computed from configSetId)
  const configSetSecretName: string | null = configSetId
    ? `set-${configSetId.replace(/-/g, "").substring(0, 8)}`
    : null;

  // Validate LLM keys for blueprints that require them
  if (blueprint.requiresLlmKeys) {
    const { data: config } = await supabaseAdmin
      .from("tenant_configs")
      .select("api_key, provider_keys")
      .eq("user_id", userId)
      .single();
    const hasKeys =
      config?.api_key ||
      (config?.provider_keys &&
        Object.keys(config.provider_keys as Record<string, unknown>).length > 0);
    if (!hasKeys) {
      throw new BadRequestError(
        "This workload requires LLM API keys. Please configure them first."
      );
    }
  }

  await logAction(userId, "INSTANCE_DEPLOY_START", "started", {
    ...(apiKeyId ? { api_key_id: apiKeyId } : {}),
  });

  // ── Node selection (local mode vs cloud) ─────────────────────────────────
  // Import local mode helpers
  const { isLocalMode } = await import("@/lib/auth/dev-user");
  const { getLocalNode } = await import("@/lib/nexus/client");

  interface NodeRecord {
    id: string;
    ip_address: string;
    kubeconfig: string;
    current_tenant_count: number;
    max_tenants: number;
  }

  let node: NodeRecord;

  if (isLocalMode()) {
    // Local mode: use local K3s cluster
    node = getLocalNode();
  } else {
    // Cloud mode: select node from database
    const { data: nodeData, error: nodeErr } = await supabaseAdmin
      .from("nodes")
      .select("id, ip_address, kubeconfig, current_tenant_count, max_tenants")
      .eq("status", "active")
      .eq("is_staging_node", useStaging)
      .order("current_tenant_count", { ascending: true })
      .limit(1)
      .single();

    if (nodeErr || !nodeData) {
      throw new ServerError("No available nodes — please try again later");
    }
    if (nodeData.current_tenant_count >= nodeData.max_tenants) {
      throw new ServerError("All nodes are at capacity — please try again later");
    }

    // Guard against concurrent deploys using live count
    const { count: liveCapacityCheck } = await supabaseAdmin
      .from("instances")
      .select("*", { count: "exact", head: true })
      .eq("node_id", nodeData.id)
      .in("status", ["active", "provisioning"]);

    if ((liveCapacityCheck ?? 0) >= nodeData.max_tenants) {
      throw new ServerError("All nodes are at capacity — please try again later");
    }

    if (!nodeData.kubeconfig) {
      throw new ServerError("Selected node has no kubeconfig");
    }

    node = nodeData;
  }

  // ── Create instance row ───────────────────────────────────────────────────
  let shortId: string;
  let subdomain: string;
  let attempts = 0;
  const maxAttempts = 5;

  do {
    shortId = randomBytes(4).toString("hex");
    subdomain = `inst-${shortId}`;
    const { data: existing } = await supabaseAdmin
      .from("instances")
      .select("id")
      .eq("subdomain", subdomain)
      .maybeSingle();
    if (!existing) break;
    attempts++;
    if (attempts >= maxAttempts) {
      throw new ServerError("Failed to generate unique subdomain. Please try again.");
    }
  } while (attempts < maxAttempts);

  const namespace = getUserNamespace(userId);
  const gatewayToken = randomBytes(16).toString("hex");

  const { data: instance, error: insertErr } = await supabaseAdmin
    .from("instances")
    .insert({
      user_id: userId,
      node_id: node.id,
      subdomain,
      gateway_token: gatewayToken,
      status: "provisioning",
      blueprint_id: blueprintId,
      user_description: userDescription,
    })
    .select("id")
    .single();

  if (insertErr || !instance) {
    console.error("Failed to create instance:", insertErr);
    throw new ServerError("Failed to create instance");
  }

  // ── Fetch tenant config for env vars ──────────────────────────────────────
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("provider, model, api_key, provider_keys, setup_scripts")
    .eq("user_id", userId)
    .single();

  const envVars: k8s.V1EnvVar[] = [
    { name: "OPENCLAW_GATEWAY_BIND", value: "lan" },
    { name: "HOST", value: "0.0.0.0" },
  ];

  if (config) {
    if (config.provider_keys && typeof config.provider_keys === "object") {
      for (const [envName, envVal] of Object.entries(config.provider_keys)) {
        if (typeof envVal === "string") {
          envVars.push({ name: envName, value: decrypt(envVal) });
        }
      }
    } else {
      const keyVarMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        google: "GOOGLE_API_KEY",
        groq: "GROQ_API_KEY",
      };
      const envName = keyVarMap[config.provider] ?? "LLM_API_KEY";
      envVars.push({ name: envName, value: decrypt(config.api_key) });
    }
  }

  const defaultModelMap: Record<string, string> = {
    openai: "openai/gpt-5.4",
    anthropic: "anthropic/claude-opus-4-6",
    google: "google/gemini-3.1-pro-preview",
    groq: "groq/llama-3.3-70b",
  };
  const modelPrimary =
    config?.provider && config?.model
      ? `${config.provider}/${config.model}`
      : config?.provider
        ? defaultModelMap[config.provider] ?? "anthropic/claude-opus-4-6"
        : "anthropic/claude-opus-4-6";

  const setupScripts: string[] = config?.setup_scripts ?? [];

  // ── K8s provisioning ─────────────────────────────────────────────────────
  try {
    // Get kubeconfig (handles encryption/decryption based on mode)
    const kubeconfigString = getNodeKubeconfig(node);
    
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeconfigString);

    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const appsApi = kc.makeApiClient(k8s.AppsV1Api);
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

    // A. Ensure user namespace exists (idempotent)
    try {
      await coreApi.readNamespace({ name: namespace });
      await logAction(userId, "NAMESPACE_REUSE", "success", {
        namespace,
        instance_id: instance.id,
      });
    } catch (err) {
      const status = (err as { code?: number })?.code;
      if (status === 404) {
        await coreApi.createNamespace({ body: { metadata: { name: namespace } } });
        await logAction(userId, "NAMESPACE_CREATE", "success", {
          namespace,
          instance_id: instance.id,
        });
      } else {
        throw err;
      }
    }

    // A2. Create imagePullSecret for GHCR private registry (optional)
    const ghcrUsername = process.env.GHCR_USERNAME;
    const ghcrToken = process.env.GHCR_TOKEN;
    let imagePullSecrets: k8s.V1LocalObjectReference[] = [];
    
    if (ghcrUsername && ghcrToken) {
      // Create image pull secret for private registries
      const dockerConfigJson = Buffer.from(
        JSON.stringify({
          auths: {
            "ghcr.io": {
              username: ghcrUsername,
              password: ghcrToken,
              auth: Buffer.from(`${ghcrUsername}:${ghcrToken}`).toString("base64"),
            },
          },
        })
      ).toString("base64");

      // Always create or update the imagePullSecret — idempotent across all deploys.
      // This handles: existing namespaces created before this code was added, secrets
      // that were deleted, and credential rotation.
      const pullSecretBody = {
        metadata: { name: "ghcr-pull-secret", namespace },
        type: "kubernetes.io/dockerconfigjson",
        data: { ".dockerconfigjson": dockerConfigJson },
      };
      try {
        await coreApi.createNamespacedSecret({ namespace, body: pullSecretBody });
      } catch (secretErr) {
        if ((secretErr as { code?: number })?.code === 409) {
          // Secret already exists — replace it so credentials stay current
          await coreApi.replaceNamespacedSecret({
            name: "ghcr-pull-secret",
            namespace,
            body: pullSecretBody,
          });
        } else {
          throw secretErr;
        }
      }
      imagePullSecrets = [{ name: "ghcr-pull-secret" }];
    }
    // If no credentials provided, imagePullSecrets remains empty array
    // This is fine for public images (python-sandbox, nodejs-sandbox, etc.)

    // A3. Sync config set to K8s Secret (if configSetId provided)
    if (configSetId && configSetSecretName) {
      const nodeKubeconfigString = getNodeKubeconfig(node);
      await syncConfigSetToK8s(userId, configSetId, nodeKubeconfigString);
    }

    // A4. Ensure namespace NetworkPolicy — replace on 409 so stale policies
    // (e.g. missing kube-system ingress rule) are corrected on next deploy.
    // Silently ignored on Flannel nodes, enforced on Canal nodes.
    const networkPolicyBody = {
      metadata: {
        name: "nexus-isolation",
        namespace,
        labels: { "app.kubernetes.io/managed-by": "ocl-nexus" },
      },
      spec: {
        podSelector: {},
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          // Same-namespace pod-to-pod
          { _from: [{ podSelector: {} }] },
          // Traefik (kube-system) proxying inbound requests — Traefik runs as a
          // regular pod (not hostNetwork) so namespaceSelector correctly matches
          // after Canal's post-DNAT policy evaluation
          { _from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }] },
        ],
        egress: [
          // Pod-to-pod within the same namespace
          { to: [{ podSelector: {} }] },
          // DNS via kube-system
          {
            to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
            ports: [
              { protocol: "UDP", port: 53 },
              { protocol: "TCP", port: 53 },
            ],
          },
          // Public internet — excluding cluster-internal ranges
          {
            to: [{
              ipBlock: {
                cidr: "0.0.0.0/0",
                except: [
                  "10.43.0.1/32",   // K3s API server service IP
                  "10.43.0.0/16",   // K3s service CIDR
                  "10.42.0.0/16",   // K3s pod CIDR (other namespaces)
                ],
              },
            }],
          },
        ],
      },
    };
    try {
      await networkingApi.createNamespacedNetworkPolicy({ namespace, body: networkPolicyBody });
    } catch (npErr) {
      if ((npErr as { code?: number })?.code === 409) {
        await networkingApi.replaceNamespacedNetworkPolicy({
          name: "nexus-isolation",
          namespace,
          body: networkPolicyBody,
        });
      } else {
        throw npErr;
      }
    }

    // B. Create PersistentVolumeClaim (conditional)
    if (blueprint.persistence) {
      await coreApi.createNamespacedPersistentVolumeClaim({
        namespace,
        body: {
          metadata: {
            name: `pvc-${shortId}`,
            namespace,
            labels: { instance: shortId },
          },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "local-path",
            resources: { requests: { storage: blueprint.pvcSize } },
          },
        },
      });
    }

    // B2. Create Code PVC
    if (blueprint.codePersistence) {
      await coreApi.createNamespacedPersistentVolumeClaim({
        namespace,
        body: {
          metadata: {
            name: `pvc-code-${shortId}`,
            namespace,
            labels: { instance: shortId, type: "code" },
          },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "local-path",
            resources: { requests: { storage: blueprint.codePvcSize } },
          },
        },
      });
    }

    // C. Create Deployment
    const containerImage = blueprint.image.startsWith("ghcr.io/") && ghcrUsername
      ? blueprint.image.replace("${GHCR_USERNAME}", ghcrUsername)
      : blueprint.image;

    const mainContainer: k8s.V1Container = {
      name: blueprintId,
      image: containerImage,
      ports: [{ containerPort: blueprint.port }],
      env: envVars,
      envFrom: configSetSecretName
        ? [{ secretRef: { name: configSetSecretName } }]
        : undefined,
      volumeMounts: [
        ...(blueprint.persistence
          ? [{ name: "data", mountPath: "/home/node/.openclaw" }]
          : []),
        ...(blueprint.codePersistence
          ? [{ name: "code", mountPath: blueprint.codeMountPath }]
          : []),
      ],
      resources: {
        limits: { memory: blueprint.resources.memoryLimit, cpu: blueprint.resources.cpuLimit },
        requests: { memory: blueprint.resources.memoryRequest, cpu: blueprint.resources.cpuRequest },
      },
      livenessProbe: {
        tcpSocket: { port: blueprint.port },
        initialDelaySeconds: 60,
        periodSeconds: 20,
      },
      readinessProbe: {
        tcpSocket: { port: blueprint.port },
        initialDelaySeconds: 15,
        periodSeconds: 10,
      },
    };

    // Sandbox-specific probe overrides
    if (blueprint.category === "sandbox") {
      mainContainer.livenessProbe = {
        exec: {
          command: ["sh", "-c", "pgrep -f tail > /dev/null || echo ok > /dev/null"],
        },
        initialDelaySeconds: 10,
        periodSeconds: 30,
      };
      mainContainer.readinessProbe = {
        exec: {
          command: ["sh", "-c", "ls /app > /dev/null && echo ready"],
        },
        initialDelaySeconds: 5,
        periodSeconds: 10,
        failureThreshold: 3,
      };
    }

    // Openclaw-specific configuration
    if (blueprintId === "openclaw") {
      mainContainer.args = [
        "node",
        "dist/index.js",
        "gateway",
        "--bind",
        "lan",
        "--allow-unconfigured",
      ];
      if (setupScripts.length > 0) {
        mainContainer.lifecycle = {
          postStart: {
            exec: {
              command: [
                "/bin/sh",
                "-c",
                `sleep 10; ${setupScripts.join(" && ")}`,
              ],
            },
          },
        };
      }
    }

    await appsApi.createNamespacedDeployment({
      namespace,
      body: {
        metadata: {
          name: `app-${shortId}`,
          namespace,
          labels: { app: blueprintId, instance: shortId },
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: blueprintId, instance: shortId } },
          template: {
            metadata: { labels: { app: blueprintId, instance: shortId } },
            spec: {
              automountServiceAccountToken: false,
              securityContext: { fsGroup: 1000 },
              initContainers: [
                ...(blueprintId === "openclaw"
                  ? [
                      {
                        name: "fix-permissions",
                        image: "busybox",
                        command: [
                          "sh",
                          "-c",
                          [
                            "mkdir -p /home/node/.openclaw",
                            `printf '%s' '${JSON.stringify({
                              channels: { whatsapp: { dmPolicy: "pairing" } },
                              agents: { defaults: { model: { primary: modelPrimary } } },
                              gateway: {
                                auth: {
                                  mode: "trusted-proxy",
                                  trustedProxy: { userHeader: "x-forwarded-user" },
                                },
                                bind: "lan",
                                trustedProxies: ["10.42.0.0/16"],
                                controlUi: {
                                  allowedOrigins: [`https://${subdomain}.${INFRA_DOMAIN}`],
                                },
                              },
                            })}' > /home/node/.openclaw/openclaw.json`,
                            "chown -R 1000:1000 /home/node/.openclaw",
                          ].join(" && "),
                        ],
                        volumeMounts: [
                          { name: "data", mountPath: "/home/node/.openclaw" },
                        ],
                      } as k8s.V1Container,
                    ]
                  : []),
                ...(blueprint.codePersistence
                  ? [
                      {
                        name: "fix-code-permissions",
                        image: "busybox",
                        command: [
                          "sh",
                          "-c",
                          `mkdir -p ${blueprint.codeMountPath} && chown -R 1000:1000 ${blueprint.codeMountPath}`,
                        ],
                        volumeMounts: [
                          { name: "code", mountPath: blueprint.codeMountPath },
                        ],
                      } as k8s.V1Container,
                    ]
                  : []),
              ],
              containers: [mainContainer],
              imagePullSecrets: imagePullSecrets.length > 0 ? imagePullSecrets : undefined,
              volumes: [
                ...(blueprint.persistence
                  ? [{ name: "data", persistentVolumeClaim: { claimName: `pvc-${shortId}` } }]
                  : []),
                ...(blueprint.codePersistence
                  ? [{ name: "code", persistentVolumeClaim: { claimName: `pvc-code-${shortId}` } }]
                  : []),
              ],
            },
          },
        },
      },
    });

    // D. Create Service
    await coreApi.createNamespacedService({
      namespace,
      body: {
        metadata: {
          name: `svc-${shortId}`,
          namespace,
          labels: { app: blueprintId, instance: shortId },
        },
        spec: {
          selector: { app: blueprintId, instance: shortId },
          ports: [{ port: 80, targetPort: blueprint.port }],
        },
      },
    });

    // E. Create Traefik ForwardAuth Middleware (cloud mode only)
    // F. Create Traefik IngressRoute (cloud mode only)
    // In local mode, we skip Traefik resources since there's no Traefik CRDs
    if (!isLocalMode()) {
      const appOrigin =
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.oclhosting.com";
      const forwardAuthUrl = new URL(
        `/api/verify-ingress?subdomain=${subdomain}`,
        appOrigin
      ).toString();

      await customApi.createNamespacedCustomObject({
        group: "traefik.io",
        version: "v1alpha1",
        namespace,
        plural: "middlewares",
        body: {
          apiVersion: "traefik.io/v1alpha1",
          kind: "Middleware",
          metadata: {
            name: `auth-${shortId}`,
            namespace,
            labels: { instance: shortId },
          },
          spec: {
            forwardAuth: {
              address: forwardAuthUrl,
              trustForwardHeader: true,
              authResponseHeaders: ["x-forwarded-user"],
            },
          },
        },
      });

      await customApi.createNamespacedCustomObject({
        group: "traefik.io",
        version: "v1alpha1",
        namespace,
        plural: "ingressroutes",
        body: {
          apiVersion: "traefik.io/v1alpha1",
          kind: "IngressRoute",
          metadata: {
            name: `ingress-${shortId}`,
            namespace,
            labels: { instance: shortId },
            annotations: { "traefik.ingress.kubernetes.io/router.timeout": "300s" },
          },
          spec: {
            entryPoints: ["websecure"],
            routes: [
              {
                match: `Host(\`${subdomain}.${INFRA_DOMAIN}\`)`,
                kind: "Rule",
                services: [{ name: `svc-${shortId}`, port: 80 }],
                middlewares: [{ name: `auth-${shortId}` }],
              },
            ],
            tls: {},
          },
        },
      });
    } else {
      // Local mode: standard K8s Ingress (Traefik handles it; no ForwardAuth needed)
      await networkingApi.createNamespacedIngress({
        namespace,
        body: {
          metadata: {
            name: `ingress-${shortId}`,
            namespace,
            labels: { instance: shortId },
          },
          spec: {
            ingressClassName: "traefik",
            rules: [
              {
                host: `${subdomain}.${INFRA_DOMAIN}`,
                http: {
                  paths: [
                    {
                      path: "/",
                      pathType: "Prefix",
                      backend: {
                        service: {
                          name: `svc-${shortId}`,
                          port: { number: 80 },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      console.log("[deploy] Local mode: created Ingress for", `${subdomain}.${INFRA_DOMAIN}`);
    }
  } catch (err) {
    console.error("K8s manifest application failed:", err);
    await logAction(userId, "INSTANCE_DEPLOY_FAILURE", "failure", {
      error: err instanceof Error ? err.message : String(err),
      instance_id: instance.id,
    });
    await supabaseAdmin
      .from("instances")
      .update({ status: "error" })
      .eq("id", instance.id);
    throw new ServerError(
      "Failed to deploy to cluster — please contact support"
    );
  }

  // ── Finalize ──────────────────────────────────────────────────────────────
  const { count: liveCount } = await supabaseAdmin
    .from("instances")
    .select("*", { count: "exact", head: true })
    .eq("node_id", node.id)
    .in("status", ["active", "provisioning"]);

  await supabaseAdmin
    .from("nodes")
    .update({ current_tenant_count: liveCount ?? node.current_tenant_count + 1 })
    .eq("id", node.id);

  await supabaseAdmin
    .from("instances")
    .update({ status: "active", config_set_id: configSetId })
    .eq("id", instance.id);

  await logAction(userId, "INSTANCE_DEPLOY_SUCCESS", "success", {
    node_id: node.id,
    subdomain,
    instance_id: instance.id,
    blueprint_id: blueprintId,
    ...(apiKeyId ? { api_key_id: apiKeyId } : {}),
  });

  const internalUrl = `http://svc-${shortId}:80`;

  return { instanceId: instance.id, subdomain, internalUrl };
}
