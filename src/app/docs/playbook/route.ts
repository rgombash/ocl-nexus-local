import { SKILLS_CONTENT } from "@/lib/nexus/mcp/skills";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// GET /docs/playbook
// Returns the OCL Nexus agent playbook as plain text so that agents can
// fetch it directly without parsing HTML or JavaScript tabs.
// ---------------------------------------------------------------------------

export async function GET() {
  return new NextResponse(SKILLS_CONTENT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
