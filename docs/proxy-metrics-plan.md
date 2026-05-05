# Proxy + Metrics Architecture (v0.1.0)

> **Status (2026-05-05):** This document describes the v0.1.0 architecture. Token & cost tracking (v0.2.0) is now fully implemented — see [CHANGELOG.md](../CHANGELOG.md) for what shipped and [CONFIGURATION.md](../CONFIGURATION.md) for the current env var reference.

**Author:** Architect / Dev Manager pass
**Last updated:** 2026-05-05
**Goal:** Sit between an application codebase and an upstream AI/LLM HTTP API. Forward bytes unchanged, capture per-request metrics with zero payload mutation, and surface them live in the dashboard.
**Deployment shape:** Single Docker service reachable by **DNS name + port** (Tailscale MagicDNS or `/etc/hosts`), built to handle an unbounded number of concurrent in-flight requests.

This document covers the **v0.1.0 scope: transparent passthrough + observability**. Token/cost tracking and other items live in [../ROADMAP.md](../ROADMAP.md).

---

## 1. Positioning

**AIRelay is an API proxy for AI.** A calling application points its existing AI SDK at the proxy instead of the vendor host. The proxy forwards every request to `UPSTREAM_URL`, returns the upstream response unchanged, and emits one observability event per request.

**Provider-agnostic.** Anthropic, OpenAI, Gemini, Bedrock, OpenRouter, self-hosted inference — anything that speaks HTTPS over a single upstream host. There is no vendor-specific request parsing in v0.1.0.

**Not in scope:** desktop chat clients, terminal AI assistants, browser extensions. The target traffic is server-to-API SDK calls from a codebase.

```js
// Codebase wires its SDK at the proxy
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "http://airelay.local:3000/proxy",
});
```

Auth headers (`Authorization`, `x-api-key`, `anthropic-version`, etc.) are forwarded as-is. The proxy holds no credentials.

---

## 2. Guiding Constraints

1. **No request/response modification.** Bytes in == bytes out. No body buffering, no header rewriting beyond opt-in `X-Forwarded-*`.
2. **Streaming-safe.** Must not break SSE responses, chunked responses, or large request bodies passing through the proxy. (AI APIs use streaming heavily — this is non-negotiable.)
3. **Reuse existing primitives.** SSE plumbing, JSONL logging, Docker volume model, vitest setup — extend, don't rebuild.
4. **Observability first.** Every proxied request emits one metric event. Aggregation is computed off the event stream, never inline in the hot path.

---

## 3. Architecture Overview

```
codebase (SDK)
   │   baseURL = http://airelay.<dns>:3000/proxy
   ▼
Docker container ──────────────────────────────────────────┐
   Express app                                              │
            │                                               │
            ├─ /proxy/*            ──▶  http-proxy ──▶ UPSTREAM_URL (AI provider)
            │     │                                       │
            │     └─ proxyReq/proxyRes/error hooks ──▶ metrics.record()
            │
            ├─ /api/metrics/*      (REST + SSE — metrics for UI)
            ├─ /api/logs/*         (existing)
            └─ /                   (static UI: tabs = Logs | Metrics)
                                                            │
   metrics.record() ──▶ ring buffer (last N events)         │
                    ──▶ rolling aggregator (1s tick)        │
                    ──▶ broadcaster → /api/metrics/stream   │
─────────────────────────────────────────────────────────────┘
```

The container exposes a single TCP port. DNS resolution (Tailscale MagicDNS or hosts file) maps the chosen hostname → host IP; Docker port-maps `:3000` to the container. No localhost coupling anywhere in code, env, or docs.

**Why `http-proxy` (not `http-proxy-middleware`):** lower-level, native streaming, exposes `proxyReq`/`proxyRes`/`error` events for metrics, no opinionated body parsing. The middleware wrapper buffers in some configurations — risk to constraint #1.

---

## 4. Module Layout

| Path | Responsibility |
|---|---|
| `src/proxy/proxy.js` | `createProxyHandler(target)` — Express handler; emits metric events via `proxyReq`/`proxyRes`/`error` |
| `src/proxy/agent.js` | Shared `http.Agent` / `https.Agent` (`keepAlive: true`, `maxSockets: Infinity`) — outbound concurrency is not serialized |
| `src/metrics/collector.js` | `record(event)` + ring buffer (`MAX_METRIC_EVENTS`); pure data, no I/O |
| `src/metrics/aggregator.js` | Rolling windows (RPS, p50/p95/p99, error rate, status histogram) — recomputed on a 1s tick |
| `src/metrics/broadcaster.js` | Second SSE channel; per-event for the recent-requests table + per-tick aggregates for charts |
| `src/api/metrics.js` | `GET /api/metrics/summary`, `GET /api/metrics/recent`, `GET /api/metrics/stream` |
| `src/config.js` | Adds: `UPSTREAM_URL`, `PROXY_PATH_PREFIX`, `MAX_METRIC_EVENTS`, `METRICS_TICK_MS`, `BIND_HOST`, `PUBLIC_BASE_URL`, `MAX_SSE_CLIENTS`, `SSE_EVENT_RATE`, `SHUTDOWN_TIMEOUT_MS`, `PROXY_TRUST_FORWARDED` |

**Mount order in `server.js` matters:** the proxy router goes **before** `express.json()`, otherwise the body gets read into memory and constraint #1 is broken.

---

## 5. Deployment Topology (DNS + Docker)

**Hostname.** Service is addressed as `airelay.<your-domain>:<PORT>`. Two supported resolution paths:

| Mode | Setup | Use when |
|---|---|---|
| Tailscale MagicDNS | `tailscale up` on host; container reachable as `<host>.<tailnet>.ts.net:3000`. | Cross-machine / cross-network access. |
| `/etc/hosts` (or Windows `hosts`) | Add `<host-ip>  airelay.local` on each client. | LAN-only, no Tailscale. |

**Container networking.** Compose uses `bridge` networking with an explicit port map (`3000:3000`) so the host can be addressed by either DNS path. Host-network mode is *not* required and is avoided for portability between Linux and Windows Docker Desktop.

**Config implications.**

- `BIND_HOST` env var, default `0.0.0.0` — must bind all interfaces, not loopback.
- `PUBLIC_BASE_URL` (optional) — used only for log lines and the `/health` payload so operators see the canonical URL, never for routing.
- No code reference to `localhost` anywhere. Tests use `127.0.0.1` via supertest's in-process binding only.

**Healthcheck.** Docker `HEALTHCHECK` uses `wget -qO- http://127.0.0.1:${PORT}/health` (loopback inside the container — no DNS dependency).

---

## 6. Concurrency Design

The proxy must handle an unbounded, unknown number of parallel requests without head-of-line blocking, memory blowup, or event-loop stalls. Node is single-threaded but I/O-concurrent — sufficient for a passthrough proxy *if* every sync trap is avoided.

**Hot-path rules.**

1. **Nothing synchronous on the proxy hot path.** No `appendFileSync`, no `JSON.parse` of payloads, no compression. The logger (`fs.appendFileSync`) is used only for app-level events (startup, cron, errors) — never per proxied request. Per-request observability goes through `metrics.record()` only.
2. **No buffering of bodies.** `http-proxy` streams request and response. Byte counters are incremented in `data` listeners — bodies are never accumulated. Critical for streaming AI responses (SSE / chunked).
3. **Allocations are bounded.** Ring buffer is a pre-allocated fixed-length array; `record()` overwrites the slot at `head` — no `push`/`shift`. Aggregator stores derived numbers, not events.
4. **Outbound HTTP agent is tuned for parallelism.** Single shared `http.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256, scheduling: 'lifo' })` passed to `http-proxy`. Default agent caps sockets and serializes excess.
5. **Graceful shutdown drains in-flight requests.** `server.close()` waits for active sockets; `SHUTDOWN_TIMEOUT_MS` (default 30s) gates the forced exit.

**SSE clients (UI side).**

- Hard cap `MAX_SSE_CLIENTS` (default 50). Evict oldest past the cap — protects against fd exhaustion via the dashboard.
- Non-blocking writes: if `res.write()` returns `false`, drop the next tick for that client rather than queue. The ring buffer is the source of truth; SSE is best-effort.
- Per-event metric stream throttled to `SSE_EVENT_RATE` events/sec (default 50). Aggregate ticks always go through.

**Resource ceilings.**

| Limit | Where | Default |
|---|---|---|
| OS file descriptors | Compose `ulimits: nofile: 65536` | 65536 |
| Node max headers | `--max-http-header-size=32768` | 32 KiB |
| Outbound socket pool | shared `http.Agent` | unbounded |
| In-flight request count | not capped — OS sockets + agent are natural backpressure | — |
| SSE clients | application-level | 50 |
| Metric ring buffer | application-level | 10 000 events |

**Explicitly NOT in v0.1.0:** clustering / worker_threads, request queueing, rate limiting. See roadmap.

---

## 7. Metric Event Schema

```json
{
  "ts": "2026-05-05T12:34:56.789Z",
  "method": "POST",
  "path": "/v1/messages",
  "status": 200,
  "durationMs": 1247,
  "bytesIn": 1284,
  "bytesOut": 9821,
  "upstream": "https://api.anthropic.com",
  "error": null
}
```

`bytesIn`/`bytesOut` come from `Content-Length` when present, else from passive `data` listener counters. `durationMs` = `proxyRes` timestamp − `proxyReq` timestamp. **No body content is captured** in v0.1.0 — that lands in v0.2 (token tracking, opt-in).

---

## 8. UI Plan

`public/index.html` has a tab strip:

```
[ Logs ] [ Metrics ]
```

The **Metrics** panel shows:

- **KPI cards:** Total req, RPS (1m), Error % (1m), p95 latency (1m)
- **Sparklines (Chart.js, CDN):** RPS over 5 min, p95 over 5 min, status-class stack (2xx/3xx/4xx/5xx)
- **Recent requests table:** last 200 events, sortable, row colored by status class
- **Connection pill:** mirrors the existing live/disconnected pattern but for the metrics SSE channel

Vanilla JS + Chart.js from CDN — no build step.

---

## 9. Phased Delivery (v0.1.0 only — see ROADMAP for v0.2+)

### Phase 1 — Proxy passthrough
- `http-proxy` dep + shared tuned `http.Agent`
- `src/proxy/proxy.js` wired into `server.js` at `PROXY_PATH_PREFIX`
- `BIND_HOST` plumbed into `app.listen`; nothing in code references `localhost`
- Compose: explicit port map, `ulimits.nofile`, `--max-http-header-size`, healthcheck via loopback
- **Done when:** an SDK pointed at `/proxy` reaches the AI provider unmodified, streaming responses work, `autocannon -c 100` shows no event-loop stalls.

### Phase 2 — Metrics collection
- `collector.js` ring buffer + `record()`
- Proxy hooks → `record()`
- `aggregator.js` rolling windows + 1s tick
- `GET /api/metrics/summary` and `GET /api/metrics/recent`
- **Done when:** synthetic load of 1000 req shows correct counts, status histogram, p95 within 5% of independently-measured truth.

### Phase 3 — Live UI
- Tab strip + Metrics panel HTML/CSS
- `public/metrics.js`: SSE consumer, KPI render, Chart.js sparklines, recent-requests table
- `GET /api/metrics/stream` (separate SSE channel)
- **Done when:** UI under live load shows RPS/latency updating ≤1s after each request.

### Phase 4 — Hardening
- Vitest: collector aggregation correctness, proxy passthrough byte-identity, error-path metrics, SSE client cap eviction
- `/health` extended with `upstreamReachable`, `inFlight`, `sseClients`, `eventLoopLagMs`
- Load + soak tests under `tests/load/`

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Body buffering accidentally introduced (breaks streaming AI responses) | Proxy mounted **before** `express.json`; integration test diffs request/response bytes against an echo upstream |
| Sync logger called on hot path stalls event loop under load | Proxy hot path uses `metrics.record()` only; `fs.appendFileSync` reserved for app-level events |
| Default outbound socket pool serializes parallel requests | Shared `http.Agent` with `keepAlive: true, maxSockets: Infinity` |
| FD exhaustion under sustained load + many SSE clients | `ulimits.nofile=65536` + `MAX_SSE_CLIENTS` cap with eviction |
| Slow SSE clients backpressure the broadcaster | Non-blocking writes; drop ticks per-client when kernel buffer full |
| High RPS overwhelms SSE event channel | Per-event stream throttled; aggregates always sent on 1s tick |
| Ring buffer GC churn at scale | Pre-allocated fixed-length array, ring-pointer pattern |
| Upstream provider down → cascade failures | Proxy `error` hook returns 502 fast and records `error`; circuit-breaker out of v0.1.0 scope |
| Container bound to loopback by accident | `BIND_HOST` defaults to `0.0.0.0`; integration test asserts non-loopback bind |
| `X-Forwarded-*` is technically a "modification" | Off by default (`PROXY_TRUST_FORWARDED=false`); opt-in only |
| AI providers use streaming (SSE / chunked) heavily | Constraint #2 makes this a first-class requirement; verified by an SSE-echo upstream in tests |

---

## 11. Provider Compatibility

### Verified to work

| Provider | `UPSTREAM_URL` | Auth header | Streaming |
|---|---|---|---|
| Anthropic | `https://api.anthropic.com` | `x-api-key` + `anthropic-version` | SSE — works |
| OpenAI | `https://api.openai.com/v1` | `Authorization: Bearer …` | SSE — works |
| Google Gemini | `https://generativelanguage.googleapis.com` | `x-goog-api-key` (or `?key=…`) | chunked — works |
| OpenRouter | `https://openrouter.ai/api/v1` | `Authorization: Bearer …` | SSE — works |
| Self-hosted (HTTP/HTTPS) | any host:port | provider-defined | depends on upstream |

The proxy is host-agnostic: it forwards bytes, only rewriting the `Host` header to match the upstream (`changeOrigin: true`). All authentication headers, vendor-specific headers (`anthropic-version`, `OpenAI-Organization`, etc.), query strings, and streaming semantics pass through unchanged.

### Known incompatibility: SigV4 (AWS Bedrock)

AWS Bedrock and any other API using **SigV4 request signing** are **not compatible** with this proxy as-designed. SigV4 binds the cryptographic signature to the request's `Host` header among other fields; because we rewrite `Host` for the upstream, the signature becomes invalid in flight. Making this work would require per-request re-signing inside the proxy, which means holding AWS credentials and parsing the request body — a significant architectural change.

If Bedrock support becomes important, the path forward is a v0.3+ "signing proxy mode" that:
- Holds AWS credentials (env-injected, never logged)
- Re-signs each forwarded request against the actual upstream
- Is opt-in per upstream profile (does not affect the simple passthrough mode)

Tracked in [../ROADMAP.md](../ROADMAP.md) under v0.4+ speculative.

### TLS verification

By default the proxy verifies the upstream's TLS certificate (`rejectUnauthorized: true`). Set `PROXY_INSECURE_TLS=true` only for self-signed dev upstreams — never for production AI providers.

---

## 12. Open Questions

Tracked in [../ROADMAP.md](../ROADMAP.md). Highlights:

1. Token & cost tracking will require body inspection (vendor-specific parsers, opt-in per route). Breaks the "zero parsing" invariant only on a buffered slow path that still streams to the SDK.
2. Persistent metric storage (SQLite) so restart doesn't wipe history.
3. Multi-upstream routing for codebases that hit more than one provider.
4. Auth on the dashboard — currently relies on the homelab/Tailscale ACL assumption.

---

## 13. Estimate (v0.1.0)

| Phase | Effort |
|---|---|
| 1 — Proxy passthrough | 0.5 day |
| 2 — Metrics collection | 1 day |
| 3 — Live UI | 1 day |
| 4 — Hardening | 0.5 day |
| **Total to v0.1.0** | **~3 days** |
