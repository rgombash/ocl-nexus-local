# AGENTS.md — OCL Nexus Local

## Overview

OCL Nexus Local is a **single-user, local-first agentic compute platform** that runs on Docker Compose + single-node K3s. It provisions isolated workload instances (sandboxes, assistants) on your local machine, each reachable at `http://inst-{id}.localhost` (or `.localtest.me` on macOS). The platform exposes a full MCP server and REST API so AI agents can deploy, manage, and interact with workloads programmatically.

This is a fork of the OCL Nexus cloud SaaS, cleaned up for local use. **All billing, auth, and cloud integrations are removed.** Every request is treated as the single dev user.

**NEXUS_MODE=local** is the only supported mode. Cloud mode code still exists in some places (K8s dual-path logic) but is never executed.

## Stack

- **Framework:** Next.js 14.2 (App Router), TypeScript, TailwindCSS
- **Database:** Local PostgreSQL via `postgres` npm package (Supabase-compatible API via `src/lib/db/local-client.ts`)
- **Infrastructure:** K3s (single-node, built into Docker Compose), Traefik ingress (K3s built-in)
- **Auth:** None — all requests auto-authenticated as `LOCAL_DEV_USER_ID`
- **Runtime:** Node.js throughout (no Edge runtime — postgres package requires Node)

## Build & Run

```bash
# Production (Docker Compose — recommended)
docker compose up -d
# Dashboard: http://localhost:3000/dashboard  MCP: http://localhost:3000/api/mcp/v1

# Dev mode (hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Local npm dev (requires separate PostgreSQL + kubeconfig)
npm install && npm run dev

# Tests
npm run test:api        # M2M lifecycle
npm run test:python     # Flask service
npm run test:node       # Express service
npm run test:discovery  # Blueprint discovery
```

## Local Mode Architecture

### Auth & Authorization

- `src/lib/auth/dev-user.ts` — `isLocalMode()`, `getDevUser()`
- `src/middleware.ts` — Local bypass at top: redirects `/` and `/login` → `/dashboard`, skips all Supabase auth, accepts any well-formed `nx_` Bearer token for `/api/v1/*`
- `src/lib/auth/authorization.ts` — `isAuthorized()` always returns `true` in local mode (billing bypassed)
- `src/lib/supabase-admin.ts` — Exports `localDb` (local PostgreSQL) instead of Supabase service client when `NEXUS_MODE=local`
- `src/lib/supabase-server.ts` — `createSupabaseServerClient()` returns a **mock client** in local mode: `auth.getUser()` returns the dev user, `.from(table)` delegates to `localDb`. This means all UI route handlers that call `supabase.auth.getUser()` work transparently in local mode without any code changes — no explicit bypass needed.

### Database

- `src/lib/db/local-client.ts` — PostgreSQL query builder with Supabase-compatible API: `.select()`, `.insert()`, `.update()`, `.delete()`, `.eq()`, `.single()`, `.maybeSingle()`, `.order()`, `.limit()`, `.range(from, to)` (LIMIT/OFFSET + separate COUNT), `.in()`, `.head()` etc.
- Cast: `localDb as unknown as ReturnType<typeof createClient>` — type assertion for API compatibility
- `.range(from, to)` runs a separate `SELECT COUNT(*)` when `countMode=true` — required for paginated UIs like Activity Logs

### K8s Client

- `src/lib/nexus/client.ts` — `getLocalNode()` returns mock node record (never hits DB), `getLocalKubeconfig()` reads from `KUBECONFIG_PATH` file
- `getNodeKubeconfig(node)` — in local mode ignores the node object and reads from file; in cloud mode decrypts from DB. **Never call `decrypt()` on local kubeconfigs.**

### Ingress

- Local mode: standard `networking.k8s.io/v1 Ingress` per instance — no ForwardAuth, no Traefik CRDs
- Cloud mode: Traefik `IngressRoute` + `Middleware` CRDs — never runs in local mode
- `ops/deploy.ts` — creates standard Ingress in local branch
- `ops/delete.ts` — `safeDelete` for both standard Ingress and Traefik CRDs (whichever doesn't exist 404s silently)

### DNS

- `*.localhost` resolves natively on Linux (systemd-resolved ≥247)
- macOS/Windows: use `INFRA_DOMAIN=localtest.me` (public wildcard DNS → 127.0.0.1, requires internet) or dnsmasq
- No DNS API calls anywhere — cloudflare.ts has been deleted

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/auth/dev-user.ts` | `isLocalMode()`, `getDevUser()` |
| `src/lib/auth/authorization.ts` | `isAuthorized()` — always true locally |
| `src/lib/auth/api-auth.ts` | M2M API key validation (SHA-256 hash lookup) |
| `src/lib/db/local-client.ts` | PostgreSQL query builder (Supabase-compatible) |
| `src/lib/nexus/client.ts` | `getLocalNode()`, `getLocalKubeconfig()` |
| `src/lib/nexus/blueprints.ts` | Blueprint registry — DO NOT TOUCH |
| `src/lib/nexus/ops/deploy.ts` | Deploy workload: K8s Deployment + Service + Ingress |
| `src/lib/nexus/ops/delete.ts` | Delete workload: K8s cleanup + DB row |
| `src/lib/nexus/ops/restart.ts` | Scale 0→1 |
| `src/lib/nexus/ops/status.ts` | Pod status + readiness |
| `src/lib/nexus/ops/logs.ts` | Pod log streaming |
| `src/lib/nexus/ops/execute.ts` | Shell command in pod |
| `src/lib/nexus/ops/files.ts` | Read/write/list/delete files on code PVC |
| `src/lib/nexus/ops/config-set.ts` | Attach/detach config set on running instance |
| `src/lib/nexus/mcp/` | MCP server, tools, resources, skills |
| `src/lib/k8s/exec-utils.ts` | Low-level pod exec (websocket) — DO NOT TOUCH |
| `src/lib/k8s/sync-secrets.ts` | Sync config set → K8s Secret |
| `src/lib/encryption.ts` | AES-256-GCM encrypt/decrypt — DO NOT TOUCH |
| `src/lib/config/nexus.ts` | `INFRA_DOMAIN`, `getUserNamespace()` |
| `src/lib/flags.ts` | `hasFlag()` — JSONB flag helper |
| `src/lib/audit.ts` | `logAction()` — all state changes must be audited |
| `src/middleware.ts` | Local bypass + M2M Bearer token validation |
| `src/app/api/mcp/v1/route.ts` | MCP endpoint — DO NOT TOUCH |
| `src/app/api/v1/` | M2M REST API — DO NOT TOUCH |
| `src/app/api/instances/` | UI API adapters (thin wrappers over ops/) |
| `src/app/api/k3s/status/route.ts` | K3s node health check |
| `src/app/api/verify-ingress/route.ts` | Traefik ForwardAuth bouncer (cloud: full auth; local: instance-exists check) |
| `src/app/dashboard/page.tsx` | Dashboard — compute `publicUrl` server-side |
| `src/app/dashboard/sidebar.tsx` | Nav: Instances, Env Vars, API Keys, Logs, Health, Docs |
| `src/app/dashboard/system/health/` | Cluster Health + zombie pruner |
| `src/app/dashboard/system/logs/` | Activity Logs viewer |
| `src/app/dashboard/settings/keys/` | API key management |
| `src/app/dashboard/configs/` | Config Vault UI |
| `docker-compose.yml` | Production stack |
| `docker-compose.dev.yml` | Dev override (hot reload) |
| `schema-local.sql` | Local PostgreSQL schema |

## Environment Variables

```bash
NEXUS_MODE=local
NEXT_PUBLIC_NEXUS_MODE=local
DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus
KUBECONFIG_PATH=/shared/k3s/kubeconfig          # Docker: /shared/k3s/kubeconfig; bare: ~/.kube/config
LOCAL_DEV_USER_ID=00000000-0000-0000-0000-000000000000
ENCRYPTION_KEY=<exactly-32-ASCII-chars>          # NOT hex — raw UTF-8, AES-256-GCM
INFRA_DOMAIN=localhost                           # or localtest.me for macOS/Windows
```

See `.env.local.example` for full list with comments.

## Docker Compose Services

| Service | Purpose |
|---------|---------|
| `nexus-app` | Next.js application |
| `nexus-db` | PostgreSQL 16 |
| `nexus-k3s` | K3s single-node cluster + Traefik ingress |
| `nexus-node-cleaner` | One-shot: deletes stale NotReady K3s nodes on every stack start |
| `nexus-init` | One-shot: applies schema + migrations, generates default API key |

K3s node is pinned to name `nexus-k3s` via `hostname: nexus-k3s` + `--node-name=nexus-k3s` to prevent ghost node accumulation across Docker restarts.

**Dev mode:** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` — bind-mounts `./src`, runs `npm run dev`, anonymous volumes keep `node_modules` + `.next` intact. Dockerfile has two stages: `deps` (npm ci only) and `builder` (full build). Dev override targets `deps` to skip the build step.

## Architecture

Routes are **thin adapters**. All K8s logic lives in `src/lib/nexus/ops/`. UI routes (`/api/instances/*`) and M2M routes (`/api/v1/workloads/*`) call the same ops functions — only auth differs.

| Area | Entry Points |
|------|-------------|
| Deploy / Delete / Restart | `src/lib/nexus/ops/deploy.ts`, `delete.ts`, `restart.ts`. UI: `api/instances/`. M2M: `api/v1/workloads/`. **Exception:** `api/instances/[id]/redeploy/` is openclaw-specific, no shared op. |
| Status / Readiness | `src/lib/nexus/ops/status.ts` → `api/instances/[id]/status/`, `api/v1/workloads/[id]/status/` |
| Files & Execution | `src/lib/nexus/ops/files.ts`, `execute.ts` → `api/v1/workloads/[id]/files/`, `execute/` |
| Observability | `api/instances/[id]/logs/`, `[id]/shell/`, `src/app/dashboard/cockpit-modal.tsx` |
| Config Vault | `api/config-sets/`, `src/lib/k8s/sync-secrets.ts`, `src/app/dashboard/configs/` |
| API Keys | `src/app/dashboard/settings/keys/`, `src/lib/auth/api-auth.ts` |
| MCP Gateway | `api/mcp/v1/route.ts` → `src/lib/nexus/mcp/` |
| K3s Health | `api/k3s/status/`, `src/app/dashboard/system/health/` |
| Activity Logs | `src/app/dashboard/system/logs/` |
| Auth Bouncer | `api/verify-ingress/route.ts` (Traefik ForwardAuth — local: instance-exists only) |

## Blueprint System

**File:** `src/lib/nexus/blueprints.ts` — DO NOT TOUCH

```ts
export interface Blueprint {
  id: string;
  displayName: string;
  description: string;
  image: string;
  port: number;                   // Container port (Service always exposes :80 → targetPort)
  requiresLlmKeys: boolean;
  persistence: boolean;           // Create data PVC?
  pvcSize: string;                // e.g. "10Gi"
  codePersistence: boolean;       // Create code PVC?
  codeMountPath: string;          // e.g. "/app"
  codePvcSize: string;            // e.g. "250Mi"
  runtimeInfo?: {
    runtime: string;
    packageManagers: string[];
    serviceMode: boolean;
    notes: string;
  };
  resources: {
    memoryLimit: string;
    memoryRequest: string;
    cpuLimit: string;
    cpuRequest: string;
  };
  icon: string;
  category: string;
  isStable: boolean;
}
```

**Current Blueprints:**
- `hello-world` — Stateless test container. No PVCs. 256Mi/200m limit.
- `python-sandbox` — Python 3.12 + Homebrew. 250Mi code PVC at `/app`. 2Gi/500m limit.
- `nodejs-sandbox` — Node.js 20 + pnpm + Homebrew. 250Mi code PVC at `/app`. 2Gi/500m limit.
- `openclaw` — Full workspace, 10Gi data PVC, requires LLM keys. **Dormant — not in regular offering.**
- `nanoclaw` — Lightweight assistant, 2Gi data PVC, requires LLM keys. **Dormant — not in regular offering.**

**Sandbox images:** Custom Ubuntu 24.04 + Homebrew, UID 1000 `node` user, `nexus-entrypoint.sh` bootloader. Dockerfiles: `docker/sandboxes/`.

Always use `getBlueprint(id)` / `blueprintExists(id)`. Never hardcode blueprint properties.

## Kubernetes Architecture

### Namespace Strategy

One namespace per user — all instances share it:
- Pattern: `u-{first-8-chars-of-userId-no-hyphens}` e.g. `u-00000000` for the local dev user
- Created on first deploy, never deleted
- Helper: `getUserNamespace(userId)` in `src/lib/config/nexus.ts`

### Resource Naming

| Resource | Pattern |
|----------|---------|
| Deployment | `app-{shortId}` |
| Service | `svc-{shortId}` |
| Ingress (local) | `ingress-{shortId}` |
| IngressRoute (cloud) | `ingress-{shortId}` |
| Middleware (cloud) | `auth-{shortId}` |
| Data PVC | `pvc-{shortId}` |
| Code PVC | `pvc-code-{shortId}` |
| Config Secret | `set-{setId-first-8}` |

### Port Architecture

`http://inst-{id}.localhost` (port 80) → Traefik → `svc-{shortId}:80` → container port (varies by blueprint)

`internalUrl` is always `http://svc-{shortId}:80` — not the container port. Pod-to-pod calls use `:80`.

### Pod Security

- `automountServiceAccountToken: false` on all pods (prevents K8s API auth from containers)
- `securityContext.fsGroup: 1000` for PVC access as node user

### NetworkPolicy: nexus-isolation

Applied per user namespace on first deploy (replace-on-409):
- Ingress: same-namespace pods + kube-system (Traefik)
- Egress: same-namespace pods + DNS (kube-system:53) + public internet (excluding cluster CIDRs: `10.43.0.1/32`, `10.43.0.0/16`, `10.42.0.0/16`)

Note: `V1NetworkPolicyIngressRule` uses `_from` in `@kubernetes/client-node` — it serializes to `from` correctly. Do not change to `from` in TypeScript.

### K8s Patch Operations

For `PATCH` (restart, config-set change): create `AppsV1Api` with `k8s.createConfiguration()` + `promiseMiddleware` to set `Content-Type: application/strategic-merge-patch+json`. Never use `kc.makeApiClient()` for patch (defaults to JSON Patch, causes HTTP 400). Never pass `_options` to patch methods (replaces `baseServer`). Pattern: `api/instances/[id]/restart/route.ts`.

## Configuration Vault

Encrypted environment variable management with K8s Secret syncing.

- **`config_sets`** table — named collections (id, user_id, name, description)
- **`config_variables`** table — AES-256-GCM encrypted key-value pairs per set
- **`instances.config_set_id`** — FK, nullable, ON DELETE SET NULL
- **K8s Secret name:** `set-{setId-first-8-chars}` in user namespace
- **Deployment injection:** `envFrom: [{secretRef: {name: "set-..."}}]`

`src/lib/k8s/sync-secrets.ts`:
- `syncConfigSetToK8s(userId, setId, nodeKubeconfig)` — create/update Secret
- `deleteConfigSetFromK8s(userId, setId, nodeKubeconfig)` — delete Secret (404-safe)

Config set changes on running instances: PATCH `/api/instances/[id]/config-set` — patches `envFrom` + scales 0→1 (~10 s). Do not redeploy.

**Encryption:** `src/lib/encryption.ts` (DO NOT TOUCH) — AES-256-GCM, format `<iv_hex>:<authTag_hex>:<ciphertext_hex>`. Key: `ENCRYPTION_KEY` env var, **exactly 32 ASCII chars** (UTF-8 bytes, not hex). Always encrypt on write, decrypt on read.

## Developer API (M2M)

All `/api/v1/*` require `Authorization: Bearer nx_...`. Middleware validates and injects `x-user-id`.

**Deploy:** `POST /api/v1/workloads`
```json
{ "blueprint_id": "python-sandbox", "config_set_id": "uuid", "userDescription": "label" }
```
Response:
```json
{ "ok": true, "subdomain": "inst-a1b2c3d4", "instanceId": "uuid", "instance_id": "uuid",
  "internalUrl": "http://svc-a1b2c3d4:80", "publicUrl": "http://inst-a1b2c3d4.localhost" }
```

**Status:** `GET /api/v1/workloads/[id]/status`
```json
{ "status": "running", "isReady": true, "publicUrl": "http://inst-a1b2c3d4.localhost",
  "subdomain": "inst-a1b2c3d4", "created_at": "...", "internalUrl": "http://svc-a1b2c3d4:80" }
```

**Files:** `POST /api/v1/workloads/[id]/files` — `{ "path": "app.py", "content": "...", "encoding": "utf8" }`

**Execute:** `POST /api/v1/workloads/[id]/execute` — `{ "command": "python3 app.py", "workDir": "/app" }`

**Restart:** `POST /api/v1/workloads/[id]/restart` — scales 0→1, ~10-15 s

**Delete:** `DELETE /api/v1/workloads/[id]`

**Blueprints:** `GET /api/v1/blueprints`

**List:** `GET /api/v1/workloads` — returns `{ workloads: [...], count, limit, slotsRemaining }`

**Instance limit:** 5 concurrent by default (`users.max_instances`). `InstanceLimitError` → HTTP 429 `{ error: "instance_limit_reached", current, limit }`.

## Service Mode (Nexus Entrypoint)

All sandbox images use `docker/sandboxes/nexus-entrypoint.sh` as entrypoint:
- **Idle mode:** no `/app/nexus-start.sh` → `tail -f /dev/null`
- **Service mode:** `/app/nexus-start.sh` exists → execute it as PID 1

Workflow: deploy sandbox → upload code + `nexus-start.sh` via files API → restart → service runs.

```bash
# nexus-start.sh example (Python Flask)
#!/bin/bash
set -e
pip3 install flask --break-system-packages --quiet
exec python3 app.py
```

Use `python3`/`pip3` (not `python`/`pip`). Add `--break-system-packages` for pip3 in Ubuntu 24.04 containers.

## MCP Gateway

**Endpoint:** `POST /api/mcp/v1`  
**Auth:** Bearer `nx_...` (validated explicitly in route — NOT by middleware, which only covers `/api/v1/*`)  
**SDK:** `@modelcontextprotocol/sdk` — stateless Streamable HTTP, one server+transport per request

**Module layout:**
```
src/lib/nexus/mcp/
  server.ts         buildMcpServer() factory
  helpers.ts        McpCtx, resolveInstance(), ok(), err()
  skills.ts         SKILLS_CONTENT (inlined markdown — serverless safe)
  resources.ts      nexus://wallet/balance, nexus://skills
  tools/
    discovery.ts    nexus_list_blueprints, nexus_list_workloads
    lifecycle.ts    nexus_deploy, nexus_status, nexus_wait_for_ready, nexus_restart, nexus_terminate
    sandbox.ts      nexus_execute_command, nexus_write_file, nexus_write_files, nexus_read_file,
                    nexus_list_files, nexus_delete_file, nexus_get_logs, nexus_fetch
```

**McpCtx:** `{ userId, keyId, apiKey, audit, balance, isVip }`  
**Tools:** 15 total (see layout above)  
**Resources:** `nexus://wallet/balance` (JSON), `nexus://skills` (Markdown)

**Critical:** MCP server must be stateless — fresh `McpServer` + `WebStandardStreamableHTTPServerTransport` per request (`sessionIdGenerator: undefined`). Never reuse across requests.

**Client requirement:** `Accept: application/json, text/event-stream` header required. Responses are SSE-framed.

## API Keys

Format: `nx_[32 hex chars]`. SHA-256 hashed before DB storage — shown to user once, then lost forever.

Default API key (`Local Default Key`) is generated on first `docker compose up` and printed to `nexus-init` logs. It is the bootstrap key and should not be revoked — a warning is shown in the revoke dialog.

`src/lib/auth/api-auth.ts` — `validateApiKey(token)` → `{ userId, keyId } | null`

## System Tools (Dashboard)

- `/dashboard/system/logs` — Activity Logs viewer; queries `audit_logs` with `.range()` pagination
- `/dashboard/system/health` — Cluster Health; lists K3s nodes, reconciles DB instances vs K8s Deployments in `u-00000000` namespace, prunes zombie K8s resources

Health reconciliation: compares `app-{shortId}` Deployments in `u-00000000` against `instances` table. Zombies = K8s has it but DB doesn't (or vice versa). `pruneAllZombies()` in `health/actions.ts` uses `Promise.allSettled` to delete Deployment + Service + Ingress + PVCs.

## Key Conventions

- **Audit everything:** `logAction(userId, action, status, metadata)` from `src/lib/audit.ts` for all state-changing operations
- **Routes are thin adapters:** Never put K8s logic in route handlers — call `src/lib/nexus/ops/` functions
- **Encryption:** LLM keys in `tenant_configs` and config variables in `config_variables` use AES-256-GCM. Always encrypt on write, decrypt on read
- **Feature flags:** `users.flags` is JSONB. Known flags: `is_vip`, `trial_used`, `use_test_stripe`, `show_beta_features`. Merge with spread — never overwrite
- **K8s errors:** Check `err.code`, not `err.response.statusCode`. 404 = `(err as {code?: number})?.code === 404`
- **Blueprint access:** Always `getBlueprint(id)` / `blueprintExists(id)`. Never hardcode properties
- **Container name = blueprintId:** In logs/shell/patch, always use `instance.blueprint_id` as container name. Wrong name → HTTP 422
- **Dual label selector:** `app=${blueprintId},instance=${shortId}` — required in shared namespace to target the right pod
- **`nexus_write_files` over `nexus_write_file`** for 2+ files — single pod lookup amortised
- **`nexus_wait_for_ready` over polling `nexus_status`** — blocks server-side, saves LLM turns
- **SKILLS.md ≠ `nexus://skills`** — `SKILLS.md` is human-readable; MCP resource uses `SKILLS_CONTENT` from `skills.ts` (inlined string, serverless-safe)
- **`nexus_fetch` target is DB-derived, not user input** — host = `{instance.subdomain}.{INFRA_DOMAIN}`, only path is user-supplied (prevents SSRF)
- **`McpCtx.apiKey` holds raw Bearer token** — used only by `nexus_fetch` to forward to bouncer. Never log it

## Common Pitfalls

- **`ENCRYPTION_KEY` must be exactly 32 ASCII chars, not hex** — `encryption.ts` does `Buffer.from(key, "utf8")`. A 64-char hex string is 64 bytes as UTF-8, fails validation. Generate: `python3 -c "import secrets; print(secrets.token_urlsafe(24)[:32])"`. Default in `docker-compose.yml` is already correct — never revert to hex
- **`"use server"` files cannot export `const runtime`** — Next.js only allows async function exports. Adding `export const runtime = "nodejs"` to an action file causes build error. Set runtime in the page/route that imports the action
- **Dynamic imports of deleted modules fail at build time** — Next.js resolves all `await import(...)` paths at compile time, even inside `if (!isLocalMode())` guards. Removing a lib file requires removing every dynamic import referencing it too
- **`internalUrl` uses port 80, not blueprint port** — K8s Service exposes `:80` → `targetPort: blueprint.port`. All `internalUrl` values are `http://svc-{shortId}:80`. Pod-to-pod calls to `:8000` or `:3000` directly on the Service will time out
- **Local kubeconfigs are NOT encrypted** — `getNodeKubeconfig()` returns raw file contents in local mode. Never call `decrypt()` on them. Cloud mode encrypts kubeconfigs in DB
- **UI routes with inline K8s code need the `isLocal` node fallback** — Route handlers that fetch `node.kubeconfig` from the `nodes` table directly (outside `ops/`) will get `null` in local mode because the mock node is never persisted to DB. Pattern: `const { isLocalMode } = await import("@/lib/auth/dev-user"); const isLocal = isLocalMode();` then guard the 500 with `if (!node?.kubeconfig && !isLocal)` and use `getNodeKubeconfig(node ?? { kubeconfig: "" })`. Applied in `api/instances/[id]/shell/route.ts`; apply to any new route that does its own K8s access outside `ops/`.
- **Ghost K3s nodes on Docker restarts** — Without pinned hostname, each restart registers a new node in etcd. Fixed by `hostname: nexus-k3s` + `--node-name=nexus-k3s` + `nexus-node-cleaner`. Do not remove these
- **`*.localhost` DNS is OS-dependent** — Linux systemd-resolved ≥247 handles it natively. macOS: use `INFRA_DOMAIN=localtest.me` or dnsmasq. See `QUICKSTART.md`
- **`publicUrl` is server-computed** — `dashboard/page.tsx` computes it from `INFRA_DOMAIN` + `isLocalMode()` and passes as prop to `InstanceCardClient`. Client never derives URL itself
- **Don't delete user namespaces** — they persist across instance deletions. Delete only instance-specific resources (`app-*`, `svc-*`, `ingress-*`, `pvc-*`)
- **`ops/redeploy.ts` does not exist** — `api/instances/[id]/redeploy/route.ts` is openclaw-specific and intentionally outside the shared ops library. Edit it directly
- **MCP route is NOT under `/api/v1/`** — Middleware does NOT auto-validate Bearer tokens for `/api/mcp/v1`. Route calls `validateApiKey()` explicitly. Never move it to `/api/v1/mcp` without adding middleware coverage
- **K8s patch requires `promiseMiddleware`** — Never `kc.makeApiClient(k8s.AppsV1Api)` for PATCH. Use `new k8s.AppsV1Api(k8s.createConfiguration(...))` with `promiseMiddleware` setting `Content-Type: application/strategic-merge-patch+json`. Never pass `_options` to patch methods
- **`BLUEPRINTS` is a Record, not an array** — Iterate with `Object.values(BLUEPRINTS)`. Calling `.map()` on it directly fails at runtime
- **Files API path deduplication** — `resolvePath()` in `ops/files.ts` strips `codeMountPath` prefix if caller passes absolute path (e.g. `/app/file.txt`). Without this, path doubles to `/app/app/file.txt`. Do not revert
- **`local-client.ts` `.range()` requires COUNT** — When `countMode=true` (from `.select("*", { count: "exact" })`), a separate `SELECT COUNT(*)` is run. Required for Activity Logs pagination. Do not remove the count branch
- **Local mode bypasses ALL authorization** — `isAuthorized()` returns `true` immediately. No balance check. No VIP check. Don't rely on either for feature gating

## Further Reading

See [ARCHITECTURE.md](ARCHITECTURE.md) for a visual overview of Docker services, request flows, the K8s resource lifecycle, NetworkPolicy rules, and local-mode dual paths.
