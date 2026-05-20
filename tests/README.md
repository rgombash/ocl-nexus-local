# OCL Nexus Local — Integration Tests

All tests run against a live local stack (`docker compose up -d`).

## Setup

1. **Start the stack** (if not already running):
   ```bash
   docker compose up -d
   ```

2. **Copy the environment template:**
   ```bash
   cp tests/.env.test.example tests/.env.test
   ```

3. **Configure your test environment:**
   Edit `tests/.env.test`:
   ```env
   NEXUS_API_KEY=nx_...          # from: docker compose logs nexus-init | grep "nx_"
   NEXUS_BASE_URL=http://localhost:3000
   INFRA_DOMAIN=localhost         # or localtest.me on macOS/Windows
   ```

4. **Install dependencies** (if not done already):
   ```bash
   npm install
   ```

## Tests

### `npm run test:api` — M2M Lifecycle
Full workload lifecycle over the REST API.

**Steps:** Deploy → Poll readiness → Upload file → Execute command → Verify output → Delete

**Covers:**
- `GET /api/v1/test` — auth validation (401 on invalid key)
- `POST /api/v1/workloads` — deploy
- `GET /api/v1/workloads/[id]/status` — status polling
- `POST /api/v1/workloads/[id]/files` — file upload to code PVC
- `POST /api/v1/workloads/[id]/execute` — remote command execution
- `DELETE /api/v1/workloads/[id]` — cleanup

---

### `npm run test:python` — Python Flask Service Mode
Deploys a Python sandbox and activates a Flask service via the Nexus Entrypoint convention.

**Steps:** Deploy → Poll readiness → Upload `app.py` → Upload `nexus-start.sh` → Restart → Poll readiness → Verify `/health` via public URL → Delete

**Covers:**
- Service mode activation (`nexus-start.sh` detected by entrypoint, runs as PID 1)
- Flask app on port 8000 responding to HTTP requests
- Public URL access with Bearer token (bouncer auth)

---

### `npm run test:node` — Node.js Express Service Mode
Deploys a Node.js sandbox and activates an Express service via the Nexus Entrypoint convention.

**Steps:** Deploy → Poll readiness → Upload `app.js` → Upload `nexus-start.sh` → Restart → Poll readiness → Verify `/health` via public URL → Delete

**Covers:**
- Service mode activation for Node.js runtime
- Express app on port 3000 responding to HTTP requests
- Validates `{ status: "online", runtime: "node" }` response

---

### `npm run test:discovery` — Blueprint Discovery
Validates the blueprint list API.

**Covers:**
- `GET /api/v1/blueprints` returns all stable blueprints
- Each blueprint includes required fields (`id`, `port`, `runtimeInfo`, etc.)

---

### `npm run test:ui` — UI Lifecycle (Session-based)
Exercises the UI API path (`/api/instances/*`) rather than the M2M path.

**Steps:** Auth bypass (local dev user) → Deploy via UI API → Poll status → Restart → Delete → Verify 404

**Covers:**
- `POST /api/instances/deploy`
- `GET /api/instances/[id]/status`
- `POST /api/instances/[id]/restart`
- `DELETE /api/instances/[id]`

In local mode the dev user is automatically authenticated — no Supabase credentials needed.

---

## Options

### Preserve instances for inspection

Add to `tests/.env.test`:
```env
SKIP_CLEANUP=true
```

The test will print the instance ID and a curl command to delete it manually when you're done.

### Run against a different blueprint

```env
TEST_BLUEPRINT_ID=nodejs-sandbox
```

---

## Troubleshooting

### "Configuration file not found"
Copy `.env.test.example` to `.env.test`.

### "Authentication failed" / 401
Check your API key (format: `nx_...`). Retrieve it with:
```bash
docker compose logs nexus-init | grep "nx_"
```

### "Instance did not reach running state"
- Check K3s is healthy: `docker compose exec nexus-k3s k3s kubectl get pods -A`
- Check app logs: `docker compose logs nexus-app`
- The stack may still be starting — wait 30–60 s after K3s reports healthy

### "Service verification failed" (python/node tests)
The service container takes a moment to install dependencies and start. The test retries 12 times at 5 s intervals. If it still fails:
- Check `INFRA_DOMAIN` matches your local DNS setup
- On macOS, use `INFRA_DOMAIN=localtest.me`
- Check instance logs in the Dashboard Cockpit

### "fetch failed" on public URL
`*.localhost` requires systemd-resolved ≥247 (Linux) or dnsmasq/localtest.me (macOS/Windows). See the DNS section in `README.md`.

---

## Security

`tests/.env.test` is gitignored — never commit it. It contains your API key. Only `.env.test.example` is committed.
