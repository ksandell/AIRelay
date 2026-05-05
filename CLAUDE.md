# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AIRelay — API Proxy for AI.** A Dockerized Node.js service that sits between an application codebase and an upstream AI/LLM HTTP API (Anthropic, OpenAI, Gemini, Bedrock, OpenRouter, self-hosted, etc.). It acts as a transparent passthrough — bytes are forwarded unmodified — and surfaces live logs + per-request metrics in a vanilla JS dashboard. Runs identically on Windows Docker Desktop and Linux hosts. Reachable by **DNS name + port** (Tailscale MagicDNS or `/etc/hosts`), never `localhost`. Designed to handle an unbounded number of concurrent in-flight requests.

### Use Case

Application code points its existing AI SDK at the proxy instead of the vendor host (e.g. `baseURL: http://airelay.local:3000/proxy`). The proxy forwards every request to `UPSTREAM_URL`, returns the upstream response unchanged, and emits an observability event per request. Auth headers (`Authorization`, `x-api-key`, `anthropic-version`, etc.) are forwarded as-is — the proxy holds no credentials. Provider-agnostic: anything that speaks HTTPS works.

This service is **not** intended for desktop chat clients or terminal-based AI assistants. The target traffic is server-to-API SDK calls from a codebase.

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22+ (ESM — `import`/`export`, `node:` prefix) |
| Backend | Express.js + `http-proxy` (low-level, true streaming — no body buffering) |
| Frontend | Vanilla JS + SSE (`EventSource`) + Chart.js via CDN — no build step |
| Scheduler | `node-cron` (internal — no system cron) |
| Testing | Vitest + supertest |
| Linting | ESLint flat config (v9) + Prettier |
| Container | Docker multi-stage (`node:22-alpine`) |

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

# Docker (one command — auto-loads docker-compose.override.yml in dev)
npm run docker:up
npm run docker:down
npm run docker:logs
```

## Architecture

### Module Boundaries

- `src/proxy/proxy.js` — transparent passthrough proxy; emits metric events via `proxyRes`/`error` hooks; **never** calls the sync logger on the hot path
- `src/proxy/agent.js` — shared `http.Agent`/`https.Agent` (`maxSockets: Infinity`, `keepAlive: true`) so outbound concurrency isn't serialized
- `src/metrics/collector.js` — pre-allocated ring buffer; `record(event)` is O(1) with no allocations beyond the event object itself
- `src/metrics/aggregator.js` — pure function; rolling-window aggregates (RPS, p50/p95/p99, error rate, status histogram, bytes)
- `src/metrics/broadcaster.js` — second SSE channel; per-event stream is throttled, 1 s aggregate ticks always go through
- `src/logs/logger.js` — write side only; reserved for **app-level** events (startup, cron, errors). Never imported by the read side and never invoked per proxied request.
- `src/logs/reader.js` — read side only; no knowledge of SSE or logger
- `src/logs/rotation.js` — lifecycle (rotate, cleanup, size guard, startup check)
- `src/sse/stream.js` — log-stream SSE; module-level `Set<Response>` with hard cap + non-blocking writes
- `src/config.js` — single source of truth for all env vars; `dotenv` loaded only in non-production
- `src/providers/registry.js` — provider singleton loader; 14 implementations under `src/providers/*.js`
- `src/providers/pricing.js` — loads bundled `config/pricing.json`; deep-merges custom file from `PRICING_CONFIG_PATH`
- `src/middleware/requestLogger.js` — sync `appendFileSync` per non-proxy request (not on proxy hot path)
- `src/middleware/errorHandler.js` — Express error response middleware

### Mount order in `server.js` (load-bearing)

1. Proxy at `PROXY_PATH_PREFIX` — **before** anything else, so request bodies stream straight to upstream and the sync request logger doesn't run on the hot path
2. `express.json()`
3. `requestLogger` (sync `appendFileSync` per request — fine for `/api/*` and `/`, NOT fine for proxied traffic)
4. Static + API routers + error handler

### Key Design Decisions

- **Passthrough = no modification.** Bytes flow through `http-proxy` streams unchanged. Byte counters use passive `data` listeners; bodies are never buffered. `X-Forwarded-*` is opt-in only (`PROXY_TRUST_FORWARDED`, default `false`) because it's technically a modification.
- **Concurrency hot path has zero sync I/O.** No `appendFileSync`, no `JSON.parse` of payloads, no compression. Per-request observability goes through `metrics.record()` only — the logger is for app events.
- **Pre-allocated ring buffer.** `MAX_METRIC_EVENTS`-sized array; `head` rotates with no `push`/`shift`, so GC churn is bounded under load.
- **Shared outbound HTTP agent.** Default Node agent caps `maxSockets` at 5/host — that serializes excess concurrent calls. We override.
- **SSE caps + non-blocking writes.** `MAX_SSE_CLIENTS` evicts oldest on overflow; `res.write()` returning `false` (slow client) drops that frame rather than queueing — ring buffer is the source of truth.
- **DNS-first deployment.** `BIND_HOST=0.0.0.0` by default. Code never references `localhost`. `PUBLIC_BASE_URL` is informational (logged, surfaced on `/health`) — DNS routing happens via Tailscale MagicDNS or hosts file.
- **`LOG_DIR`** env var is the only thing that switches between local dev (`./data/logs`) and container (`/data/logs`). No code divergence.
- **Structured JSONL** for app logs: `{"ts":"…","level":"…","msg":"…","meta":{}}`.
- **SSE over polling** for both logs (`/api/logs/stream`) and metrics (`/api/metrics/stream`); `EventSource` reconnects automatically.
- **`dotenv` is a devDependency**, loaded only when `NODE_ENV !== 'production'`. Docker injects vars directly.
- **`node --watch`** used instead of nodemon — zero extra dependency.

### Log Retention

- Active: `/data/logs/app.log`
- Rotated: `app-YYYY-MM-DD.log` (UTC date)
- Retention: 7 rotated files; older deleted automatically
- Rotation triggers: midnight UTC (cron) OR file exceeds `MAX_LOG_SIZE_MB` (size guard every 5 min)
- Startup: `rotateLogsIfNeeded()` runs on boot to handle restart-at-midnight edge case

### Metrics Retention

- In-memory ring buffer of `MAX_METRIC_EVENTS` (default 10 000) — older events overwritten
- Aggregator recomputes 1m / 5m / 15m windows from the ring on demand (no separate state to keep in sync)
- No on-disk metric history in v0.1.0 — restart wipes the buffer

### API Surface

```
GET /health                          — uptime, proxy state, upstream reachability,
                                       runtime stats (inFlight, sseClients, eventLoopLagMs, rss)

# Logs
GET /api/logs?limit=500              — tail of active log (parsed JSONL array)
GET /api/logs/available              — list rotated files with dates + sizes
GET /api/logs/history?date=YYYY-MM-DD — specific rotated file
GET /api/logs/stream                 — SSE stream of live log entries

# Metrics
GET /api/metrics/summary             — snapshot: count, capacity, inFlight, 1m/5m/15m windows
GET /api/metrics/recent?limit=200    — last N proxied requests (oldest-first)
GET /api/metrics/models              — per-model cost/token breakdown, sorted by cost desc
GET /api/metrics/stream              — SSE: 'request' events per proxied request (throttled to SSE_EVENT_RATE/s)
                                       + 'tick' events every METRICS_TICK_MS with rolling aggregates

# Proxy
ANY  <PROXY_PATH_PREFIX>/*           — transparent passthrough to UPSTREAM_URL (default prefix: /proxy)
```

## Environment Variables

See [.env.example](.env.example) for all variables with defaults. Critical ones:

| Var | Default | Notes |
|---|---|---|
| `BIND_HOST` | `0.0.0.0` | Must bind all interfaces — never loopback |
| `PUBLIC_BASE_URL` | `(unset)` | Informational only; `http://airelay.local:3000` style |
| `UPSTREAM_URL` | `(unset)` | Empty = proxy disabled (returns 503 at the prefix) |
| `PROXY_PATH_PREFIX` | `/proxy` | All `/proxy/*` requests forwarded |
| `PROXY_TRUST_FORWARDED` | `false` | Set true only if upstream needs `X-Forwarded-*` |
| `MAX_METRIC_EVENTS` | `10000` | Ring buffer size |
| `METRICS_TICK_MS` | `1000` | Aggregate broadcast cadence |
| `MAX_SSE_CLIENTS` | `50` | Hard cap; oldest-evicted on overflow |
| `SSE_EVENT_RATE` | `50` | Per-event metric stream throttle (events/sec) |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | Graceful drain window before forced exit |
| `LOG_DIR` | `./data/logs` | `/data/logs` in container |
| `LOG_RETENTION_DAYS` | `7` | |
| `MAX_LOG_SIZE_MB` | `50` | Triggers mid-day rotation |
| `TZ` | `UTC` | Never change — all timestamps are UTC |
| `PROXY_PROVIDER`            | `generic`    | Provider for token extraction (anthropic/openai/google/etc.) |
| `PROXY_TOKEN_TRACKING`      | `true`       | Enable body tee for token/cost extraction |
| `PRICING_CONFIG_PATH`       | `(unset)`    | Path to custom pricing JSON (deep-merged over bundled) |
| `PROXY_TOKEN_TEE_MAX_BYTES` | `2097152`    | Per-request buffer cap for token extraction (2 MiB) |
| `SSE_HEARTBEAT_MS`          | `30000`      | SSE keep-alive ping interval |
| `LOG_LEVEL`                 | `info`       | Log level: debug/info/warn/error |
| `CRON_SCHEDULE`             | `0 0 * * *` | Cron for daily midnight log rotation (UTC) |
| `ENABLE_COMPRESSION`        | `false`      | Gzip rotated logs (reserved, not yet active) |

## Deployment

The service is addressed by DNS name + port. Two supported resolution paths:

| Mode | Setup |
|---|---|
| Tailscale MagicDNS | `tailscale up` on the host; container reachable as `<host>.<tailnet>.ts.net:3000` |
| `/etc/hosts` (or Windows `hosts`) | `<host-ip>  airelay.local` on each client |

Healthcheck inside the container uses `127.0.0.1` so it doesn't depend on DNS.

## Docker

- `docker-compose.yml` — production; named volume `log-data:/data/logs`; explicit port map; `ulimits.nofile=65536`; all proxy/metrics env knobs plumbed
- `docker-compose.override.yml` — auto-loaded in dev; mounts `./src` + `./public` for live edits, `./data/logs` for local log output
- `docker/Dockerfile` — multi-stage; prod stage uses `--omit=dev`; `NODE_OPTIONS=--max-http-header-size=32768`; healthcheck via `127.0.0.1`

## Pull Request Policy

PRs **must** close their linked issues on merge. Use GitHub closing keywords in the PR body:

```
Closes #<issue-number>
```

Use `Closes`, `Fixes`, or `Resolves` — GitHub auto-closes the issue when the PR merges into the default branch.

## Docs

- [README.md](README.md) — elevator pitch + 60-second quickstart
- [INSTALL.md](INSTALL.md) — novice-friendly install walkthrough (Windows / macOS / Linux / local Node)
- [CONFIGURATION.md](CONFIGURATION.md) — every env var, provider recipes, DNS, TLS, tuning, prod checklist
- [ROADMAP.md](ROADMAP.md) — phased plan (v0.1 observability → v0.2 token & cost tracking → stretch)
- [docs/proxy-metrics-plan.md](docs/proxy-metrics-plan.md) — v0.1.0 architecture: passthrough proxy, metrics, DNS deployment, concurrency design
- [docs/development-plan.md](docs/development-plan.md) — original log rotation spec
