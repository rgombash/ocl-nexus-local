/**
 * OCL Nexus Local — Documentation Hub content.
 *
 * All documentation strings live here so the docs page, API keys page,
 * and any future surfaces stay in sync.
 */

export { SKILLS_CONTENT as PLAYBOOK_CONTENT } from "@/lib/nexus/mcp/skills";

// ---------------------------------------------------------------------------
// Platform constants
// ---------------------------------------------------------------------------

export const MCP_ENDPOINT = "http://localhost:3000/api/mcp/v1";
export const KEYS_URL = "/dashboard/settings/keys";

// ---------------------------------------------------------------------------
// IDE configuration snippets
// ---------------------------------------------------------------------------

/** Claude Desktop — no "type" field required */
export const CLAUDE_DESKTOP_CONFIG = `{
  "mcpServers": {
    "ocl-nexus-local": {
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

/** Claude Code (CLI / IDE extension) — "type": "http" is required */
export const CLAUDE_CODE_CONFIG = `{
  "mcpServers": {
    "ocl-nexus-local": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

export const CURSOR_CONFIG = `{
  "mcpServers": {
    "ocl-nexus-local": {
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

export const CONTINUE_CONFIG = `{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "http",
          "url": "http://localhost:3000/api/mcp/v1",
          "headers": {
            "Authorization": "Bearer YOUR_API_KEY"
          }
        }
      }
    ]
  }
}`;

// ---------------------------------------------------------------------------
// CLAUDE.md starter template (Claude Code only)
// ---------------------------------------------------------------------------

export const CLAUDE_MD_TEMPLATE = `## OCL Nexus Local
MCP server \`ocl-nexus-local\` is available. Use it to deploy and manage local sandboxes running on K3s via Docker Compose.

### Key rules
- No billing — workloads run on your local machine; terminate when done to free resources
- Always call \`nexus_wait_for_ready\` after \`nexus_deploy\` or \`nexus_restart\` — never poll manually
- Use \`nexus_write_files\` for 2+ files in one call
- Use \`python3\` / \`pip3 install --break-system-packages\`, never \`python\` / \`pip\`
- Bind to the blueprint's container port: **8000** for python-sandbox, **3000** for nodejs-sandbox
- For pod-to-pod HTTP calls use port **80**: \`http://svc-<id>:80\` — the K8s Service translates :80 → container port internally
- \`nexus_fetch\` hits the public HTTP URL, not the internal URL; use \`nexus_execute_command\` + \`curl\` to test internal reachability

### Service mode pattern (Flask)
    # nexus-start.sh
    pip3 install flask --break-system-packages --quiet && exec python3 app.py

### Workflow
deploy → wait_for_ready → write_files → restart → wait_for_ready → fetch /health`;

// ---------------------------------------------------------------------------
// Handbook copy (Why Nexus section)
// ---------------------------------------------------------------------------

export const WHY_NEXUS = `OCL Nexus Local is a local-first agentic compute fabric running on your own hardware via Docker Compose. It provisions isolated Ubuntu environments backed by a single-node K3s cluster, giving your agents high-performance sandboxes with NVMe-backed storage, internal networking, and a full REST + MCP API — all without leaving your machine.`;

// ---------------------------------------------------------------------------
// Tech note: running local and cloud side-by-side
// ---------------------------------------------------------------------------

export const DUAL_SETUP_NOTE = `Developers using both local and cloud environments should use \`ocl-nexus-local\` and \`ocl-nexus\` as distinct keys in their MCP configuration to enable simultaneous access to both infrastructures.`;
