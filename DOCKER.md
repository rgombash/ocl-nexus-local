# OCL Nexus Local — Docker Deployment

Run the entire OCL Nexus platform locally with a single command.

## Quick Start

### 1. Prerequisites
- Docker & Docker Compose installed
- 8GB+ RAM available
- Ports available: 3000 (app), 5432 (postgres), 6443 (k3s API), 80/443 (ingress)

### 2. Setup

```bash
# Generate encryption key
openssl rand -hex 32

# Copy environment file
cp .env.local.example .env.local

# Edit .env.local and add your encryption key
nano .env.local  # Replace ENCRYPTION_KEY with the generated value
```

### 3. Launch

```bash
docker compose up -d
```

**What happens:**
- PostgreSQL starts and schema is auto-applied (~5 seconds)
- K3s cluster spins up (~2-3 minutes on first start, ~30 seconds on restart)
- Nexus app builds and starts (~30 seconds)
- Init script creates dev user and API key
- Services become available

**⏱️ Patience Required:** K3s needs time to start all system pods (CoreDNS, metrics-server, local-path-provisioner). Wait for `docker compose ps` to show all services as healthy.

### 4. Access

**Dashboard:** http://localhost:3000/dashboard  
No login required in local mode — you're automatically authenticated as the dev user.

**API Key:** Check init logs for your MCP API key:
```bash
docker compose logs nexus-init
```

Copy the API key from the output and add it to Claude Desktop config.

### 5. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Replace `nx_YOUR_KEY_HERE` with the API key from step 4.

## Services

| Service | Port | Description |
|---------|------|-------------|
| `nexus-app` | 3000 | Next.js control plane |
| `nexus-db` | 5432 | PostgreSQL 16 |
| `nexus-k3s` | 6443, 80, 443 | K3s cluster + Traefik ingress |
| `nexus-init` | - | One-time initialization (exits after completion) |

## Management

### View Logs
```bash
docker compose logs -f nexus-app    # Application logs
docker compose logs -f nexus-k3s    # Kubernetes logs
docker compose logs nexus-init      # Init script output (includes API key)
```

### Restart Services
```bash
docker compose restart nexus-app    # Restart app only
docker compose restart              # Restart all services
```

### Stop Everything
```bash
docker compose down                 # Stop and remove containers
docker compose down -v              # Also remove volumes (DELETES DATA)
```

### Access K3s Cluster
```bash
# Get kubeconfig
docker compose exec nexus-k3s cat /shared/k3s/kubeconfig > kubeconfig.local

# Use kubectl
export KUBECONFIG=./kubeconfig.local
kubectl get nodes
kubectl get pods -A
```

### Re-run Initialization
```bash
# Safe to run multiple times (idempotent)
docker compose run --rm nexus-init
```

## Troubleshooting

### Port Conflicts
If ports 3000, 5432, 80, or 443 are already in use, edit `docker-compose.yml` and change the port mappings:

```yaml
ports:
  - "3001:3000"  # Change external port (3001) but keep internal (3000)
```

### K3s Not Starting
K3s requires privileged mode. Ensure Docker has necessary permissions:

```bash
docker compose logs nexus-k3s
```

If you see permission errors, try:
```bash
docker compose down
docker compose up -d --force-recreate nexus-k3s
```

### Database Connection Issues
Verify PostgreSQL is healthy:

```bash
docker compose ps
docker compose exec nexus-db psql -U nexus -d nexus -c "SELECT version();"
```

### App Not Starting
Check environment variables:

```bash
docker compose exec nexus-app env | grep -E "NEXUS_MODE|DATABASE_URL|ENCRYPTION_KEY"
```

Ensure `ENCRYPTION_KEY` is set in `.env.local` (not the default value).

### Reset Everything
**WARNING: This deletes all data**

```bash
docker compose down -v
docker compose up -d
```

## Development Mode

To run with hot reload (for development):

```bash
# Use native npm dev instead of Docker
npm install
npm run dev
```

The Docker setup is optimized for production-like testing, not active development.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│    │                                                         │
│    ├─→ http://localhost:3000/dashboard → nexus-app (Next.js)│
│    │                                                         │
│    └─→ http://inst-abc.localhost → nexus-k3s (Traefik)      │
│                                      │                       │
│                                      └─→ Pod in K3s cluster  │
└─────────────────────────────────────────────────────────────┘

Services:
- nexus-app:  Next.js control plane (TypeScript)
- nexus-db:   PostgreSQL 16 (persistent data)
- nexus-k3s:  K3s cluster with Traefik ingress
- nexus-init: One-time setup (dev user + API key)
```

## Environment Variables

See `.env.local.example` for full list. Critical variables:

- `NEXUS_MODE=local` — Enables local mode (required)
- `DATABASE_URL` — Auto-configured for Docker network
- `ENCRYPTION_KEY` — **Must be set** (32-byte hex)
- `KUBECONFIG_PATH` — Auto-configured for shared volume
- `INFRA_DOMAIN=localhost` — Uses .localhost subdomains

## Volumes

Data persists in Docker volumes:

- `nexus-db-data`: PostgreSQL database
- `nexus-k3s-data`: Kubernetes cluster state
- `shared-kubeconfig`: K3s kubeconfig (shared with app)

To backup:
```bash
docker run --rm -v nexus-db-data:/data -v $(pwd):/backup alpine tar czf /backup/nexus-db-backup.tar.gz -C /data .
```

## Security Notes

**Local mode disables authentication and billing checks.** This is intentional for single-user development.

- All requests treated as dev user (`LOCAL_DEV_USER_ID`)
- Balance checks bypassed (unlimited credits)
- No session cookies or login flow
- API keys still validated for MCP access

**Do not expose port 3000 to the internet** — local mode has no authentication.

## Next Steps

1. Deploy a workload from the dashboard
2. Test MCP tools in Claude Desktop
3. Experiment with different blueprints (python-sandbox, nodejs-sandbox)
4. Check K3s cluster: `kubectl get pods -A`

## Support

- Docs: `/docs` route in the app
- Issues: GitHub repository
- Logs: `docker compose logs -f`
