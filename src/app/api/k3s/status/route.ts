import { NextResponse } from "next/server";
import * as k8s from "@kubernetes/client-node";
import { getLocalKubeconfig } from "@/lib/nexus/client";
import { isLocalMode } from "@/lib/auth/dev-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isLocalMode()) {
    return NextResponse.json({ ok: false, error: "not_local_mode" }, { status: 404 });
  }

  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(getLocalKubeconfig());
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const { items: nodes } = await coreApi.listNode();

    const readyNodes = nodes.filter((n) =>
      n.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True")
    );

    return NextResponse.json({
      ok: true,
      ready: readyNodes.length > 0,
      nodeName: readyNodes[0]?.metadata?.name ?? nodes[0]?.metadata?.name ?? "unknown",
      readyCount: readyNodes.length,
      totalCount: nodes.length,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      ready: false,
      error: err instanceof Error ? err.message : "unreachable",
    });
  }
}
