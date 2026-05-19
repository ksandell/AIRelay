# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Project Overview

**AIRelay — API Proxy for AI.** Dockerized Node.js service that sits between an
application codebase and an upstream AI/LLM HTTP API. Transparent passthrough
(bytes unchanged) with live logs + per-request metrics in a vanilla JS
dashboard. Reachable by **DNS name + port** (Tailscale MagicDNS or `/etc/hosts`),
never `localhost`. Designed to handle unbounded concurrent in-flight requests.

App SDK points its `baseURL` at the proxy (e.g. `http://airelay.local:3000/proxy`)
instead of the vendor host. Auth headers (`Authorization`, `x-api-key`,
`anthropic-version`) are forwarded as-is — the proxy holds no credentials.

**Not** a desktop chat client or terminal-based assistant. Target traffic is
server-to-API SDK calls from a codebase.

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24+ (ESM, `node:` prefix) |
| Backend | Express.js + `http-proxy` (true streaming, no body buffering) |
| Frontend | Vanilla JS + SSE (`EventSource`) + Chart.js via CDN — no build step |
| Scheduler | `node-cron` (internal) |
| Testing | Vitest + supertest |
| Linting | ESLint flat config (v9) + Prettier |
| Container | Docker multi-stage (`node:24.15-alpine3.22`, fully pinned) |

## Commands

```bash
# Local dev (no Docker — fastest feedback loop)
cp .env.example .env
npm install
npm run dev          # hot-reload via node --watch

# Tests
npm test
npm run test:watch
npm run test:coverage

# Lint
npm run lint
npm run lint:fix

# Docker (auto-loads docker-compose.override.yml in dev)
npm run docker:up
npm run docker:down
npm run docker:logs

# E2E (NEW in v0.3.0) — Playwright across the dashboard (Logs, Metrics, Compressors + hash-routed Setup)
npm run test:e2e               # functional, ~8 s (no Docker required)
npm run test:e2e:visual        # visual diff vs OS-pinned baselines
npm run test:e2e:visual:bless  # update baselines after intentional UI change
npm run test:e2e:ui            # interactive Playwright debugger
```

## Architecture

Canonical reference with diagrams (request lifecycle, module map, log rotation,
key design decisions, API surface): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Mount order in `server.js` (load-bearing)

1. Proxy at `PROXY_PATH_PREFIX` — **before** anything else, so request bodies
   stream straight to upstream and the sync request logger doesn't run on the
   hot path.
2. `express.json()`
3. `requestLogger` (sync `appendFileSync` per request — fine for `/api/*` and
   `/`, **NOT** fine for proxied traffic)
4. Static + API routers + error handler

### Hot-path invariants — do not violate

- Proxy hot path has **zero sync I/O** — no `appendFileSync`, no `JSON.parse`
  of payloads, no compression. Per-request observability goes through
  `metrics.record()` only; the logger is for app events.
- **Bytes are never modified for non-opted-in traffic.** `X-Forwarded-*` is
  opt-in (`PROXY_TRUST_FORWARDED=false` by default). Two opt-in mechanisms
  may mutate request bodies, both default-off:
  1. Compactor v0.3.0 (`COMPACTOR_ENABLED=false`); per-request bypass via
     `X-Compactor: off`. See [docs/COMPACTOR.md](docs/COMPACTOR.md).
  2. Guardrails v0.4.0 (`GUARDRAILS_ENABLED=false`); only mutates in `redact`
     mode; per-request bypass via `X-Guardrails: off`. Block mode rejects
     (422) without modifying bytes. See [docs/GUARDRAILS.md](docs/GUARDRAILS.md).
- Token extraction runs on a **passive tee** in `queueMicrotask` after
  response end. Never inline.

## Environment Variables

Canonical reference: [CONFIGURATION.md](CONFIGURATION.md). All defaults in
[.env.example](.env.example).

Critical knobs to know about when reading code:

| Var | Default | Why it matters in code |
|---|---|---|
| `BIND_HOST` | `0.0.0.0` | Bind all interfaces — never loopback |
| `UPSTREAM_URL` | `(unset)` | Empty = proxy disabled (returns 503 at the prefix) |
| `PROXY_PATH_PREFIX` | `/proxy` | All `/proxy/*` requests forwarded |
| `PROXY_PROVIDER` | `generic` | Selects parser **and pricing key** in `config/pricing.json` — see warning in CONFIGURATION.md |
| `PROXY_TOKEN_TRACKING` | `true` | `false` = v0.1-equivalent zero-overhead path |
| `LOG_DIR` | `./data/logs` | Only thing that switches local-vs-container; no code divergence |
| `TZ` | `UTC` | Never change — all timestamps UTC |

## Deployment

DNS name + port. Two resolution paths:

| Mode | Setup |
|---|---|
| Tailscale MagicDNS | `tailscale up` on the host; container reachable as `<host>.<tailnet>.ts.net:3000` |
| `/etc/hosts` (or Windows `hosts`) | `<host-ip>  airelay.local` on each client |

Healthcheck inside the container uses `127.0.0.1` so it doesn't depend on DNS.

## Docker

- `docker-compose.yml` — production; named volume `log-data:/data/logs`;
  explicit port map; `ulimits.nofile=65536`; all proxy/metrics env knobs plumbed.
- `docker-compose.override.yml` — auto-loaded in dev; mounts `./src` + `./public`
  for live edits, `./data/logs` for local log output.
- `docker/Dockerfile` — multi-stage; prod stage uses `--omit=dev`;
  `NODE_OPTIONS=--max-http-header-size=32768`; healthcheck via `127.0.0.1`.

## Pull Request Policy

PRs **must** close their linked issues on merge. Use GitHub closing keywords
in the PR body: `Closes #<issue-number>` (or `Fixes`, `Resolves`).

For releases, follow [docs/RELEASING.md](docs/RELEASING.md).

## Docs index

| Doc | Purpose |
|---|---|
| [README.md](README.md) | Elevator pitch + 60-second quickstart |
| [INSTALL.md](INSTALL.md) | Windows / macOS / Linux / local Node walkthrough |
| [CONFIGURATION.md](CONFIGURATION.md) | All env vars, provider recipes, DNS, TLS, tuning, prod checklist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrams + module map + design decisions + API surface |
| [docs/COMPACTOR.md](docs/COMPACTOR.md) | Compactor feature reference (v0.3.0): activation, compressor catalog, banner, metrics, safety, tuning |
| [docs/GUARDRAILS.md](docs/GUARDRAILS.md) | Guardrails feature reference (v0.4.0): detector catalog, modes (alert/block/redact), banner, metrics, safety, deployment presets |
| [docs/ROUTING.md](docs/ROUTING.md) | Multi-upstream routing reference (v0.4.0): routes config, matching, per-route provider/trustForwarded |
| [docs/RELEASING.md](docs/RELEASING.md) | Release checklist (SSOT) |
| [docs/e2e-test-plan.md](docs/e2e-test-plan.md) | Mistral-based E2E playbook |
| [ROADMAP.md](ROADMAP.md) | Planned + speculative work (not what shipped — see CHANGELOG) |
| [CHANGELOG.md](CHANGELOG.md) | Per-release notes |
