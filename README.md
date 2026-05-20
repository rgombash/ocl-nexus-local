# OCL Nexus Local

OCL Nexus Local is an open-source compute fabric that provides a frictionless, local-first environment for agentic development. Built on a single-node K3s architecture via Docker Compose, it allows developers to provision isolated Ubuntu sandboxes with native Model Context Protocol (MCP) support directly on their own hardware. Designed for 100% parity with the OCL Nexus cloud platform, it enables AI agents to autonomously manage the full lifecycle of micro-workloads—from code shipment and dependency scaling to real-time service orchestration—without the complexity of manual infrastructure management.

> For live internet workloads requiring 24/7 availability and high-performance compute on dedicated EU-based NVMe infrastructure, visit [oclnexus.com](https://oclnexus.com).

## Prerequisites

- **Docker Desktop** or Docker Engine + Docker Compose
- **8 GB+ RAM** (allocate in Docker Desktop → Settings → Resources)
- **10 GB disk space**
- **macOS, Linux, or Windows** (WSL2 required on Windows)

## Quick Start

### 1. Generate an encryption key

The key must be **exactly 32 ASCII characters** (used as raw AES-256-GCM key bytes):

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(24)[:32])"
# or
openssl rand -base64 24 | head -c 32
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and set your generated key:

```env
ENCRYPTION_KEY=your-generated-32-char-key-here
```

### 3. Start the stack

```bash
docker compose up -d
```

**First-time startup takes 3–5 minutes** — K3s must pull system images (CoreDNS, Traefik, metrics-server) and initialise the cluster. Subsequent starts take ~30 seconds.

### 4. Retrieve your API key

```bash
docker compose logs nexus-init | grep -A 5 "nx_"
```

Copy the `nx_...` key — it is shown only once and is required for MCP and REST API access.

### 5. Open the dashboard

**http://localhost:3000/dashboard** — no login required.

---

## Workload DNS

Deployed workloads are served at `http://inst-{id}.{INFRA_DOMAIN}`. The default `INFRA_DOMAIN` is `localhost`.

| Platform | `*.localhost` resolves? | What to do |
|----------|------------------------|------------|
| Linux (Ubuntu 20.10+, Debian 11+, Fedora 33+) | Yes — systemd-resolved | Nothing |
| Linux (older) | No | See Option B below |
| macOS | No | See Option B below |
| Windows WSL2 | Yes — inherits Linux resolver | Nothing |
| Windows native | No | Use Option A below |

### Option A — Zero config, needs internet: `localtest.me`

`*.localtest.me` is a public DNS service that resolves every subdomain to `127.0.0.1`.

In `.env.local` (or `docker-compose.yml`):
```env
INFRA_DOMAIN=localtest.me
```

Workloads become accessible at `http://inst-{id}.localtest.me`.

### Option B — Offline: configure wildcard DNS for `*.localhost`

**macOS** (one-time, 3 commands):
```bash
brew install dnsmasq
echo "address=/.localhost/127.0.0.1" >> $(brew --prefix)/etc/dnsmasq.conf
brew services start dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost
```

**Linux (older, no systemd-resolved):**
```bash
sudo apt install dnsmasq
echo "address=/.localhost/127.0.0.1" | sudo tee /etc/dnsmasq.d/localhost-wildcard.conf
sudo systemctl restart dnsmasq
```

Keep `INFRA_DOMAIN=localhost` (the default) after either step.

---

## MCP Integration (Claude Desktop)

Edit your Claude Desktop config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

Replace `nx_YOUR_KEY_HERE` with the key from step 4 and restart Claude Desktop.

**Verify the connection:**
```bash
curl -X POST http://localhost:3000/api/mcp/v1 \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer nx_YOUR_KEY_HERE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep '^data:' | sed 's/^data: //' | python3 -m json.tool
```

You should see 15 MCP tools listed (`nexus_deploy`, `nexus_list_workloads`, `nexus_execute_command`, etc.).

> The `Accept: application/json, text/event-stream` header is required. Omitting it returns a 406 Not Acceptable error.

---

## What's Running

| Service | URL | Purpose |
|---------|-----|---------|
| Dashboard | http://localhost:3000/dashboard | Deploy and manage workloads |
| MCP API | http://localhost:3000/api/mcp/v1 | Claude Desktop / agent integration |
| REST API | http://localhost:3000/api/v1/ | Machine-to-machine workload control |
| K3s API | https://localhost:6443 | Kubernetes control plane |
| pgweb | http://localhost:8082 | PostgreSQL web UI |
| Workloads | http://inst-{id}.localhost | Deployed sandboxes |

---

## Developer Mode (Hot Reload)

For iterating on the platform itself, a dev compose override mounts the source tree live and runs `npm run dev` instead of the pre-built production server:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

File changes in `src/` are reflected in the browser within ~1 second. No container restart needed.

If you add or remove npm packages, rebuild the image to re-run `npm ci`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build nexus-app
```

---

## Common Commands

```bash
# Status
docker compose ps

# Logs
docker compose logs -f nexus-app
docker compose logs nexus-k3s

# Stop (keeps data)
docker compose down

# Stop and delete all data
docker compose down -v

# Inspect the K3s cluster
docker compose exec nexus-k3s k3s kubectl get pods -A
docker compose exec nexus-k3s k3s kubectl get ingress -A
```

---

## Advanced

### Access the Kubernetes cluster from the host

```bash
docker compose exec nexus-k3s cat /shared/k3s/kubeconfig > kubeconfig.local
export KUBECONFIG=./kubeconfig.local
kubectl get nodes
kubectl get pods -A
```

### Database access

```bash
# psql CLI
docker compose exec nexus-db psql -U nexus -d nexus

# pgweb UI
open http://localhost:8082
```

### Backup and restore

```bash
# Backup
docker compose exec nexus-db pg_dump -U nexus nexus > backup.sql

# Restore
docker compose exec -T nexus-db psql -U nexus nexus < backup.sql
```

---

## Troubleshooting

### Port conflict (3000, 80, or 443 already in use)

Edit `docker-compose.yml` and change the host-side port:
```yaml
ports:
  - "3001:3000"   # dashboard now at http://localhost:3001/dashboard
```

### K3s won't start / keeps restarting

1. Increase Docker memory to **8 GB minimum** (Docker Desktop → Settings → Resources).
2. Force-recreate the container: `docker compose up -d --force-recreate nexus-k3s`

### Workload returns 404 immediately after deploy

Traefik may still be starting. Wait 30–60 seconds after K3s reports healthy, then retry. Traefik pulls its image (~130 MB) on first run.

### No API key in logs

Re-run the init container:
```bash
docker compose run --rm nexus-init
```

### Database connection error

Wait for `nexus-db` to reach the **healthy** state (not just "running"):
```bash
docker compose ps   # check STATUS column
docker compose restart nexus-db nexus-app
```

### Full reset (deletes all workload data)

```bash
docker compose down -v
docker compose up -d
docker compose logs nexus-init | grep "nx_"   # retrieve new API key
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Your Machine                         │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Docker Compose                                       │  │
│  │                                                       │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────┐   │  │
│  │  │ nexus-app  │  │ nexus-db   │  │   nexus-k3s    │   │  │
│  │  │ (Next.js)  │  │ (Postgres) │  │ K3s + Traefik  │   │  │
│  │  │ Port 3000  │  │ Port 5432  │  │  Port 80/443   │   │  │
│  │  └────────────┘  └────────────┘  └────────────────┘   │  │
│  │                                                       │  │
│  │  ┌────────────────────────────────────────────────┐   │  │
│  │  │  Volumes: nexus-db-data, nexus-k3s-data        │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Dashboard  → http://localhost:3000/dashboard               │
│  Workloads  → http://inst-{id}.localhost                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Related files

| File | Purpose |
|------|---------|
| `QUICKSTART.md` | Condensed setup reference |
| `DOCKER.md` | Advanced Docker configuration |
| `AGENTS.md` | Architecture and API reference for agents and contributors |
| `.env.local.example` | Annotated environment variable template |
| `docker-compose.dev.yml` | Dev mode override (hot reload) |

## Community

- **Discord:** [Join the #ocl-nexus-local channel](https://discord.gg/vukKe4XAbp)
- **Issues:** [GitHub Issues](https://github.com/your-org/ocl-nexus-local/issues) for bugs and feature requests
- **Security:** See [SECURITY.md](SECURITY.md) — please email rather than opening a public issue for vulnerabilities
- **Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the [LICENSE](LICENSE) file for details.
