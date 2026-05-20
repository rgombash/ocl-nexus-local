/**
 * SKILLS_CONTENT — OCL Nexus agent playbook, inlined for serverless compatibility.
 * Exposed via the nexus://skills MCP resource and mirrors SKILLS.md at the repo root.
 */
export const SKILLS_CONTENT = `# OCL Nexus Local — Agent Playbook

## Overview
OCL Nexus Local provides isolated, programmable compute environments (sandboxes) running on your
local machine via Docker Compose and a single-node K3s cluster. You can deploy Python or Node.js
sandboxes, upload code, execute commands, expose long-running services, and verify they're
responding — all via the 15 MCP tools in this server.

This instance runs on local hardware. There is no billing — workloads consume your local CPU and
RAM only. MCP server key: \`ocl-nexus-local\`. API endpoint: \`http://localhost:3000/api/mcp/v1\`.

## Available Tools

### Discovery
- \`nexus_list_blueprints\`  — list all available blueprints with runtimeInfo
- \`nexus_list_workloads\`   — list your running workloads

### Lifecycle
- \`nexus_deploy\`           — deploy a new workload
- \`nexus_status\`           — get real-time pod status (isReady, publicUrl, internalUrl)
- \`nexus_wait_for_ready\`   — block server-side until pod is ready (replaces polling loops)
- \`nexus_restart\`          — restart a workload (activates nexus-start.sh)
- \`nexus_terminate\`        — delete a workload and free local resources

### Sandbox (code PVC blueprints only)
- \`nexus_write_file\`       — upload a single file to /app
- \`nexus_write_files\`      — upload multiple files in one call (preferred for 2+ files)
- \`nexus_read_file\`        — read a file from /app
- \`nexus_list_files\`       — list files in /app
- \`nexus_delete_file\`      — delete a file from /app
- \`nexus_execute_command\`  — run a shell command inside the pod
- \`nexus_get_logs\`         — get container logs (includes init container logs on failure)
- \`nexus_fetch\`            — make an authenticated HTTP request to your deployed service

### Resources
- \`nexus://wallet/balance\` — API key status and instance capacity
- \`nexus://skills\`         — this playbook

## Canonical Workflow: Deploy → Code → Execute (Idle Mode)

\`\`\`
1. nexus_list_blueprints       → pick blueprint; check runtimeInfo for capabilities
2. nexus_deploy  blueprint_id="python-sandbox"  user_description="my-flask-api"
                               → returns { instanceId, subdomain, publicUrl, internalUrl }
3. nexus_wait_for_ready        → blocks until isReady === true (single call, no loop needed)
4. nexus_write_files          → upload all code files in one call (app.py, nexus-start.sh, etc.)
5. nexus_execute_command       → install deps, run scripts, inspect output
6. nexus_get_logs              → review stdout / stderr (initLogs included on pod failure)
7. nexus_terminate             → clean up when done
\`\`\`

## Canonical Workflow: Service Mode (persistent web server)

To run a long-running service (Flask, Express, FastAPI, any HTTP server):

\`\`\`
1. nexus_deploy  blueprint_id="python-sandbox"  user_description="my-flask-api"
                               → deploy python-sandbox or nodejs-sandbox
2. nexus_wait_for_ready        → wait until pod is idle and ready
3. nexus_write_files  files=[{path:"app.py",...},{path:"nexus-start.sh",...}]  ← upload everything at once
4. nexus_restart                            ← pod reboots, nexus-entrypoint finds nexus-start.sh
5. nexus_wait_for_ready        → wait until service pod is ready
6. nexus_fetch  path="/health" ← verify the service is responding
\`\`\`

### nexus-start.sh — Python / Flask
\`\`\`bash
#!/bin/bash
set -e
pip3 install flask --break-system-packages --quiet
exec python3 app.py
\`\`\`

### nexus-start.sh — Node.js / Express
\`\`\`bash
#!/bin/bash
set -e
npm install express
exec node app.js
\`\`\`

### app.py — minimal Flask health endpoint
\`\`\`python
from flask import Flask, jsonify
app = Flask(__name__)

@app.route("/health")
def health():
    return jsonify({"status": "online"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
\`\`\`

### app.js — minimal Express health endpoint
\`\`\`javascript
const express = require("express");
const app = express();
app.get("/health", (req, res) => res.json({ status: "online", runtime: "node" }));
app.listen(3000, "0.0.0.0");
\`\`\`

## nexus_write_files — Batch Upload (Preferred for 2+ Files)

**Always use nexus_write_files when uploading 2 or more files.**
One tool call replaces N sequential nexus_write_file calls:

\`\`\`
nexus_write_files  instance_id="..."  files=[
  { "path": "app.py",         "content": "...", "encoding": "utf8" },
  { "path": "requirements.txt","content": "...", "encoding": "utf8" },
  { "path": "nexus-start.sh", "content": "...", "encoding": "utf8" }
]
→ { uploaded: 3, failed: 0, total_bytes: 4820, results: [...], message: "Uploaded 3/3 files successfully" }
\`\`\`

- Supports 1–20 files per call.
- Individual file failures are reported in \`results[]\` — the batch does not abort on a single error.
- Check \`failed > 0\` in the response to detect partial failures.
- Use \`nexus_write_file\` (singular) only when uploading a single file.

## nexus_wait_for_ready — Why and When

**Always use nexus_wait_for_ready after nexus_deploy or nexus_restart.**
It polls server-side every 5 s and returns only when \`isReady === true\` (readiness probe passed).
This is a single tool call regardless of how long the pod takes to start.

- Default timeout: 120 s (cold starts with image pulls typically take 60–90 s)
- Returns \`{ ready: true, publicUrl, internalUrl }\` on success
- Returns \`{ ready: false, timedOut: true }\` if timeout exceeded
- Returns immediately with reason on unrecoverable errors (CrashLoopBackOff, suspended)

## nexus_fetch — Verify Your Service

After activating Service Mode, use \`nexus_fetch\` to make authenticated HTTP requests to the
deployed service and confirm it is responding:

\`\`\`
nexus_fetch  instance_id="..."  path="/health"
→ { statusCode: 200, contentType: "application/json", body: '{"status":"online"}', truncated: false }
\`\`\`

- The Bearer token is forwarded automatically — no extra auth needed.
- The target URL is constructed from the database subdomain (not user input) — no SSRF risk.
- Response body is capped at 512 KB. Check \`statusCode\` in the result for app-level errors.
- Supports GET, POST, PUT, PATCH, DELETE and optional request body.

## Blueprint runtimeInfo

\`nexus_list_blueprints\` returns a \`runtimeInfo\` field for each blueprint with:
- \`runtime\`: e.g. "Python 3.12", "Node.js 20"
- \`packageManagers\`: e.g. ["pip3", "venv", "homebrew"]
- \`serviceMode\`: true if the nexus-start.sh workflow applies
- \`notes\`: agent-specific guidance for that blueprint

Always check \`runtimeInfo.serviceMode\` to confirm a blueprint supports persistent services
before attempting Service Mode deployment.

## Status Fields

\`nexus_status\` and \`nexus_wait_for_ready\` return:
- \`status\`: pulling | starting | running | error | suspended | unknown
- \`isReady\`: true only when status === "running" AND readiness probe passed — use this as "safe to proceed" signal
- \`publicUrl\`: full HTTP URL (e.g. http://inst-a1b2c3d4.localhost)
- \`internalUrl\`: cluster-internal URL for pod-to-pod calls (e.g. http://svc-a1b2c3d4:80)

## Multi-Service Networking (Pod-to-Pod)

Instances in the same user namespace can reach each other directly without going through the
public internet. Use \`internalUrl\` from \`nexus_status\`, \`nexus_deploy\`, or \`nexus_wait_for_ready\`.

**Critical port rule:**
- \`internalUrl\` is always port **:80** — that is the K8s Service port (e.g. http://svc-a1b2c3d4:80)
- Apps must still **bind to their container port** (8000 for python-sandbox, 3000 for nodejs-sandbox)
- The K8s Service translates :80 → container port internally — you never need to change your app's bind port
- Calls to the container port directly (e.g. :8000) will time out — always use :80 in peer URLs

**Correct pattern for a Flask service that also accepts peer traffic:**
\`\`\`python
# app.py — bind to 8000 (public ingress hits this port directly on the pod)
app.run(host="0.0.0.0", port=8000)
\`\`\`
\`\`\`bash
# nexus-start.sh — set peer URL using :80 (K8s Service port)
export PEER_URL="http://svc-<other-instance-id>:80"
exec python3 app.py
\`\`\`

**To verify internal reachability from within a pod** (nexus_fetch cannot do this — it uses the public URL):
\`\`\`
nexus_execute_command  instance_id="..."  command="curl -s --max-time 5 http://svc-{targetId}:80/health"
\`\`\`

This is only routable from within pods in the same user namespace.

## Debugging Pod Failures

When a pod fails to start, \`nexus_get_logs\` automatically includes init container logs
(\`initLogs\` field) alongside the main container logs. Init containers handle permission fixes
and image setup — their logs often reveal the root cause of startup failures.

## Python Commands
- Use \`python3\` and \`pip3\` (not \`python\` / \`pip\`)
- Append \`--break-system-packages\` to pip3 installs (Ubuntu 24.04, PEP 668 compliance)

## Code PVC (250 MB)
Files written to /app persist across \`nexus_restart\` calls.
Mount path is \`/app\` for both python-sandbox and nodejs-sandbox.
Use \`nexus_list_files\` to inspect what is on disk, \`nexus_read_file\` to retrieve content.

## Instance Limits

The default limit is **5 concurrent instances**. This is a soft limit — it can be raised by
updating the \`max_instances\` field in the database for your dev user.

Check capacity before deploying:
\`\`\`
nexus_list_workloads → { count: 3, limit: 5, slotsRemaining: 2 }
\`\`\`

If the limit is reached, \`nexus_deploy\` returns an error with \`current\` and \`limit\` fields.
Self-recovery: call \`nexus_terminate\` on an existing workload, then retry \`nexus_deploy\`.

## Labelling Workloads

Always pass \`user_description\` to \`nexus_deploy\` unless the user has already specified a name.
The label appears in the user's dashboard — make it human-readable and purpose-specific.

Derive it from the task context if not given:
- Deploying a Flask API → \`"flask-api"\`
- Building a scraper → \`"web-scraper"\`
- Running a data pipeline → \`"data-pipeline"\`
- Testing a service → \`"service-prototype"\`

Avoid generic names like \`"test"\`, \`"sandbox"\`, or \`"workload-1"\`.

## Resource Usage
Workloads run on your local machine — no billing, but each sandbox consumes CPU and RAM.
Terminate workloads when they are no longer needed to free local resources.
Check how many slots are in use with \`nexus_list_workloads\` before bulk deploys.

## Error Handling
- \`INSTANCE_NOT_ACTIVE\`: pod is not running — call \`nexus_status\` or \`nexus_wait_for_ready\`
- \`POD_NOT_READY\`: pod is starting up — use \`nexus_wait_for_ready\` instead of retrying manually
- \`nexus_fetch\` timeout: pod may not have finished starting — call \`nexus_wait_for_ready\` first
- Connection refused on workload URL: check that \`*.localhost\` resolves on your OS (see README DNS section)
`;
