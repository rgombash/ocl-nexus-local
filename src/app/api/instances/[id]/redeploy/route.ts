import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import * as k8s from "@kubernetes/client-node";
import { logAction } from "@/lib/audit";
import { decrypt } from "@/lib/encryption";
import { getBlueprint } from "@/lib/nexus/blueprints";
import { INFRA_DOMAIN, getUserNamespace } from "@/lib/config/nexus";

// ---------------------------------------------------------------------------
// POST /api/instances/[id]/redeploy
//
// Re-applies the Deployment manifest to the existing namespace, preserving
// the Persistent Volume. Uses imagePullPolicy: Always so the node pulls the
// latest image from GHCR. Refreshes env vars from tenant_configs.
// ---------------------------------------------------------------------------

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 1. Auth & ownership check ───────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: instance, error: fetchErr } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id")
    .eq("id", id)
    .single();

  if (fetchErr || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // Allow admins to redeploy any instance
  if (instance.user_id !== user.id) {
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── 2. Node + kubeconfig ─────────────────────────────────────────────────
  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  if (!node?.kubeconfig) {
    return NextResponse.json(
      { error: "Node kubeconfig not available" },
      { status: 500 }
    );
  }

  // ── 2.5. Get blueprint config ────────────────────────────────────────────
  const blueprintId = instance.blueprint_id || "openclaw";
  const blueprint = getBlueprint(blueprintId);

  const shortId = instance.subdomain.replace("inst-", "");
  const namespace = getUserNamespace(instance.user_id);
  const subdomain = instance.subdomain;

  // ── 3. Refresh tenant config (env vars) ─────────────────────────────────
  // Use the instance owner's config (supports admin redeploying another user's instance)
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("provider, model, api_key, provider_keys, setup_scripts")
    .eq("user_id", instance.user_id)
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

  // ── 4. Prepare container image ────────────────────────────────────────
  const ghcrUsername = process.env.GHCR_USERNAME;
  const ghcrToken = process.env.GHCR_TOKEN;
  if (!ghcrUsername || !ghcrToken) {
    return NextResponse.json(
      { error: "GHCR credentials not configured" },
      { status: 500 }
    );
  }

  const containerImage = blueprint.image.startsWith("ghcr.io/")
    ? blueprint.image.replace("${GHCR_USERNAME}", ghcrUsername)
    : blueprint.image;

  // ── 5. Connect to K8s and re-apply the Deployment ────────────────────────
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(decrypt(node.kubeconfig));
    const appsApi = kc.makeApiClient(k8s.AppsV1Api);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    // Refresh imagePullSecret so the node uses the latest GHCR token
    const dockerConfigJson = Buffer.from(
      JSON.stringify({
        auths: {
          "ghcr.io": {
            username: ghcrUsername,
            password: ghcrToken,
            auth: Buffer.from(`${ghcrUsername}:${ghcrToken}`).toString(
              "base64"
            ),
          },
        },
      })
    ).toString("base64");

    try {
      await coreApi.replaceNamespacedSecret({
        name: "ghcr-pull-secret",
        namespace,
        body: {
          metadata: { name: "ghcr-pull-secret", namespace },
          type: "kubernetes.io/dockerconfigjson",
          data: { ".dockerconfigjson": dockerConfigJson },
        },
      });
    } catch {
      // If the secret doesn't exist yet, create it
      await coreApi.createNamespacedSecret({
        namespace,
        body: {
          metadata: { name: "ghcr-pull-secret", namespace },
          type: "kubernetes.io/dockerconfigjson",
          data: { ".dockerconfigjson": dockerConfigJson },
        },
      });
    }

    // Read the current Deployment to get its resourceVersion for the PUT
    const deploymentName = `app-${shortId}`;
    const currentDeployment = await appsApi.readNamespacedDeployment({
      name: deploymentName,
      namespace,
    });

    const resourceVersion =
      currentDeployment.metadata?.resourceVersion ?? undefined;

    // Build main container with imagePullPolicy: Always
    const mainContainer: k8s.V1Container = {
      name: blueprintId,
      image: containerImage,
      imagePullPolicy: "Always",
      ports: [{ containerPort: blueprint.port }],
      env: envVars,
      volumeMounts: [{ name: "data", mountPath: "/home/node/.openclaw" }],
      resources: {
        limits: { memory: "4Gi", cpu: "1000m" },
        requests: { memory: "512Mi", cpu: "500m" },
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

    // Build Openclaw-specific init container (only for openclaw blueprint)
    const initContainers: k8s.V1Container[] = [];
    if (blueprintId === "openclaw") {
      const openclawConfig = JSON.stringify({
        channels: {
          whatsapp: { dmPolicy: "pairing" },
        },
        agents: {
          defaults: {
            model: { primary: modelPrimary },
          },
        },
        gateway: {
          auth: {
            mode: "trusted-proxy",
            trustedProxy: {
              userHeader: "x-forwarded-user",
            },
          },
          bind: "lan",
          trustedProxies: ["10.42.0.0/16"],
          controlUi: {
            allowedOrigins: [`https://${subdomain}.${INFRA_DOMAIN}`],
          },
        },
      });

      initContainers.push({
        name: "fix-permissions",
        image: "busybox",
        command: [
          "sh",
          "-c",
          [
            "mkdir -p /home/node/.openclaw",
            `printf '%s' '${openclawConfig}' > /home/node/.openclaw/openclaw.json`,
            "chown -R 1000:1000 /home/node/.openclaw",
          ].join(" && "),
        ],
        volumeMounts: [
          { name: "data", mountPath: "/home/node/.openclaw" },
        ],
      } as k8s.V1Container);
    }

    // Full replace of the Deployment — this resets initContainers to just
    // fix-permissions (removes any restore-backup from original deploy),
    // pulls the latest image, and refreshes env vars.
    await appsApi.replaceNamespacedDeployment({
      name: deploymentName,
      namespace,
      body: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: deploymentName,
          namespace,
          resourceVersion,
          annotations: {
            "kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
          },
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: blueprintId } },
          template: {
            metadata: {
              labels: { app: blueprintId },
              annotations: {
                "kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
              },
            },
            spec: {
              securityContext: { fsGroup: 1000 },
              initContainers,
              containers: [mainContainer],
              imagePullSecrets: [{ name: "ghcr-pull-secret" }],
              volumes: [
                {
                  name: "data",
                  persistentVolumeClaim: { claimName: "oc-storage" },
                },
              ],
            },
          },
        },
      },
    });
  } catch (err) {
    console.error("[redeploy] K8s apply failed:", err);
    await logAction(user.id, "INSTANCE_REDEPLOY_FAILURE", "failure", {
      instance_id: instance.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to redeploy instance" },
      { status: 500 }
    );
  }

  await logAction(user.id, "INSTANCE_REDEPLOY", "success", {
    instance_id: instance.id,
    subdomain: instance.subdomain,
    blueprint_id: blueprintId,
  });

  return NextResponse.json({ ok: true });
}
