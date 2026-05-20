# Contributing to OCL Nexus Local

Thank you for your interest in contributing. OCL Nexus Local is a single-user agentic compute platform built on Next.js, K3s, and Docker Compose. Contributions of all kinds are welcome — bug fixes, new blueprints, documentation improvements, and feature work.

## Before You Start

Read **[AGENTS.md](AGENTS.md)** and **[ARCHITECTURE.md](ARCHITECTURE.md)**. They cover the codebase conventions, key file map, common pitfalls, and the ops/ thin-adapter pattern that everything is built on. Skipping these leads to PRs that duplicate K8s logic in the wrong layer.

## Development Setup

```bash
# Clone and start the full stack (hot reload)
git clone https://github.com/your-org/ocl-nexus-local
cd ocl-nexus-local
cp .env.local.example .env.local   # set ENCRYPTION_KEY (32 ASCII chars)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

The `docker-compose.dev.yml` overlay mounts the source tree live and runs `npm run dev` inside the container. Changes to `src/` reload instantly; changes to `package.json` require a container restart.

See [QUICKSTART.md](QUICKSTART.md) for DNS setup and the first-run API key.

## Agent-First Development

This project is designed to be worked on by AI coding agents as much as by humans. `AGENTS.md` is the primary context file — it is kept accurate so that Claude Code, Cursor, and similar tools can navigate and modify the codebase correctly.

If you contribute a meaningful change, please update `AGENTS.md` accordingly (new pitfalls, changed file roles, updated patterns). This is as important as the code change itself.

## What to Contribute

**Good targets:**
- New blueprints (`src/lib/nexus/blueprints.ts` + a Docker image)
- Dashboard UI improvements
- MCP tool enhancements (wording, new tools)
- Bug fixes with a clear reproduction case
- Documentation and AGENTS.md improvements

**Please discuss first** (open an issue) before starting:
- Changes to `src/lib/nexus/ops/` — shared K8s business logic
- Changes to `src/app/api/mcp/v1/` or `src/app/api/v1/` — public API contracts
- New dependencies

## Pull Request Process

1. Fork the repository and create a feature branch from `main`
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes. Keep PRs focused — one logical change per PR
3. Ensure the project still builds and the system starts cleanly:
   ```bash
   docker compose down -v && docker compose up -d
   docker compose logs nexus-init   # should show ✅ Initialization Complete
   ```
4. Open a PR against `main` with a clear title and description of *what* and *why*

## Code Style

- TypeScript throughout; no `any` unless genuinely unavoidable
- No comments unless the *why* is non-obvious — well-named identifiers are preferred
- Routes are thin adapters; K8s logic belongs in `src/lib/nexus/ops/`
- All state-changing operations must call `logAction()` from `src/lib/audit.ts`

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license that covers this project.
