"use client";

import { useState } from "react";

const mcpConfigCode = `// claude_desktop_config.json
{
  "mcpServers": {
    "ocl-nexus-local": {
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer nx_a1b2c3d4..."
      }
    }
  }
}`;

const restApiCode = `# Deploy a Python sandbox
$ curl -X POST http://localhost:3000/api/v1/workloads \\
    -H "Authorization: Bearer nx_a1b2c3d4..." \\
    -d '{"blueprint_id": "python-sandbox"}'

{
  "ok": true,
  "instanceId": "3f8a1c2d-...",
  "subdomain":  "inst-3f8a1c2d",
  "internalUrl": "http://svc-3f8a1c2d:80"
}`;

export default function ProgrammableInfraTabs() {
  const [tab, setTab] = useState<"mcp" | "rest">("mcp");

  return (
    <div className="flex flex-col">
      {/* Tab header */}
      <div className="flex border-b border-slate-800 bg-slate-950/60">
        <button
          onClick={() => setTab("mcp")}
          className={`px-4 py-2.5 text-xs font-mono transition-colors ${
            tab === "mcp"
              ? "text-blue-400 border-b border-blue-500"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          MCP Config
        </button>
        <button
          onClick={() => setTab("rest")}
          className={`px-4 py-2.5 text-xs font-mono transition-colors ${
            tab === "rest"
              ? "text-blue-400 border-b border-blue-500"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          REST API
        </button>
      </div>
      {/* Code */}
      <pre className="flex-1 overflow-x-auto p-6 text-xs leading-relaxed text-slate-300 font-mono bg-slate-950/40">
        <code>{tab === "mcp" ? mcpConfigCode : restApiCode}</code>
      </pre>
    </div>
  );
}
