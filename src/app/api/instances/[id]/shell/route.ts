import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import * as k8s from "@kubernetes/client-node";
import { getUserNamespace } from "@/lib/config/nexus";
import { logAction } from "@/lib/audit";
import { executeCommand } from "@/lib/k8s/exec-utils";
import { getNodeKubeconfig } from "@/lib/nexus/client";

// ---------------------------------------------------------------------------
// POST /api/instances/[id]/shell
//
// Execute a command in the primary container of an instance's pod.
// Returns stdout/stderr output.
//
// Body: { command: string }  // e.g., "ls -la" or "pwd"
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth & ownership check ──────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: instance } = await supabaseAdmin
    .from("instances")
    .select("id, subdomain, user_id, node_id, blueprint_id, status")
    .eq("id", id)
    .single();

  if (!instance || instance.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Parse command from body ─────────────────────────────────────────────
  let commandStr: string;
  try {
    const body = await request.json();
    commandStr = body.command;
    if (!commandStr || typeof commandStr !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'command' field" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  // ── Fetch node kubeconfig ───────────────────────────────────────────────
  const { isLocalMode } = await import("@/lib/auth/dev-user");
  const isLocal = isLocalMode();

  const { data: node } = await supabaseAdmin
    .from("nodes")
    .select("kubeconfig")
    .eq("id", instance.node_id)
    .single();

  if (!node?.kubeconfig && !isLocal) {
    return NextResponse.json(
      { error: "Node kubeconfig unavailable" },
      { status: 500 }
    );
  }

  const namespace = getUserNamespace(instance.user_id);
  const blueprintId = instance.blueprint_id ?? "openclaw";
  const shortId = instance.subdomain.replace("inst-", "");
  const kubeconfig = getNodeKubeconfig(node ?? { kubeconfig: "" });

  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    // Find the pod for this instance
    const podList = await coreApi.listNamespacedPod({
      namespace,
      labelSelector: `app=${blueprintId},instance=${shortId}`,
    });

    const pods = podList.items;
    if (!pods || pods.length === 0) {
      return NextResponse.json(
        { error: "No pod found for this instance" },
        { status: 404 }
      );
    }

    const pod = pods[0];
    const podName = pod.metadata?.name;

    if (!podName) {
      return NextResponse.json(
        { error: "Pod name not available" },
        { status: 500 }
      );
    }

    // Execute command in the container
    // Wrap in shell for proper PATH resolution, pipes, redirects, etc.
    const argv = ["sh", "-c", commandStr];
    
    const output = await executeCommand(
      kubeconfig,
      namespace,
      podName,
      blueprintId, // Container name matches blueprint ID
      argv,
      10000, // 10 second timeout
      false  // no TTY for simple commands
    );

    await logAction(user.id, "SHELL_COMMAND_EXECUTE", "success", {
      instance_id: instance.id,
      subdomain: instance.subdomain,
      command: commandStr,
      output_length: output.length,
    });

    return NextResponse.json({
      output,
      command: commandStr,
      podName,
    });
  } catch (err) {
    console.error("[shell] Command execution failed:", err);

    await logAction(user.id, "SHELL_COMMAND_FAILURE", "failure", {
      instance_id: instance.id,
      command: commandStr,
      error: err instanceof Error ? err.message : String(err),
    });

    return NextResponse.json(
      {
        error: "Command execution failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
