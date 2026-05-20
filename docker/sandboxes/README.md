# OCL Nexus Sandbox Images

This directory contains Dockerfiles for developer-ready sandbox environments used by OCL Nexus blueprints.

## Images

### Python Sandbox (`python.Dockerfile`)
**Registry:** `ghcr.io/rgombash/ocl-python-sandbox:latest`

**Features:**
- Ubuntu 24.04 base
- Python 3.12 with pip and venv
- Homebrew pre-installed at `/home/linuxbrew/.linuxbrew`
- Build tools (gcc, g++, make)
- Non-root user `node` (UID 1000)
- WORKDIR `/app` (matches Code PVC mount)
- **Nexus Entrypoint:** Executes `/app/nexus-start.sh` if present, else idle mode

**Use Cases:**
- Data science and ML workloads
- Python scripting and automation
- Agent-driven code execution via Developer API

### Node.js Sandbox (`nodejs.Dockerfile`)
**Registry:** `ghcr.io/rgombash/ocl-nodejs-sandbox:latest`

**Features:**
- Ubuntu 24.04 base
- Node.js 20.x with npm and pnpm
- Homebrew pre-installed at `/home/linuxbrew/.linuxbrew`
- Build tools (gcc, g++, make)
- Non-root user `node` (UID 1000)
- WORKDIR `/app` (matches Code PVC mount)
- **Nexus Entrypoint:** Executes `/app/nexus-start.sh` if present, else idle mode

**Use Cases:**
- Serverless function development
- REST API prototyping
- TypeScript/JavaScript automation
- Agent-driven code execution via Developer API

## Building Images

### Automated (GitHub Actions)
Images are automatically built and pushed to GHCR when:
- **Manual trigger:** Go to Actions → Select workflow → Run workflow
- **Auto trigger:** Push changes to `docker/sandboxes/*.Dockerfile` or workflow files

### Manual Build
```bash
# Python sandbox
docker build -f docker/sandboxes/python.Dockerfile -t ocl-python-sandbox .
docker run -it ocl-python-sandbox /bin/bash

# Node.js sandbox
docker build -f docker/sandboxes/nodejs.Dockerfile -t ocl-nodejs-sandbox .
docker run -it ocl-nodejs-sandbox /bin/bash
```

## OCL Nexus Integration

Both images are designed for the Developer API (`/api/v1/workloads/[id]/*`):

1. **File Shipment:** Upload code via `POST /files`
2. **Execution:** Run commands via `POST /execute`
3. **Persistence:** Code stored in 250Mi NVMe-backed Code PVC
4. **Permissions:** Init container runs `chown -R 1000:1000 /app`
5. **Homebrew:** Agents can install tools at runtime (`brew install jq`)

## Nexus Entrypoint Pattern

Both sandbox images include a **standardized bootloader** at `/usr/local/bin/nexus-entrypoint.sh`:

### How It Works

1. **Container starts** → Entrypoint looks for `/app/nexus-start.sh`
2. **If found** → Makes it executable and runs it (e.g., start Flask/Express)
3. **If not found** → Enters idle mode (`tail -f /dev/null`) for API-driven execution

### Usage Example

**Python Flask Server:**
```bash
# Upload start script via Developer API
POST /api/v1/workloads/{id}/files
{
  "path": "nexus-start.sh",
  "content": "#!/bin/bash\npip install flask\npython server.py",
  "encoding": "utf8"
}

# Restart instance (K8s recreates pod, entrypoint executes script)
PATCH /api/instances/{id}/restart
```

**Node.js Express Server:**
```bash
POST /api/v1/workloads/{id}/files
{
  "path": "nexus-start.sh",
  "content": "#!/bin/bash\npnpm install\nnode server.js",
  "encoding": "utf8"
}
```

### Benefits

- **Flexible:** Supports long-running services (Flask, Express, WebSocket servers)
- **Backward-compatible:** Without `nexus-start.sh`, behaves like before (idle mode)
- **PID 1 correct:** Uses `exec` to replace shell process, ensuring clean signal handling
- **Logged:** stdout/stderr from start script visible in pod logs

## Container Lifecycle

### Default Mode (No Start Script)
1. Pod starts with Nexus Entrypoint
2. No `/app/nexus-start.sh` found → Idle mode
3. Init container fixes `/app` permissions
4. Code PVC mounted at `/app`
5. Agent uploads files via API
6. Agent executes commands via API
7. Results streamed back via stdout/stderr

### Service Mode (With Start Script)
1. Agent uploads code + `nexus-start.sh` via API
2. Agent triggers restart (K8s recreates pod)
3. Nexus Entrypoint finds `/app/nexus-start.sh`
4. Entrypoint executes start script (e.g., `flask run --host=0.0.0.0`)
5. Service runs in foreground (stdout → pod logs)
6. Agent can still use `/execute` API for runtime commands

## Testing Images

```bash
# Test Python sandbox
curl -X POST https://oclhosting.com/api/v1/workloads/{id}/files \
  -H "Authorization: Bearer nx_..." \
  -d '{"path":"test.py","content":"print(\"hello\")","encoding":"utf8"}'

curl -X POST https://oclhosting.com/api/v1/workloads/{id}/execute \
  -H "Authorization: Bearer nx_..." \
  -d '{"command":"python test.py"}'

# Test Node.js sandbox
curl -X POST https://oclhosting.com/api/v1/workloads/{id}/files \
  -H "Authorization: Bearer nx_..." \
  -d '{"path":"test.js","content":"console.log(\"hello\")","encoding":"utf8"}'

curl -X POST https://oclhosting.com/api/v1/workloads/{id}/execute \
  -H "Authorization: Bearer nx_..." \
  -d '{"command":"node test.js"}'
```

## Security

- **Non-root:** All processes run as UID 1000
- **Isolated:** Each instance gets dedicated namespace + PVC
- **Sandboxed:** No access to host filesystem or other instances
- **Rate-limited:** API key authentication + balance checks
- **Audited:** All file uploads and executions logged

## Maintenance

To update images:
1. Edit `docker/sandboxes/*.Dockerfile`
2. Commit and push to `main`
3. Workflows auto-trigger and build new images
4. OCL Nexus pulls `:latest` tag on next deploy
5. No code changes needed (blueprints already reference GHCR)
