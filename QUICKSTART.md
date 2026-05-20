# 🚀 OCL Nexus Local — Quick Start with Docker

Get the entire OCL Nexus platform running in 60 seconds.

## What is OCL Nexus Local?

OCL Nexus is an **agentic workload platform** that lets you deploy isolated container environments for AI agents. Think "Heroku for AI agents" — but running entirely on your machine.

**Perfect for:**
- Running MCP tools in Claude Desktop
- Deploying Python/Node.js sandboxes for agents
- Testing agentic workflows locally
- Learning Kubernetes without cloud costs

## Prerequisites

- **Docker Desktop** (or Docker Engine + Docker Compose)
- **8GB+ RAM** (allocate to Docker Desktop)
- **10GB disk space**
- **macOS, Linux, or Windows** (with WSL2)

## Workload URL Access & DNS

Deployed workloads are accessed at `http://inst-{id}.localhost` (or `http://inst-{id}.localtest.me` — see below). Traefik runs inside K3s and routes these hostnames to the correct pod.

### DNS resolution by platform

| Platform | `*.localhost` resolves? | Action required |
|----------|------------------------|-----------------|
| **Linux (Ubuntu 20.10+, Debian 11+, Fedora 33+)** | Yes — systemd-resolved handles it natively | None |
| **Linux (older, no systemd-resolved)** | No | See option B below |
| **macOS (any version)** | No | See option B below |
| **Windows WSL2** | Yes — inherits Linux resolver | None |
| **Windows native** | No | Use option A below |

### Option A — Zero config: use `localtest.me` (all platforms, needs internet)

`*.localtest.me` is a public DNS service that resolves every subdomain to `127.0.0.1`. No local changes needed.

In `.env.local`, change:
```env
INFRA_DOMAIN=localtest.me
```

Workloads will be accessible at `http://inst-{id}.localtest.me`.

> This requires an internet connection to resolve DNS. The HTTP request itself goes to your local machine.

### Option B — Offline: configure wildcard DNS for `*.localhost`

**macOS** (3 commands, one-time):
```bash
brew install dnsmasq
echo "address=/.localhost/127.0.0.1" >> $(brew --prefix)/etc/dnsmasq.conf
brew services start dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost
```

**Linux (older, no systemd-resolved):**
```bash
sudo apt install dnsmasq        # or: yum install dnsmasq
echo "address=/.localhost/127.0.0.1" | sudo tee /etc/dnsmasq.d/localhost-wildcard.conf
sudo systemctl restart dnsmasq
```

After either step, keep `INFRA_DOMAIN=localhost` (the default) and workloads are accessible at `http://inst-{id}.localhost` — including offline.

## 5-Minute Setup

### 1. Generate Encryption Key

```bash
openssl rand -hex 32
```

Copy the output (you'll need it in the next step).

### 2. Configure Environment

```bash
cp .env.local.example .env.local
nano .env.local  # or use your favorite editor
```

**Replace this line:**
```env
ENCRYPTION_KEY=REPLACE_WITH_YOUR_32_BYTE_HEX_KEY
```

**With your generated key:**
```env
ENCRYPTION_KEY=a1b2c3d4e5f67890...  # paste your key here
```

Save and exit.

### 3. Launch Stack

```bash
docker compose up -d
```

**What happens:**
- PostgreSQL database starts (~5 seconds)
- K3s Kubernetes cluster spins up (~2-3 minutes on first start)
- Nexus app builds and starts (~30 seconds)
- Database schema is auto-applied
- Dev user and API key are created

**⏱️ First-time startup:** K3s takes 2-3 minutes to initialize all system pods (CoreDNS, Traefik, metrics-server, local-path-provisioner). Subsequent starts are faster (~30 seconds).

> **Traefik note:** Traefik is the ingress controller that routes `inst-*.localhost` traffic to workloads. It starts automatically with K3s but may need an extra 30-60 seconds after K3s reports healthy. If a freshly deployed workload returns a 404, wait a moment and retry.

### 4. Get Your API Key

```bash
docker compose logs nexus-init | grep -A 20 "NEW API KEY"
```

**Look for this output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✨ NEW API KEY GENERATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Copy this key — it will NOT be shown again:

    nx_a1b2c3d4e5f67890abcdef1234567890

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Copy the `nx_...` key** (you'll need it for Claude Desktop).

### 5. Open Dashboard

Visit: **http://localhost:3000/dashboard**

You should see the Nexus dashboard — no login required in local mode!

### 6. Configure Claude Desktop (Optional)

To use MCP tools, edit your Claude Desktop config:

**macOS:**
```bash
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Windows:**
```bash
notepad %APPDATA%\Claude\claude_desktop_config.json
```

**Add this configuration:**
```json
{
  "mcpServers": {
    "nexus": {
      "command": "curl",
      "args": [
        "-X", "POST",
        "http://localhost:3000/api/mcp/v1",
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json, text/event-stream",
        "-H", "Authorization: Bearer nx_YOUR_KEY_HERE",
        "-d", "@-"
      ]
    }
  }
}
```

**Replace `nx_YOUR_KEY_HERE`** with the API key from step 4.

Restart Claude Desktop, and you'll see the Nexus MCP tools available!

### 7. Test MCP Endpoint (Optional)

Verify the MCP endpoint is working:

```bash
curl -X POST http://localhost:3000/api/mcp/v1 \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer nx_YOUR_KEY_HERE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep '^data:' | sed 's/^data: //' | python3 -m json.tool
```

**Replace `nx_YOUR_KEY_HERE`** with your API key. You should see a JSON response listing 15 MCP tools (nexus_deploy, nexus_list_workloads, nexus_execute_command, etc.).

**Note:** The MCP HTTP streaming transport requires the `Accept: application/json, text/event-stream` header. Omitting it returns a "Not Acceptable" error.

## Usage

### Deploy Your First Workload

1. Go to http://localhost:3000/dashboard
2. Click **"Deploy New Workload"**
3. Choose **"Python Sandbox"** or **"Node.js Sandbox"**
4. Click **"Deploy"**
5. Wait ~15 seconds for the workload to start
6. Access it at `http://inst-{id}.localhost` (Linux/WSL2) or `http://inst-{id}.localtest.me` (macOS/Windows — see DNS section above)

### Use MCP Tools in Claude

After configuring Claude Desktop (step 6 above), you can:

```
You: "Deploy a Python sandbox for me"

Claude: [Uses nexus_deploy tool]
        ✓ Deployed instance inst-abc123
        Access at: http://inst-abc123.localhost

You: "Upload a Python script that prints 'Hello World'"

Claude: [Uses nexus_write_file tool]
        ✓ Wrote /app/hello.py

You: "Run it"

Claude: [Uses nexus_execute_command tool]
        Output: Hello World
```

### Check Status

```bash
docker compose ps                    # View running services
docker compose logs -f nexus-app     # Stream app logs
docker compose logs nexus-k3s        # View K3s logs
```

### Stop Everything

```bash
docker compose down      # Stop containers
docker compose down -v   # Stop and DELETE all data
```

## Troubleshooting

### Port Conflicts

If port 3000, 80, or 443 is already in use:

```bash
# Edit docker-compose.yml
nano docker-compose.yml

# Change port mappings (example for port 3000):
ports:
  - "3001:3000"  # Change 3000 to 3001 (or any available port)
```

Then access dashboard at http://localhost:3001/dashboard

### K3s Won't Start

**Symptom:** `nexus-k3s` container keeps restarting

**Fix 1:** Check Docker memory allocation
- Docker Desktop → Settings → Resources
- Set memory to **8GB minimum**

**Fix 2:** Recreate K3s container
```bash
docker compose down
docker compose up -d --force-recreate nexus-k3s
```

### "No API Key Found"

**If init script didn't create key:**
```bash
docker compose run --rm nexus-init
```

This will generate a new key and print it.

### App Shows "Database Connection Error"

**Wait for database:**
```bash
docker compose ps
```

Ensure `nexus-db` is **healthy** (not just "running").

**Force restart:**
```bash
docker compose restart nexus-db
docker compose restart nexus-app
```

### Reset Everything

**WARNING: Deletes all data**
```bash
docker compose down -v
docker compose up -d
docker compose logs nexus-init | grep "nx_"  # Get new API key
```

## What's Running?

| Service | URL | Purpose |
|---------|-----|---------|
| Dashboard | http://localhost:3000/dashboard | Manage workloads |
| MCP API | http://localhost:3000/api/mcp/v1 | Claude Desktop integration |
| K3s API | https://localhost:6443 | Kubernetes control plane |
| Workloads | http://inst-{id}.localhost (or `.localtest.me`) | Your deployed containers |

## Next Steps

1. **Deploy workloads** from the dashboard
2. **Try MCP tools** in Claude Desktop
3. **Explore blueprints:** python-sandbox, nodejs-sandbox, hello-world
4. **Read docs:** http://localhost:3000/docs
5. **Check K3s:** `docker compose exec nexus-k3s k3s kubectl get pods -A`

## Advanced Usage

### Access Kubernetes Cluster

```bash
# Export kubeconfig
docker compose exec nexus-k3s cat /shared/k3s/kubeconfig > kubeconfig.local

# Use kubectl
export KUBECONFIG=./kubeconfig.local
kubectl get nodes
kubectl get pods -A
kubectl get ingressroutes -A
```

### View Database

```bash
docker compose exec nexus-db psql -U nexus -d nexus

# Inside psql:
\dt                           # List tables
SELECT * FROM instances;      # View instances
SELECT * FROM users;          # View users
\q                            # Exit
```

### Backup Data

```bash
# Backup database
docker compose exec nexus-db pg_dump -U nexus nexus > backup.sql

# Restore
docker compose exec -T nexus-db psql -U nexus nexus < backup.sql
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Your Machine                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Docker Compose                                        │ │
│  │                                                        │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │ │
│  │  │  nexus-app  │  │  nexus-db   │  │  nexus-k3s   │ │ │
│  │  │  (Next.js)  │  │ (Postgres)  │  │ K3s+Traefik  │ │ │
│  │  │  Port 3000  │  │  Port 5432  │  │ Port 80/443  │ │ │
│  │  └─────────────┘  └─────────────┘  └──────────────┘ │ │
│  │                                                        │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Volumes: nexus-db-data, nexus-k3s-data          │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Access:                                                     │
│    - Dashboard: http://localhost:3000/dashboard              │
│    - Workloads: http://inst-{id}.localhost                   │
└──────────────────────────────────────────────────────────────┘
```

## Getting Help

- **Full Docker guide:** See `DOCKER.md`
- **Phase documentation:** See `documentation/NEXUS_LOCAL_PHASE*.md`
- **Logs:** `docker compose logs -f`
- **Status:** `docker compose ps`

## What Makes This Different?

Unlike traditional PaaS solutions:
- ✅ **100% local** — no cloud account required
- ✅ **MCP native** — built for AI agent workflows
- ✅ **Kubernetes-powered** — production-grade isolation
- ✅ **Zero config** — works out of the box
- ✅ **Open source** — inspect, modify, contribute

---

**Ready to deploy?** Run `docker compose up -d` 🚀
