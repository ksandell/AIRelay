# ROADMAP

**Owner:** K (PM + maintainer)
**Audience:** solo dev / homelab — small surface area, fast iteration, no enterprise gates.

This file is the source of truth for **what's planned** and **what's parked**.
For what already shipped, see [CHANGELOG.md](CHANGELOG.md).
For architecture see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Vision

> An API proxy for AI that any codebase can point its SDK at, get observability + cost insight for free, and eventually grow into a smart caching/routing layer. Default behavior is byte-identical passthrough; deliberate mutation (e.g. Compactor in v0.3.0) is always opt-in with per-request bypass.

Provider-agnostic. Self-hosted. One Docker container. No vendor lock-in on either side.

---

## Status snapshot

| Release | Status | Theme |
|---|---|---|
| v0.1.0 | ✅ Done | Passthrough proxy + observability |
| v0.2.0 | ✅ Done | Token & cost tracking (14 providers) |
| v0.2.1 | ✅ Done | E2E bug fixes + UI/UX polish |
| v0.2.2 | ✅ Done | Stability — async I/O, proxy hardening, test coverage |
| v0.2.3 | ✅ Done | Provider visibility — AnLinkAI added, Setup tab expanded to all 15 |
| v0.2.4 | ✅ Done | Cerebras provider — wafer-scale inference, 16th provider |
| v0.2.5 | ✅ Done | Log compression (#36) + provider directory (#101) |
| v0.2.6 | ✅ Done | v0.2.5 cleanup — gzip reader path, Windows rotation, Mistral pricing, docs (#104, #105, #106, #107, #108) |
| v0.2.7 | ✅ Done | Azure OpenAI adapter (api-key header + auto-appended `api-version` query) + tool-call E2E harness + chart y-axis precision fix |
| v0.3.0 | ✅ Done | **Compactor + Playwright E2E** — opt-in prompt compression (10 compressors, default-off) + automated Playwright tests across the dashboard (no Docker for CI) |
| v0.4.0 | ✅ Done | **Guardrails + Persistence + Multi-Upstream** — opt-in prompt safety (secrets / PII / injection detectors, alert/block/redact modes), opt-in SQLite metric history + rollups + CSV export, opt-in multi-upstream routing (per-prefix routes table), dashboard route filter / history window / CSV download, Compactor before/after gallery in docs |
| v0.4.1 | ✅ Done | **CI green** — committed Linux Playwright baselines (v0.4.0 shipped with win32-only baselines → CI red on `main`), added `Bless visual baselines` workflow + OS-pinning docs, bumped GH Actions to Node 24-compatible v5 majors |
| v0.4.2 | ✅ Done | **Dependency refresh + CI/security housekeeping** — Node 24 LTS, express 5, http-proxy-3, vitest/eslint/dotenv/fast-check/node-cron/playwright majors; Dependabot + CodeQL + Bless workflows; brotli/gzip token-extraction fix |
| v0.4.3 | ✅ Done | **CI: Linux Playwright baselines** — committed the 5 missing `*-visual-linux.png` baselines so the `ubuntu-22.04` visual e2e job is green; documented the OS-pinning gotcha in [docs/e2e-test-plan.md](docs/e2e-test-plan.md) |
| v0.5.0 | ✅ Done | **Zero-config provider routing** — single-upstream deployments auto-mount a `/proxy/<provider>` alias so SDKs pointed at the provider-named path work without writing `PROXY_ROUTES`; folds in the prior v0.4.next housekeeping (per-IP rate limiting on `/health` + `/api/*`, cleared CodeQL alerts, log-rotation TOCTOU fix, CodeQL Action `v3` → `v4`) |
| v0.6.0 | ✅ Done | **Dashboard + Settings + Dragonfly Cache** — landing dashboard tab (health, KPIs, cache hit rate, recommendations), Settings tab with live-toggle Compactors, Guardrails, and Cache; optional Dragonfly sidecar for exact-match response cache, request dedup, per-key spend limits, multi-instance SSE fan-out |
| v0.6.1 | ✅ Done | **Cache metrics + dashboard polish + security hardening** — cache outcomes persisted to SQLite, `/api/cache/history` + `/api/cache/rollups`, Cache tab sparklines, brand identity, secret query-param redaction, XSS fixes, full-SHA spend key |
| v0.6.2 | ✅ Done | **Window-aware KPIs + log UX + table fixes** — all KPI tiles on every page now reflect the selected time window; logs no longer blink on tab switch; log cap 100 entries; status column width fix; horizontal scroll on all table wrappers |
| v0.7.0 | ⚪ Queued | **Semantic Cache** — embedding-provider abstraction (OpenAI / Ollama), Dragonfly vector index bootstrap, KNN search, configurable cosine threshold; builds on v0.6.0 cache infrastructure |

Per-release detail in [CHANGELOG.md](CHANGELOG.md).

---

## v0.6.0 — Dashboard + Settings + Dragonfly Cache  ✅

**Done.** Full spec: [docs/superpowers/specs/2026-06-18-dashboard-settings-design.md](docs/superpowers/specs/2026-06-18-dashboard-settings-design.md).

### Navigation changes
- **Dashboard** tab — new first tab (default landing page).
- **Cache** tab — follows Guardrails; always visible, disabled state when `CACHE_ENABLED=false`.
- **Settings** tab — new last tab (always visible); replaces hidden-until-unconfigured Setup for config tasks.

### Dashboard tab
Two-column layout: metrics + activity left (2/3), health + recommendations right (1/3).

- **KPI row** — requests today, cost today, p95 latency, bytes saved (Compactor, conditional), cache hit rate (conditional).
- **Activity chart** — RPS + p95 latency sparklines, last 30 min (live via SSE).
- **Recent requests table** — last 5 proxied requests with model, tokens, cost, latency.
- **System health sidebar** — Proxy, Compactors (on/off + count), Guardrails (on/off + count), Cache (connected/off/disconnected), in-flight.
- **Recommendations panel** — computed client-side. Includes cache-disconnected warning.
- **Quick links** — Metrics, Compressors, Guardrails, Cache, Logs.

### Settings tab
Runtime overrides for Compactors, Guardrails, and Cache. Proxy connection config remains `.env`-only.

- **Persistence** — `data/settings.json` (gitignored). No restart required.
- **Apply model** — staged locally; "Unsaved changes" banner + Save / Discard.
- **Compactors section** — master toggle + scope toggles + 10 compressor cards.
- **Guardrails section** — master toggle + 3 category mode cards + 11 detector cards.
- **Cache section** — master toggle + exact match on/off + TTL input + dedup on/off + spend limits on/off + daily/monthly $ inputs + SSE fan-out on/off.

### Cache (Dragonfly)
Optional Redis-compatible sidecar via Docker Compose profile `cache`. Default off; zero overhead when disabled.

- **Exact-match response cache** — normalize + SHA-256 request body → Redis key → stored response. On hit: return cached, skip upstream. TTL configurable. Bypass: `X-Cache: no-store`.
- **Request deduplication** — identical concurrent in-flight requests coalesce in-process to one upstream call; waiters get the same response.
- **Per-key spend tracking** — per-API-key-hash daily/monthly `INCR` counter; reject at 429 when budget exceeded.
- **Multi-instance SSE fan-out** — Redis pub/sub syncs metric `tick` events across replicas so all dashboard connections see the full picture.
- **Response headers** — `X-Cache: HIT|MISS|DEDUP|BYPASS|SPEND-REJECT`, `X-Cache-Age`, `X-Cache-Key`.
- **Graceful degrade** — Dragonfly absent or disconnected → all requests pass through unchanged; dashboard shows ✕ Disconnected.

### Backend changes
1. **`src/cache/`** — new module: `client.js`, `normalize.js`, `exact.js`, `dedup.js`, `spend.js`, `fanout.js`, `metrics.js`, `middleware.js`, `api.js`.
2. **`src/config.js`** — cache getters (9 new) checking `_overrides` first; Compactor/Guardrail getters already converted to this pattern.
3. **`src/api/settings.js`** — SCHEMA extended with 8 cache keys.
4. **`src/server.js`** — mount `cacheMiddleware` before proxy; register `cacheRouter`.
5. **`docker-compose.yml`** — Dragonfly sidecar (profile `cache`) + `CACHE_*` env vars.

---

## v0.7.0 — Semantic Cache  ⚪

**Queued.** Builds on the v0.6.0 cache infrastructure (Dragonfly connected, exact-match + dedup already in place).

- **Embedding provider abstraction** — `src/cache/embed.js` with `openai` and `ollama` backends. Configured via `CACHE_EMBED_PROVIDER`, `CACHE_EMBED_MODEL`, `CACHE_EMBED_API_KEY`.
- **Dragonfly vector index** — `FT.CREATE` bootstrap on first start; index dimension matches model output (`CACHE_EMBED_DIM`).
- **KNN search** — `FT.SEARCH ... KNN 1` on cache miss after exact-match lookup; cosine ≥ `CACHE_SEMANTIC_THRESHOLD` (default 0.97) returns cached response.
- **`X-Semantic-Cache: off`** bypass header.
- **Semantic hit rate** surfaced as additional KPI on the Cache tab.
- **Settings** — semantic on/off toggle + threshold slider added to Cache section.

---

## v0.2.4 — Cerebras provider  ✅

**Shipped:** Cerebras as the 16th named provider. `CerebrasProvider` extends
`OpenAIProvider` (5-line subclass). Pricing: `llama3.1-8b` ($0.10/$0.10) and
`qwen-3-235b-a22b` ($0.60/$1.20). Setup tab under Fast inference, CONFIGURATION
recipe, README row. `pricing-completeness` test bumped to 16 required providers.
263 tests pass.

---

## v0.2.5 — Log compression + provider directory  ✅

**Shipped:** `ENABLE_COMPRESSION=true` now streams gzip rotated `app-YYYY-MM-DD.log` → `.log.gz` after rename; retention counts both. Active log never compressed. Added a "Provider directory" table in `CONFIGURATION.md` linking site/pricing/docs for all 16 named providers.

---

## v0.2.6 — v0.2.5 cleanup  ✅

**Shipped:** Fix-up release for the v0.2.5 gzip-rotation work. `/api/logs/available` and `/api/logs/history` now correctly enumerate and decode `.log.gz` rotated files (#104, #105). `rotateLogs()` is fully async so Windows no longer fails the rename under an open writable fd (#107). Added `mistral-medium-latest` and `open-mistral-7b` to pricing, plus a one-shot stderr warning the first time an unknown `provider:model` is looked up (#108). `CONFIGURATION.md` and `README.md` provider count corrected to 16 (#106).

---

## v0.4.2 — Dependency refresh + CI/security housekeeping  ✅

**Shipped** (closes GitHub milestone `v0.4.2 — Dependency refresh`, 16 PRs
landed: [#133](https://github.com/ksandell/AIRelay/pull/133)…[#146](https://github.com/ksandell/AIRelay/pull/146)).

No new product features. Brought every npm major current, replaced
unmaintained `http-proxy` with `http-proxy-3`, lifted the runtime to Node 24
LTS (Docker base + `engines.node`), and automated future dep bumps via
Dependabot. Hot-path invariants (zero sync I/O on the proxy path, SSE
streaming, raw-byte passthrough) preserved with a perf baseline before/after
the `http-proxy` swap.

Originally-deferred items — **`express` 4 → 5** and **Node 22 → 24 LTS** —
were pulled forward into this milestone after the upstream readiness checks
passed; v0.5.0 / v0.5.1 are now free of dep carry-over.

Two real bugs caught during release sign-off and fixed in-milestone:
- `bless-baselines.yml` YAML parse error (unindented heredoc inside `run: |`
  block scalar silently dropped the `workflow_dispatch` trigger).
- Token / cost metrics for non-streaming OpenAI-compatible responses
  (Mistral et al.) were silently null when the upstream returned a
  brotli- or gzip-compressed JSON body. Proxy now decodes `br` / `gzip` /
  `deflate` response bodies in the post-response `queueMicrotask`, off the
  hot path, before extraction.

Release notes: [CHANGELOG.md](CHANGELOG.md).

---

## v0.2.7 — Azure OpenAI adapter  ✅

**Shipped:** `PROXY_PROVIDER=azure` as the 17th named provider — OpenAI wire
format, distinct pricing block. The proxy auto-appends
`?api-version=YYYY-MM-DD` (from `AZURE_OPENAI_API_VERSION`, default
`2024-10-21`) when the SDK omits it; caller-supplied values are preserved
verbatim. Hot-path overhead: a single null comparison for every non-azure
deployment. Also ships `scripts/e2e-real-prompts.py` (15-call harness with
tool-call coverage) and a dashboard y-axis precision fix (`fmtAxis`).

### Deferred to v0.3.0+
- **Cohere** — custom `/v2/chat` schema. Real parser work; better to land alongside multi-upstream so it shares route-level provider profiles.

---

## v0.4.0 — Guardrails + Persistence + Multi-Upstream  ✅

**Shipped (closes [#35](https://github.com/ksandell/AIRelay/issues/35)):**

- **Guardrails:** opt-in prompt safety. Three independently configurable
  categories (secrets, PII, prompt-injection), each in one of four modes
  (`off` / `alert` / `block` / `redact`). 14 built-in detectors plus
  operator-defined custom patterns. Master switch `GUARDRAILS_ENABLED`
  (default off), per-request bypass via `X-Guardrails: off`, applied-marker
  response header, per-detector metrics + dashboard tab. Always-on log
  sanitizer (independent of master switch) strips secret-shaped tokens
  from persisted log entries. Reference: [docs/GUARDRAILS.md](docs/GUARDRAILS.md).
- **Multi-upstream routing:** routes table (JSON file or inline env JSON)
  per-prefix → upstream + provider + trustForwarded. Backwards-compatible
  fallback to single-route v0.3.0 config. Reference:
  [docs/ROUTING.md](docs/ROUTING.md).
- **SQLite metric persistence:** opt-in event store with WAL mode, batched
  write-behind, retention pruning. Unlocks `/api/metrics/history`,
  `/api/metrics/rollups`, and `/api/metrics/export.csv`.
- **Dashboard upgrade:** route filter dropdown, history window selector
  (Live / 5m / 10m / 15m / 30m / 1h / 3h / 6h / 12h / 24h / 7d — drives the
  recent table and the RPS / latency / token charts), CSV download button.
  Compactor docs gain a Before/After gallery with concrete byte+token
  savings per compressor.

Release notes: [CHANGELOG.md](CHANGELOG.md).

---

## v0.3.0 — Compactor + Playwright E2E  ✅

**Shipped:** Opt-in prompt compression via 10 deterministic compressors
(ansi-strip, blankline-collapse, diff-collapse, lockfile-drop, ls-long-shrink,
npm-noise-strip, repeat-line-dedupe, stacktrace-dedupe, long-file-elide,
base64-truncate). Master switch `COMPACTOR_ENABLED` (default off), per-request
bypass via `X-Compactor: off`, applied-marker response header, per-compressor
metrics surfaced on the **Compressors** dashboard tab + `/api/compactor/summary`
endpoint. Compose pre-plumbs all `COMPACTOR_*` env vars. Playwright E2E covers
Logs, Metrics, Compressors (+ hash-routed Setup) in ~8 s on CI without Docker;
visual-diff suite with OS-pinned baselines. Full reference:
[docs/COMPACTOR.md](docs/COMPACTOR.md). Release notes:
[CHANGELOG.md](CHANGELOG.md).

---

## Future — Compactor v2 + observability extensions  ⚪

**Theme:** "Smarter token accounting and richer dashboards."

### Candidates

- **Compactor v2** — real tokenizer for accurate token-savings reporting,
  streaming-request compression via incremental SSE rewriting, semantic
  compressors.
- **History-tab visualizations** — surface SQLite-backed history with charts
  (daily cost, model mix, top routes) rather than just the recent-events
  table.
- **Cost alerts** — daily $ thresholds with webhook / email notifications.

### Open questions

1. Tokenizer choice for Compactor v2 — `@anthropic-ai/tokenizer`, `tiktoken`, or per-provider WASM bundle?
2. History charts in vanilla JS or pull in a heavier chart toolkit?

### Recently shipped (v0.4.0)

The four sub-items below shipped as part of v0.4.0; see the v0.4.0 release
section above for details.

- SQLite-backed metric history ✅
- Multi-upstream routing ✅
- Dashboard route filter ✅
- Cost rollups + CSV export ✅

---

## Speculative

> Prioritization is loose. Items move up based on actual usage friction.

- **Smart retries** — automatic retry on `429` / transient `5xx` with exponential backoff. Honors `Retry-After`.
- **Model fallback chains** — primary `claude-sonnet-4-6` → fallback `claude-haiku-4-5` on overload.
- **WebSocket / Realtime API support** — `server.on('upgrade')` passthrough.
- **Auth on the dashboard** — basic auth or OIDC, only if leaving the homelab.
- **Guardrails v2** — response-side detectors (model-output PII / secret leakage), streaming-aware partial scans, per-category metrics splits by detector.
- **Compactor v2** — real tokenizer for accurate token-savings reporting, streaming-request compression via incremental SSE rewriting.

> Items promoted to committed versions: response cache + per-key budgets → **v0.7.0** (Redis / Semantic Caching).

> ✅ Shipped in v0.4.0: **prompt redaction in stored logs** (always-on log
> sanitizer in `src/guardrails/sanitizer.js`) and **opt-in body-level
> redaction / blocking** of secrets, PII, and injection patterns. See
> [docs/GUARDRAILS.md](docs/GUARDRAILS.md).

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

- **Releases** are dated tags (`vX.Y.Z`). No fixed cadence — ships when scope is done.
- **Branching:** trunk-based. Feature branches off `develop`, merge via PR.
- **Cutting a release:** follow [docs/RELEASING.md](docs/RELEASING.md).
