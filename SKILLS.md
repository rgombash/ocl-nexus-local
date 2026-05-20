# OCL Nexus Local — Agent Playbook

> Add this to your MCP config to give your agent the ability to deploy, code, and operate
> isolated compute environments on your local machine autonomously.

## MCP Configuration

### Claude Desktop
```json
{
  "mcpServers": {
    "ocl-nexus-local": {
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Claude Code
```json
{
  "mcpServers": {
    "ocl-nexus-local": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Get your API key from **Dashboard → API Keys**.

> **Running local and cloud side-by-side?** Use `ocl-nexus-local` and `ocl-nexus` as distinct
> keys in your MCP config to enable simultaneous access to both infrastructures.

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `nexus_list_blueprints` | List available environment types |
| `nexus_list_workloads` | Enumerate your running instances |
| `nexus_deploy` | Provision a new sandbox |
| `nexus_status` | Poll pod status (running / starting / error) |
| `nexus_wait_for_ready` | Block server-side until pod is ready (preferred over polling) |
| `nexus_execute_command` | Run a shell command inside a pod |
| `nexus_write_file` | Upload a single file to the 250 MB code PVC |
| `nexus_write_files` | Upload multiple files in one call (preferred for 2+ files) |
| `nexus_read_file` | Retrieve output files from the PVC |
| `nexus_list_files` | Inspect the workspace filesystem |
| `nexus_delete_file` | Remove files from the workspace |
| `nexus_get_logs` | Fetch container stdout/stderr |
| `nexus_restart` | Reboot the pod (activates nexus-start.sh) |
| `nexus_terminate` | Permanently destroy a workload |
| `nexus_fetch` | Make an authenticated HTTP request to a deployed service |

## Available Resources

| Resource URI | Content |
|---|---|
| `nexus://skills` | This playbook (machine-readable) |

---

## Workflow: Deploy → Code → Execute

```
1. nexus_list_blueprints   → pick a blueprint
2. nexus_deploy            → returns { instanceId, publicUrl, internalUrl }
3. nexus_wait_for_ready    → blocks until isReady === true (single call, no loop)
4. nexus_write_files       → upload all code files in one call
5. nexus_execute_command   → run scripts, install packages
6. nexus_read_file         → retrieve results
7. nexus_terminate         → clean up when done
```

---

## Service Mode (Nexus Entrypoint Pattern)

To run a persistent service (Flask, FastAPI, Express…) accessible via HTTP:

```
1. nexus_deploy            → provision sandbox (idle mode)
2. nexus_wait_for_ready    → wait until pod is ready
3. nexus_write_files       → upload app code + nexus-start.sh in one call
4. nexus_restart           → pod reboots, executes nexus-start.sh
5. nexus_wait_for_ready    → wait until service is ready
6. nexus_fetch path="/health" → verify service is responding
7. Service is live at http://inst-{shortId}.localhost
```

### nexus-start.sh — Python / Flask
```bash
#!/bin/bash
set -e
pip3 install flask --break-system-packages --quiet
exec python3 app.py
```

### nexus-start.sh — Node.js / Express
```bash
#!/bin/bash
set -e
npm install express
exec node app.js
```

### nexus-start.sh — FastAPI with uvicorn
```bash
#!/bin/bash
set -e
pip3 install fastapi uvicorn --break-system-packages --quiet
exec uvicorn app:app --host 0.0.0.0 --port 8000
```

---

## Multi-Agent Mesh (Internal URLs)

Instances in the same cluster can communicate directly. Use the `internalUrl` from
`nexus_deploy`, `nexus_status`, or `nexus_wait_for_ready`:

```
http://svc-{shortId}:80
```

**Port rule:** `internalUrl` is always `:80` (K8s Service port). Apps still bind to their
container port (8000 / 3000). The Service translates `:80 → container port` internally.

---

## Python Notes
- Use `python3` and `pip3` (not `python` / `pip`)
- Append `--break-system-packages` to all `pip3 install` calls (Ubuntu 24.04, PEP 668)

## Node.js Notes
- Use `node`, `npm`, `pnpm` (all available)

---

## Local Mode Notes
- **No billing** — workloads run on your machine, no credits consumed
- `publicUrl` uses HTTP, not HTTPS: `http://inst-{id}.localhost`
- DNS for `*.localhost` works natively on Linux (systemd-resolved ≥247) and WSL2.
  On macOS, use `INFRA_DOMAIN=localtest.me` or install dnsmasq. See README.

---

## Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `Instance is not active` | Pod is not in Running state | Call `nexus_wait_for_ready` |
| `Pod not found or not running` | Pod is starting / crashed | Check `nexus_get_logs` |
| `Access denied to instance` | Wrong API key | Use the key that owns this instance |
| `Blueprint does not support code persistence` | `nexus_write_file` on hello-world | Use python-sandbox or nodejs-sandbox |
| Connection refused on workload URL | `*.localhost` not resolving | See README DNS section |
