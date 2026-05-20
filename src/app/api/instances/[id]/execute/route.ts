import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import * as k8s from "@kubernetes/client-node";
import { COMMAND_REGISTRY, resolveCommand } from "@/lib/oc-commands";
import { executeCommand } from "@/lib/k8s/exec-utils";
import { getUserNamespace } from "@/lib/config/nexus";
import { decrypt } from "@/lib/encryption";

// ---------------------------------------------------------------------------
// POST /api/instances/[id]/execute
//
// Runs an approved Openclaw CLI command inside the tenant's pod.
//
// Request body:
//   { actionKey: 'CHANNEL_LOGIN', params: { channel: 'whatsapp' } }
//
// Security:
//   - Session auth required; ownership verified against instance.user_id
//   - actionKey MUST appear in COMMAND_REGISTRY — no arbitrary shell commands
//   - params are substituted as plain values only (no shell injection path)
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse request body ────────────────────────────────────────────────────
  let actionKey: string;
  let actionParams: Record<string, string> = {};
  try {
    const body = await request.json();
    if (typeof body.actionKey !== "string" || !body.actionKey) {
      return NextResponse.json({ error: "actionKey is required" }, { status: 400 });
    }
    actionKey = body.actionKey;
    if (body.params && typeof body.params === "object") {
      // Validate that all param values are plain strings (prevent injection)
      for (const [k, v] of Object.entries(body.params)) {
        if (typeof v !== "string") {
          return NextResponse.json(
            { error: `Param '${k}' must be a string` },
            { status: 400 }
          );
        }
      }
      actionParams = body.params as Record<string, string>;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── Validate actionKey against registry (no arbitrary commands) ───────────
  if (!(actionKey in COMMAND_REGISTRY)) {
    return NextResponse.json(
      { error: `Unknown actionKey: ${actionKey}` },
      { status: 400 }
    );
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  const { data: instance } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, node_id, user_id, status, blueprint_id")
    .eq("id", id)
    .single();

  if (!instance || instance.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (instance.status !== "active") {
    return NextResponse.json(
      { error: "Instance is not active" },
      { status: 409 }
    );
  }

  // ── Fetch node kubeconfig ─────────────────────────────────────────────────
  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  if (!node?.kubeconfig) {
    return NextResponse.json({ error: "Node unavailable" }, { status: 503 });
  }

  // ── Resolve command from registry ─────────────────────────────────────────
  let command: string[];
  try {
    command = resolveCommand(actionKey, actionParams);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid command params" },
      { status: 400 }
    );
  }

  // ── Find pod name via K8s ─────────────────────────────────────────────────
  const namespace = getUserNamespace(instance.user_id);
  const blueprintId = instance.blueprint_id ?? "openclaw";

  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(decrypt(node.kubeconfig));
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const podList = await coreApi.listNamespacedPod({
      namespace,
      labelSelector: `app=${blueprintId}`,
    });

    const pod = podList.items[0];
    if (!pod?.metadata?.name) {
      return NextResponse.json(
        { error: "Pod not found — is the instance running?" },
        { status: 503 }
      );
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    const cmdDef = COMMAND_REGISTRY[actionKey as keyof typeof COMMAND_REGISTRY];
    const output = await executeCommand(
      node.kubeconfig,
      namespace,
      pod.metadata.name,
      blueprintId, // Container name matches blueprint ID
      command,
      cmdDef.timeoutMs,
      cmdDef.tty
    );

    return NextResponse.json({ ok: true, output });
  } catch (err) {
    console.error("[execute] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Execution failed" },
      { status: 500 }
    );
  }
}
