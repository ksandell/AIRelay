# ROADMAP

**Last updated:** 2026-05-05
**Owner:** K (PM + maintainer)
**Audience:** solo dev / homelab — small surface area, fast iteration, no enterprise gates.

This file is the source of truth for what's shipping, what's next, and what's parked. Architecture for the current release lives in [docs/proxy-metrics-plan.md](docs/proxy-metrics-plan.md).

---

## Vision

> An API proxy for AI that any codebase can point its SDK at, get observability + cost insight for free, and eventually grow into a smart caching/routing layer — without ever modifying the request bytes that hit the upstream.

Provider-agnostic. Self-hosted. One Docker container. No vendor lock-in on either side.

---

## Status snapshot

| Release | Status | Theme |
|---|---|---|
| **v0.1.0** | ✅ Done | Passthrough proxy + observability |
| **v0.2.0** | ✅ Done | Token & cost tracking |
| **v0.3.0** | ⚪ Planned | Persistence + multi-upstream |
| **v0.4.0+** | ⚪ Speculative | Caching, retries, routing intelligence |

---

## v0.1.0 — Passthrough + Observability  ✅

**Theme:** "Make my AI traffic visible without changing a byte."

### In scope

- Transparent HTTP passthrough at `PROXY_PATH_PREFIX` to a single `UPSTREAM_URL`
- Streaming-safe (SSE / chunked / large bodies pass through unchanged)
- Per-request metric event (method, path, status, durationMs, bytesIn, bytesOut)
- Ring buffer + rolling 1m / 5m / 15m aggregates (RPS, p50/p95/p99, error rate, status histogram)
- Live dashboard (vanilla JS + Chart.js) — KPIs, sparklines, recent-requests table
- Live SSE stream for both logs and metrics
- Structured JSONL app logs with daily rotation + 7-day retention + size guard
- Single-container Docker deployment, DNS-addressable, Tailscale-friendly
- `/health` includes upstream reachability + runtime stats

### Out of scope (deferred)

- Body parsing, token counting, cost accounting → v0.2
- Persistent metric storage → v0.3
- Multi-upstream / fallback / retries → v0.3 / v0.4
- Auth on the dashboard → relies on Tailscale ACL / network isolation for now
- WebSocket passthrough → noted in design, not in v0.1

### Definition of done

- SDKs (Anthropic, OpenAI, plain `curl`) work end-to-end against a real provider via the proxy
- Streaming response from the provider reaches the SDK with no buffering
- 1000-request synthetic load: counts correct, p95 within 5% of independent measurement
- 100 concurrent SSE dashboard clients + sustained proxy load: fd count, RSS, event-loop lag flat
- README quickstart works on a clean machine
- Docker healthcheck green

---

## v0.2.0 — Token & Cost Tracking  ✅

**Theme:** "Tell me how much each call cost — per request, per model, per day."

This is the first feature that requires looking *inside* requests and responses. We do this on a buffered slow path **without** changing the streaming SDK experience: the proxy still streams to the SDK; a parallel buffered copy is parsed for token/cost extraction after the response completes.

### In scope

- **Token extraction per request**
  - Anthropic Messages API: `usage.input_tokens`, `usage.output_tokens`, `usage.cache_*_tokens` (when present)
  - OpenAI Chat Completions / Responses: `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`
  - Streaming responses: parse the final `message_stop` / `[DONE]` / final-usage frame
  - Generic fallback: best-effort `tokens=null` rather than fail
- **Cost calculation**
  - Per-model price table (`config/pricing.json`) — input $/MTok and output $/MTok
  - Cache pricing (Anthropic cache reads/writes) when available
  - Manual override env var to disable cost calc per provider
- **Metric event extension** — adds `model`, `inputTokens`, `outputTokens`, `costUsd`
- **Dashboard additions**
  - Total $ spent (1m / 5m / 15m / since-boot)
  - Tokens per second
  - Per-model breakdown table (req count, tokens, $)
  - Top 10 most expensive recent requests
- **Provider profiles** — `PROXY_PROVIDER=anthropic|openai|generic` selects parser and price table; `generic` skips body inspection entirely (preserves v0.1 invariants)
- **Opt-out per route** — `PROXY_TOKEN_TRACKING=false` keeps v0.1 zero-parse behavior

### Open questions

1. Pricing data source — hand-curated `pricing.json` we update manually, or pull from a community list? (Lean: hand-curated, small surface, infrequent changes.)
2. Cache token semantics differ between Anthropic and OpenAI — unify into a single `cacheTokens` field, or keep provider-shaped?
3. How do we track $ across model migrations (e.g., `claude-sonnet-4-6` deprecates) — version the price table by date?

### Risks

- **Body parsing breaks streaming if done naively.** Mitigation: parse from a buffered copy that runs *after* the SDK has received the full response. Streaming path is untouched.
- **Hot-path overhead.** Mitigation: parsing happens in a microtask scheduled off the response-end event, not inline.
- **Pricing drift.** Mitigation: prices stamped onto each metric event so historical $ doesn't change retroactively.

### Definition of done

- Real Anthropic + OpenAI SDK calls produce accurate token counts (validated against the provider's own usage dashboard for a 100-req sample, ±0)
- Costs match the provider's billing line items within $0.01 over a 100-request sample
- Streaming responses still stream — SDK receives first byte at the same time as before
- Dashboard shows live $/min and per-model breakdown
- Documented opt-out works (zero parsing, zero cost overhead)

---

## v0.3.0 — Persistence + Multi-Upstream  ⚪

**Theme:** "Don't lose history on restart, and let one proxy fan out to multiple providers."

### In scope (candidates)

- **SQLite-backed metric history** — write every metric event to a local SQLite DB; UI gains "last 24h", "last 7d" views; ring buffer remains the live source of truth.
- **Multi-upstream routing** — per-prefix routing table, e.g. `/proxy/anthropic/* → api.anthropic.com`, `/proxy/openai/* → api.openai.com`. Per-route provider profile.
- **Dashboard route filter** — slice metrics by upstream / model.
- **Cost rollups** — daily/weekly summaries, CSV export.

### Open questions

1. SQLite WAL on Windows Docker volumes — known fsync quirks. Acceptance test required.
2. Multi-upstream config format — env vars only (string-encoded), or a separate YAML/JSON file?

---

## v0.4.0+ — Speculative

> Beyond this point, prioritization is loose. Items move up based on actual usage friction.

- **Response cache** — exact-match cache for deterministic prompts (`temperature=0`), opt-in per route. Big cost saver if the workload has repetition.
- **Smart retries** — automatic retry on `429` / transient `5xx` with exponential backoff. Honors `Retry-After`.
- **Model fallback chains** — primary `claude-sonnet-4-6` → fallback `claude-haiku-4-5` on overload.
- **Per-API-key budgets** — daily $ limit per inbound key with a 429 when exceeded.
- **WebSocket / Realtime API support** — `server.on('upgrade')` passthrough for OpenAI Realtime / similar.
- **Auth on the dashboard** — basic auth or OIDC, only if leaving the homelab.
- **Prompt redaction in stored logs** — opt-in masking for compliance scenarios.

---

## Explicitly NOT building

These are common asks that don't fit the proxy's value prop. Listed so we don't drift.

- A vendor SDK wrapper / SDK of our own. SDKs already exist; the proxy is invisible to them by design.
- A web chat UI. Out of scope — this is server-side infra, not a client.
- A request transformation engine (rewriting prompts, injecting system messages). Violates the "no modification" constraint.
- A self-hosted vector DB / RAG layer. Different product.
- Multi-tenant SaaS. The deployment model is one-container-per-team.

---

## Cadence & process

- **Releases** are dated tags (`v0.1.0`, `v0.2.0` …). No fixed cadence — ships when scope is done.
- **Branching:** trunk-based. Feature branches off `main`, merge via PR.
- **Issues** track everything below the release granularity. Roadmap items become epics.
- **This file** is updated at the start of each release with the previous release marked done and the new theme locked.

---

## Changelog pointer

Per-release notes will live in `CHANGELOG.md` once v0.1.0 cuts.
