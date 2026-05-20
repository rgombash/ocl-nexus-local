# Architecture — OCL Nexus Local

Concise technical reference for contributors. For conventions, pitfalls, and environment setup see [AGENTS.md](AGENTS.md).

---

## Docker Compose Services

```
┌─────────────────────────────────────────────────────────────┐
│  Host machine                                               │
│                                                             │
│  nexus-app  :3000  ─── Next.js (App Router, Node.js)        │
│       │                  Dashboard + REST API + MCP         │
│       │                                                     │
│  nexus-db   :5432  ─── PostgreSQL 16                        │
│       │                  instances, users, api_keys,        │
│       │                  config_sets, audit_logs …          │
│       │                                                     │
│  nexus-k3s  :6443  ─── K3s single-node cluster             │
│       │                  + Traefik ingress (built-in)       │
│       │                                                     │
│  nexus-node-cleaner    One-shot: delete stale K3s nodes     │
│  nexus-init            One-shot: schema + API key seed      │
│                                                             │
│  shared volume: /shared/k3s/kubeconfig                      │
│    nexus-k3s writes → nexus-app reads via KUBECONFIG_PATH   │
└─────────────────────────────────────────────────────────────┘
```

Workloads run as pods inside K3s, reachable at `http://inst-{id}.localhost` (Linux) or `http://inst-{id}.localtest.me` (macOS/Windows).

---

## Request Flow

### Browser / Dashboard (session auth)

```
Browser → nexus-app:3000
  → src/middleware.ts        local mode: inject dev user, skip Supabase
  → src/app/dashboard/       Server Components — createSupabaseServerClient() returns mock
  → src/app/api/instances/   Route handlers — thin adapters
  → src/lib/nexus/ops/       K8s business logic
  → K3s API :6443
```

### AI Agent / MCP (API key auth)

```
Claude → POST /api/mcp/v1
  → validateApiKey()          SHA-256 hash lookup in api_keys table
  → buildMcpServer()          fresh McpServer per request (stateless)
  → tools/lifecycle.ts        nexus_deploy / nexus_terminate / …
  → src/lib/nexus/ops/        same ops/ functions as UI routes
  → K3s API :6443
```

### AI Agent / REST (API key auth)

```
Agent → /api/v1/workloads
  → middleware.ts             validates nx_ token, injects x-user-id header
  → route handler             thin adapter — auth + ownership check
  → src/lib/nexus/ops/        shared ops functions
  → K3s API :6443
```

---

## ops/ Service Library

All K8s business logic lives in `src/lib/nexus/ops/`. Route handlers are thin adapters: authenticate → verify ownership → call op → return response. **Never put K8s logic in a route handler.**

| File | Exported function(s) | Notes |
|------|---------------------|-------|
| `deploy.ts` | `deployWorkload(input)` | Namespace, PVCs, Deployment, Service, Ingress, config secret |
| `delete.ts` | `deleteWorkload(instance, audit)` | K8s resource cleanup + DB row removal |
| `restart.ts` | `restartWorkload(instance, audit)` | Scale 0 → 1 via strategic merge patch |
| `status.ts` | `getStatus(instance)` | Pod phase → `{ status, isReady, publicUrl, internalUrl }` |
| `logs.ts` | `getLogs(instance, lines, audit)` | Container + init container logs |
| `execute.ts` | `executeShellCommand(instance, cmd, workDir, audit)` | Shell exec in pod |
| `files.ts` | `writeFile / readFile / listFiles / deleteFile` | Code PVC file operations |
| `config-set.ts` | `applyConfigSet(instance, setId, …)` | PATCH `envFrom` + restart |
| `description.ts` | `updateDescription(id, text, userId)` | DB-only, no K8s |

### Error hierarchy (`src/lib/nexus/errors.ts`)

```
NexusError (base)
  ├── NotFoundError         → HTTP 404
  ├── ForbiddenError        → HTTP 403
  ├── BadRequestError       → HTTP 400
  ├── ServerError           → HTTP 500
  ├── InstanceLimitError    → HTTP 429  { current, limit }
  └── ServiceUnavailableError → HTTP 503
```

`toResponse(err)` converts any `NexusError` to a typed JSON response. Route handlers wrap ops in `try/catch` and call `toResponse(err)` in the catch.

---

## K8s Resource Lifecycle

One namespace per user (`u-{userId-first-8-no-hyphens}`) created on first deploy, never deleted.

### On `deployWorkload()`

| Step | Resource created |
|------|-----------------|
| A | Namespace `u-{userId}` (idempotent) |
| A2 | Secret `ghcr-pull-secret` (if GHCR credentials set) |
| A3 | Secret `set-{setId}` synced from config vault (if configSetId) |
| A4 | NetworkPolicy `nexus-isolation` (replace-on-409) |
| B | PVC `pvc-{shortId}` — data volume (if `blueprint.persistence`) |
| B2 | PVC `pvc-code-{shortId}` — code volume (if `blueprint.codePersistence`) |
| C | Deployment `app-{shortId}` with init containers + main container |
| D | Service `svc-{shortId}` — exposes port 80 → `targetPort: blueprint.port` |
| E | Ingress `ingress-{shortId}` — `inst-{shortId}.{INFRA_DOMAIN}` → `svc-{shortId}:80` |

### On `deleteWorkload()`

Deployment, Service, Ingress, both PVCs — all via `safeDelete()` (404s silently ignored). Namespace is **not** deleted.

---

## NetworkPolicy: nexus-isolation

Applied per user namespace. Pods can reach the internet but not other users' pods or the K3s control plane.

```
Ingress allowed:
  - Same namespace pods (pod-to-pod within user)
  - kube-system namespace (Traefik proxying inbound requests)

Egress allowed:
  - Same namespace pods
  - kube-system on port 53/UDP and 53/TCP (DNS)
  - 0.0.0.0/0 EXCEPT:
      10.43.0.1/32   K3s API server service IP
      10.43.0.0/16   K3s service CIDR
      10.42.0.0/16   K3s pod CIDR (other namespaces)
```

Note: `V1NetworkPolicyIngressRule` uses `_from` in `@kubernetes/client-node` — serializes to `from` correctly. Do not rename to `from` in TypeScript.

---

## Local Mode Dual Paths

Several files branch on `isLocalMode()` to avoid cloud dependencies:

| File | Local path | Cloud path |
|------|-----------|-----------|
| `supabase-admin.ts` | exports `localDb` (postgres npm) | exports Supabase service client |
| `supabase-server.ts` | returns mock client (`getUser()` → dev user) | returns Supabase SSR client |
| `middleware.ts` | injects dev user, skips all Supabase auth | full Supabase session validation |
| `nexus/client.ts` | `getNodeKubeconfig()` reads from file | `getNodeKubeconfig()` decrypts from DB |
| `ops/deploy.ts` | creates standard `networking.k8s.io/v1 Ingress` | creates Traefik `IngressRoute` + `Middleware` CRDs |
| `ops/delete.ts` | uses file kubeconfig; `isLocal` guard for missing node row | queries nodes table; decrypts kubeconfig |
| `api/verify-ingress` | instance-exists check only | full auth + balance + ownership pipeline |

**Key invariant:** `isLocalMode()` is the single source of truth. Import it from `src/lib/auth/dev-user.ts`. Never check `process.env.NEXUS_MODE` directly in application code.

---

## MCP Server

Stateless Streamable HTTP — one `McpServer` + `WebStandardStreamableHTTPServerTransport` per POST request. No session state between calls.

```
POST /api/mcp/v1
  → validateApiKey()
  → fetch user profile (balance, flags)
  → buildMcpServer(userId, keyId, token, balance, isVip)
      registerDiscoveryTools()   list_blueprints, list_workloads
      registerLifecycleTools()   deploy, status, wait_for_ready, restart, terminate
      registerSandboxTools()     execute_command, write/read/list/delete_file, get_logs, fetch
      registerResources()        nexus://wallet/balance, nexus://skills
  → transport.handleRequest(req)
```

Tools call `src/lib/nexus/ops/` functions — no direct K8s code in MCP tool handlers.
