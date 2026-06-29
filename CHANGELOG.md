# Changelog

All notable changes to AIRelay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.5] — 2026-06-29 — SSE rate-limit exemption + Dragonfly memory fit

### Fixed

- **Live dashboard no longer freezes after a request burst** — the SSE endpoints (`/api/metrics/stream`, `/api/logs/stream`) were mounted behind `apiRateLimiter`. EventSource auto-reconnects, so once a polling burst tripped the per-IP cap (429), the stream's own reconnect also got 429 and could never re-establish — the live charts and recent tables silently stopped updating until a full reload. The limiter now skips any `/stream` path.
- **Dragonfly no longer exits on boot on low-RAM hosts** — Dragonfly spawns one io thread per core and requires ~256MB/thread; on a many-core box with little free RAM the auto-computed `maxmemory` falls below the required total and the process exits immediately (`There are N threads, so X GiB are required. Exiting...`). The `dragonfly` compose service now pins `--proactor_threads=4 --maxmemory=1gb`; raise both as the cache grows.
- **Metrics live charts no longer stay blank after a tab switch** — the live RPS / latency / token charts (and their KPI sparklines) are seeded once and then driven by the SSE stream, but nothing resized them when the Metrics panel un-hid. Chart.js could latch a 0×0 size from when the panel was hidden, leaving the charts blank until the window selector forced a rebuild (switching to e.g. 5m suddenly painted data). Landing on the Metrics tab now resizes the charts on the next frame, mirroring the Cache panel.

## [0.6.4] — 2026-06-19 — Rate limiter crash fix

### Fixed

- **Rate limiter no longer hangs requests in Docker** — `express-rate-limit` with `standardHeaders: 'draft-8'` hashes `req.ip` as a partition key; when running behind Docker's bridge network without trust-proxy configuration `req.ip` is `undefined`, causing `Hash.update(undefined)` to throw a `TypeError`. The middleware threw before calling `next()`, leaving requests permanently pending and making the dashboard unreachable. Fixed with a safe `keyGenerator` fallback (`req.ip ?? req.socket?.remoteAddress ?? 'unknown'`).

## [0.6.3] — 2026-06-18 — Dashboard chart polish, version badge, logo crop

### Added

- **Version badge in header** — `v{version}` displayed in small muted text immediately to the right of the logo, populated from `/health` response on first load.

### Fixed

- **Activity chart bars now visible alongside RPS** — Warn (4xx) and Error (5xx) counts were rendered as raw counts (up to 1 400+) on the same axis as RPS (~4.5), making the RPS line invisible. Both are now normalized to req/s (÷60 in live mode, ÷bucketSec in history mode) so all three series share the same scale. Bars also stack (amber Warn/s on bottom, red Err/s on top).
- **Consistent number formatting** — new `fmtNum(v, decimals)` utility with non-breaking-space thousands separator (`1 234 567.89`) applied to all KPI tiles, table cells, token counts, and rate metrics across every page.
- **Logo pixel-perfect** — SVG `viewBox` tightened to actual content bounds (was 250×64 with ~14 px padding on all sides, now 178×39). PNG cropped to match. "AI" wordmark colour changed from muted gray to white.

## [0.6.2] — 2026-06-18 — Window-aware KPIs, log UX polish, table fixes

### Fixed

- **All KPI tiles now respect the time-window selector** — every KPI on every page (Dashboard, Metrics, Compactor, Guardrails, Cache) previously showed the in-memory 1-minute rolling window regardless of the selector. In history mode all tiles are now computed client-side from the fetched events array for the selected window (5m–7d). A new `computeWindowKpis(events, windowSec)` utility drives all five `renderXHistoryKpis` helpers. SSE `pushTick` skips KPI tile updates while a history window is active; only the instantaneous in-flight counter stays live.
- **Logs no longer blink on tab switch** — `loadLive()` was called every time the Logs tab was activated, wiping and rebuilding the full DOM. It now runs only on first visit when the buffer is empty; SSE delivers new entries incrementally.
- **Log line cap reduced 500 → 100** — `LOG_BUFFER_MAX` and fetch limits both reduced; users no longer scroll through hundreds of entries on load.
- **Log status column widened 52 → 74 px** — the grid column was too narrow for error labels "TIMEOUT" / "REFUSED", causing them to overflow into the message column.
- **Horizontal scroll on all table wrappers** — `overflow-x: auto` added to `#recentTable-wrap`, `#topCostTable-wrap`, `#compactorRecent-wrap`, `#guardrailsRecent-wrap`, `#cacheRecent-wrap`. Tables with more columns than the viewport now scroll instead of clipping.
- **Compactor / Guardrails / Cache history KPIs now accurate** — history refresh functions now fetch `/api/metrics/history` (limit 5000) in parallel with the page-specific history endpoint and derive KPI aggregates from actual event data instead of stale in-memory summary windows.

## [0.6.1] — 2026-06-18 — Cache metrics, dashboard polish, security hardening

### Added

- **Brand identity** — AIRelay logo (relay-chevron "motion trail" mark) with full asset set: gradient mark, monocolor mark, horizontal lockup, and favicon/app-tile (`svg` + `ico` + `png`) under `public/`. Wired into the dashboard header, README, and docs.
- **Cache outcomes persisted to the metrics DB** — four nullable columns on the `events` table (`cache_status`, `cache_key_prefix`, `cache_age_s`, `bytes_from_cache`), via the same idempotent migration as the compactor/guardrails columns. The cache middleware emits a full metrics event for every cache-served response (`HIT` / `DEDUP` / spend-reject), so cached traffic shows up in Metrics, Logs, recent feeds, and history exactly like a proxied request (zero cost, `cacheStatus` tagged). Proxied requests carry a `MISS` tag on their existing row — one event per request, no double-counting.
- **`GET /api/cache/history`** — per-event history over a time window, filtered to cache-tagged events, with optional `status=HIT|MISS|DEDUP`. Requires `METRICS_DB_PATH`.
- **`GET /api/cache/rollups`** — bucketed cache aggregates (`cacheHits`, `cacheMisses`, `cacheDedup`, `bytesFromCache`) at minute → week granularity.
- **Cache tab sparklines** — live 60-tick mini-charts on the 1-minute KPI cards (hits, hit rate, bytes from cache, dedup coalesced, spend rejects), matching the Compactor/Guardrails sparkline pattern.
- **Load-test script** — `docs/load-test.sh` sends concurrent Anthropic-shaped POST batches to the proxy for performance profiling.

### Fixed

- **Secret query params redacted from metrics DB** — provider keys passed as `?key=` / `?token=` / `?api_key=` in the upstream URL are stripped from the stored `path` field before writing to SQLite or SSE feeds.
- **Spend key uses full SHA-256** — `src/cache/spend.js` now stores the full 64-hex-char digest rather than a 16-char slice, eliminating birthday-collision risk at scale.
- **Cache canonical JSON uses `JSON.stringify`** — `src/cache/normalize.js` replaced manual string concatenation with `JSON.stringify` + a replacer that sorts keys recursively, preventing hash collisions from keys containing `"` or `\`.
- **XSS via unescaped `innerHTML`** — `escHtml()` now applied to compressor names, detector names, modes, categories, `filtersFired`, `detectorsFired`, and `bypassReason` in the Compressors and Guardrails table renderers.
- **Metrics DB migration validates column names/types** — `ALTER TABLE` now checks column names against `/^[a-z_]+$/` and types against a `TEXT/INTEGER/REAL` allowlist before executing.
- **Upstream URL removed from `/health` response** — `proxy.upstream` field removed to avoid leaking internal service addresses to unauthenticated callers.
- **Hermetic test env** — `tests/setup-env.js` + Playwright `webServer.env` pin the cache OFF so the unit + E2E suites don't inherit `CACHE_ENABLED` from a developer's local `.env`.
- **Dashboard activity sparkline** no longer grows unbounded (Chart.js resize feedback loop) — pinned canvas height.
- **Dashboard activity sparkline now populates** — the dashboard refreshes periodically while visible, so the RPS/p95 line accumulates points instead of rendering a single flat point taken on tab-open.
- **Dashboard recent-requests table** — added column spacing (Time / Model / Tokens / Cost / Latency previously ran together with no padding).
- **Dashboard KPI history fallback** — history endpoints return gracefully when persistence is off.
- **Dashboard LIVE dropdown persistence** — selected window survives tab navigation.
- **Log stream uncorked before end()** — fixes partial log delivery on large payloads.

### Changed

- UI font sizes scaled +10% for readability.

## [0.6.0] — 2026-06-18 — Dashboard + Settings + Dragonfly Cache

### Added

- **Dashboard tab** — new first tab (default landing page). KPI row (requests today, cost today, p95 latency, bytes saved, cache hit rate), activity sparkline (RPS + p95, last 30 min), recent requests table, system health sidebar (Proxy / Compactors / Guardrails / Cache / in-flight), recommendations panel (computed client-side), quick links.
- **Settings tab** — runtime toggles for all Compactor, Guardrail, and Cache settings. Changes staged locally (dirty banner + Save / Discard); persisted to `data/settings.json` (gitignored). No restart required; `.env` is never modified.
- **Cache (Dragonfly)** — optional Redis-compatible sidecar via Docker Compose profile `cache` (`docker compose --profile cache up`). Default off; zero overhead when disabled.
  - **Exact-match response cache** — normalize + SHA-256 request body → Redis key → stored response. On hit: skip upstream, return cached. TTL configurable (`CACHE_EXACT_TTL_SECONDS`, default 3600 s). Response headers: `X-Cache: HIT`, `X-Cache-Age`, `X-Cache-Key`. Bypass via `X-Cache: no-store`.
  - **Request deduplication** — identical concurrent in-flight requests coalesce in-process. Waiters receive the same response without an extra upstream call. `X-Cache: DEDUP`.
  - **Per-key spend limits** — per-API-key-hash daily/monthly `INCRBYFLOAT` counter in Redis. Requests 429 when budget exceeded. `X-Spend-Limit-Exceeded: daily|monthly`. Fails open on Redis error.
  - **Multi-instance SSE fan-out** — Redis pub/sub syncs metric `tick` events across replicas so all dashboard connections see the full picture.
  - **Cache tab** — KPI cards (1m / lifetime hits, hit rate, bytes from cache, dedup coalesced, spend rejects), status row (connected/off/disconnected + per-feature pills), recent events feed.
  - **Graceful degrade** — Dragonfly absent or disconnected → every request passes through unchanged; dashboard shows ✕ Disconnected.
- **`GET /api/cache/summary`** — cache status + connection state + per-window and lifetime counters.
- **`GET /api/cache/recent`** — last cache events ring buffer.
- **`GET /api/settings`** / **`POST /api/settings`** — runtime settings endpoint (Compactor + Guardrail + Cache keys). Changes applied in-memory immediately; persisted to `data/settings.json`.
- **`src/config.js` override layer** — `_overrides` loaded from `data/settings.json` at startup; all Compactor, Guardrail, and Cache `config.*` getters check overrides first.
- **9 new `CACHE_*` env vars** — documented in `CONFIGURATION.md` and `.env.example`.
- **Dragonfly Docker Compose sidecar** — pinned image `v1.26.2`; Compose profile `cache`; named volume `dragonfly-data`.
- **`docs/OPERATIONS.md`** — Dragonfly health check, flush, and restart commands.

### Changed

- **Navigation** — tab order is now: Dashboard · Logs · Metrics · Compressors · Guardrails · Cache · Settings.
- **`src/compactor/middleware.js`** / **`src/guardrails/middleware.js`** — `readBody()` checks `req._cacheBodyBuffer` before attaching stream listeners (body-buffer contract).
- **`src/proxy/proxy.js`** — `substituteBody` falls back to `req._cacheBodyBuffer` when no Compactor or Guardrails body is set.
- **`src/metrics/broadcaster.js`** — tick data published to Redis pub/sub when `CACHE_SSE_FANOUT_ENABLED=true`.
- **`ROADMAP.md`** — v0.6.0 expanded to include cache; v0.7.0 renamed to "Semantic Cache" (vector search only, builds on v0.6.0 cache infrastructure).

## [0.5.0] — 2026-06-04 — Zero-config provider routing

### Added

- **Provider-prefixed routing alias** — when a single upstream is configured the legacy way (`UPSTREAM_URL` + `PROXY_PROVIDER`), AIRelay now mounts a `<PROXY_PATH_PREFIX>/<provider>` alias alongside the bare prefix. An SDK pointed at `http://airelay.local:3000/proxy/mistral` reaches the upstream with **zero extra config** — previously the trailing `/mistral` was forwarded verbatim and the upstream returned a confusing 404. The bare `/proxy` path keeps working unchanged. Skipped for `provider=generic` (no meaningful name) and when the prefix already ends in the provider name. Explicit `PROXY_ROUTES` / `ROUTES_CONFIG_PATH` configs are never auto-aliased. See [docs/ROUTING.md](docs/ROUTING.md).
- **API rate limiting** — `/health` and `/api/*` routes are now capped per IP via `express-rate-limit` (`API_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`; default 600 req/min). The proxy hot path is never rate-limited and continues to absorb unbounded concurrency.

### Changed

- **CI: CodeQL Action `v3` → `v4`** ([#150](https://github.com/ksandell/AIRelay/issues/150)) — GitHub deprecates the v3 action in December 2026; `.github/workflows/codeql.yml` now pins `init`/`analyze` to `@v4`.
- **CI: `actions/checkout` + `actions/setup-node` `v4` → `v5`** ([#153](https://github.com/ksandell/AIRelay/issues/153)) — Node 20-based action majors are deprecated (runners force Node 24 from June 2026); bumped across `codeql.yml`, `e2e.yml`, `bless-baselines.yml`.

### Fixed

- **Log rotation TOCTOU** — `rotation.js` no longer does check-then-use (`existsSync` → `rename`/`writeFile`); it acts directly and handles `ENOENT`, closing a file-system race between the daily cron rotation and the size guard.
- **CodeQL code-scanning alerts cleared** — predictable temp-file paths in `tests/` replaced with `fs.mkdtempSync` private dirs; removed dead `makeDualLineChart` and an always-true guard in `public/app.js`.

## [0.4.3] — 2026-05-19 — CI: Linux Playwright baselines (the missing piece)

### Fixed

- **Visual e2e job green on `ubuntu-22.04`** ([#148](https://github.com/ksandell/AIRelay/pull/148)) — v0.4.0 shipped with only `*-visual-win32.png` baselines, so every Linux runner wrote actuals and the visual step failed all 5 dashboard specs. This commits the 5 missing `*-visual-linux.png` baselines generated inside `mcr.microsoft.com/playwright:v1.60.0-jammy` so they match the CI image exactly. (Salvaged from the now-closed [#119](https://github.com/ksandell/AIRelay/pull/119), with the obsolete v0.4.1 metadata dropped because v0.4.2 had already overtaken it.)

### Changed

- **`docs/e2e-test-plan.md`** documents the OS-pinning gotcha (Playwright suffixes baselines per-OS) and points at the already-shipped [.github/workflows/bless-baselines.yml](.github/workflows/bless-baselines.yml) for regenerating Linux baselines after intentional UI changes.

## [0.4.2] — 2026-05-19 — Dependency refresh + CI/security housekeeping

No new product features. Coordinated dep + housekeeping bump driven by an
audit of the Node.js runtime and npm dependencies. All hot-path invariants
(zero sync I/O on the proxy path, SSE streaming, raw-byte passthrough) were
preserved with a perf baseline before/after the `http-proxy` swap.

(Version `0.4.1` was skipped to align with the milestone label.)

### Added

- **Dependabot** weekly grouped npm + GitHub Actions + Docker base PRs ([#138](https://github.com/ksandell/AIRelay/pull/138)).
- **CodeQL** default JavaScript workflow ([#139](https://github.com/ksandell/AIRelay/pull/139)).
- **Bless visual baselines** workflow (`workflow_dispatch`) to regenerate the Linux Playwright snapshots from CI ([#143](https://github.com/ksandell/AIRelay/pull/143)).
- **`scripts/perf-baseline.mjs`** — quick before/after RPS + p95 harness used when swapping core libs ([#146](https://github.com/ksandell/AIRelay/pull/146)).
- **ADRs 0001 + 0002 + 0002-perf** documenting the `node-cron` and `http-proxy` replacement decisions and the perf gate ([#141](https://github.com/ksandell/AIRelay/pull/141), [#146](https://github.com/ksandell/AIRelay/pull/146)).

### Changed

- **Node.js 22 → 24 LTS** — Docker base bumped to `node:24.15-alpine3.22` (fully pinned, no floating tag) and `engines.node` bumped to `>=24.0.0` ([#140](https://github.com/ksandell/AIRelay/pull/140), [#144](https://github.com/ksandell/AIRelay/pull/144)).
- **`express` 4 → 5** — async error propagation, path-to-regexp v8 ([#145](https://github.com/ksandell/AIRelay/pull/145)).
- **`http-proxy` → `http-proxy-3`** — actively maintained fork; identical proxyRes hot-path semantics, perf baseline regression-free ([#146](https://github.com/ksandell/AIRelay/pull/146)).
- **`vitest` + `@vitest/coverage-v8` 3 → 4** ([#137](https://github.com/ksandell/AIRelay/pull/137)).
- **`eslint` 9 → 10** + fix new lint rules ([#134](https://github.com/ksandell/AIRelay/pull/134)).
- **`dotenv` 16 → 17** + parse-equivalence test ([#135](https://github.com/ksandell/AIRelay/pull/135)).
- **`fast-check` 3 → 4** ([#136](https://github.com/ksandell/AIRelay/pull/136)).
- **`node-cron` 3 → 4** ([#142](https://github.com/ksandell/AIRelay/pull/142)).
- **`@playwright/test` 1.49 → 1.60** + CI image bumped to `mcr.microsoft.com/playwright:v1.60.0-jammy` ([#133](https://github.com/ksandell/AIRelay/pull/133)).

### Fixed

- **`npm audit`** — moderate transitive `brace-expansion` advisory (GHSA-jxxr-4gwj-5jf2) resolved via `npm audit fix` ([#133](https://github.com/ksandell/AIRelay/pull/133)).
- **`.github/workflows/bless-baselines.yml`** — repair YAML parse error caused by an unindented heredoc inside a `run: |` block scalar, which silently dropped the `workflow_dispatch` trigger and made the workflow undispatchable.
- **Token / cost metrics for non-streaming OpenAI-compatible responses** (Mistral et al.) were not captured when the upstream returned a compressed JSON body. The proxy now decodes `br` / `gzip` / `deflate` response bodies in the post-response `queueMicrotask` (still off the hot path) before extraction. Streaming SSE was unaffected because servers skip compression for `text/event-stream`.

## [0.4.0] — 2026-05-19 — Guardrails + Persistence + Multi-Upstream

### Added

- **Multi-upstream routing** ([#35](https://github.com/ksandell/AIRelay/issues/35)) — opt-in routes table that fans one AIRelay instance out to multiple upstreams. Routes are configured via `ROUTES_CONFIG_PATH` (JSON file) or `PROXY_ROUTES` (inline JSON, env override). Each route has its own `prefix`, `upstream`, `provider`, and optional `trustForwarded`. Routes are sorted by descending prefix length so longer matches win. Backwards-compatible: when neither env is set, a single route is synthesized from `UPSTREAM_URL` + `PROXY_PATH_PREFIX` + `PROXY_PROVIDER` so v0.3.0 deployments work unchanged. Active routes exposed at `GET /api/metrics/routes`; per-event `route` field carried through metrics. Full reference in [docs/ROUTING.md](docs/ROUTING.md).
- **SQLite metric persistence** ([#35](https://github.com/ksandell/AIRelay/issues/35)) — opt-in event store via `better-sqlite3` (set `METRICS_DB_PATH` to enable). `collector.record()` calls `enqueue()` synchronously which pushes onto an in-memory queue; a flush timer drains it in batched transactions every `METRICS_WRITE_BATCH_MS` (default 1 s) or when the queue reaches `METRICS_WRITE_BATCH_SIZE` (default 100). Daily cron prunes events older than `METRICS_RETENTION_DAYS` (default 30). WAL mode, indexes on `(ts)`, `(route, ts)`, `(model, ts)`. Hot-path zero-disk-I/O preserved.
- **Time-range history + rollups + CSV export** ([#35](https://github.com/ksandell/AIRelay/issues/35)) — unlocked when persistence is on:
  - `GET /api/metrics/history?from=…&to=…&route=…&model=…&limit=…` — SQLite-backed event range
  - `GET /api/metrics/rollups?period=hour|day|week&…` — bucketed aggregates (requests, totalTokens, totalCostUsd, errors)
  - `GET /api/metrics/export.csv?from=…&to=…&route=…` — CSV download with all 21 canonical columns; falls back to the ring buffer when SQLite is off
- **Dashboard route filter + history window + CSV button** ([#35](https://github.com/ksandell/AIRelay/issues/35)) — Metrics tab gains a **Route** dropdown (populated from `/api/metrics/routes`), a **Time window** selector (Live / Last 5m / 10m / 15m / 30m / 1h / 3h / 6h / 12h / 24h / 7d), and a **CSV** download button that respects the current filters. The window drives both the recent-requests table and the RPS / latency / token charts (non-Live windows rebuild the charts from `/api/metrics/history` with adaptive bucketing); x-axis tick labels are `HH:MM:SS`, prefixed with `DD.MM.YYYY` only on day rollovers.
- **Guardrails** — opt-in prompt safety pipeline. Default off; preserves
  byte-identical passthrough when disabled. When enabled, JSON request bodies
  are scanned against built-in detectors for **secrets** (AWS / GitHub /
  Anthropic / OpenAI keys, JWTs, private keys, optional high-entropy),
  **PII** (email, phone E.164, credit-card with Luhn checksum, optional US
  SSN), and **prompt-injection** patterns (role-override, system-prompt-leak,
  tool-override). Three independently configurable modes per category:
  **alert** (record + forward), **block** (reject with HTTP 422),
  **redact** (replace match with `<redacted:NAME>` and forward). Block beats
  redact; redacted bodies are re-parsed as JSON and reverted on parse
  failure so requests are never broken. Full reference in
  [docs/GUARDRAILS.md](docs/GUARDRAILS.md).
- **Guardrails dashboard tab** with KPI cards (1m / lifetime requests
  scanned, hits, blocked, redacted, alerts, bypasses), per-detector counters
  - modes table, and a recent-events feed. Programmatic access at
    `GET /api/guardrails/summary` and `GET /api/guardrails/recent`.
- **Custom patterns** via `GUARDRAILS_CUSTOM_PATTERNS_FILE` — operator-
  defined regex catalog loaded once at startup; fails loud on malformed
  input.
- **Always-on log sanitizer** (`src/guardrails/sanitizer.js`) strips secret-
  shaped tokens (AWS keys, GitHub PATs, Anthropic/OpenAI keys, JWTs,
  `Bearer …`) from request URLs and error messages before they're persisted
  to logs or surfaced on the dashboard. Runs **even when
  `GUARDRAILS_ENABLED=false`** — the proxy must never write credentials to
  disk regardless of feature flags.
- **Per-request override** via `X-Guardrails: off|bypass|false` header.
  Header is stripped before forwarding upstream. Audit trail via response
  header `X-Guardrails-Applied: <detectors>`.
- **Safety model**: (a) default off, (b) per-request opt-out always honored,
  (c) body never broken (redact re-validates JSON), (d) block beats redact,
  (e) `GUARDRAILS_MAX_REQ_BYTES` (default 4 MiB) returns 413 on overflow,
  (f) non-JSON requests skipped, (g) detectors are pure / no I/O, (h)
  banner-to-the-model on `redact` mutation via a `_guardrails_banner` JSON
  field.
- **Tests**: 26 new guardrails tests — 9 sanitizer unit tests, 9
  scanner/redact tests (covering match correctness, Luhn validation, alert-
  vs-redact mode separation, safe-substring preservation), 8 end-to-end
  tests through the real proxy that verify redact mutation, byte-identical
  bypass via header, block mode rejection, alert-mode non-mutation, clean
  passthrough, lifetime metrics, summary endpoint shape, and 413 on
  oversize.
- **Config**: 17 new `GUARDRAILS_*` env vars — master switch, three
  category modes, buffering cap, 14 per-detector toggles, custom-patterns
  file path. All documented in
  [CONFIGURATION.md](CONFIGURATION.md#guardrails-v040) (including
  deployment presets for homelab / small-team / public) and
  [.env.example](.env.example).
- **Compactor Before / After gallery** in [docs/COMPACTOR.md §4.1](docs/COMPACTOR.md#41-before--after-gallery) —
  one concrete before/after example per compressor with exact byte counts
  - token estimates + risk notes, sourced directly from the property test
    fixtures. New pipeline-composition example showing cumulative savings
    when multiple compressors fire on a realistic `npm install` log.

### Fixed

- **Guardrails redact mode now passes through strict-schema upstreams.** The
  banner that announces which detectors fired is exposed as a new
  `X-Guardrails-Banner` response header instead of being injected into the
  forwarded JSON body as a `_guardrails_banner` top-level field. Mistral and
  OpenAI strict mode rejected the extra field with HTTP 422 `extra_forbidden`;
  the redaction itself was always correct, only the round-trip failed.
  Body bytes are now mutated only by the redaction replacements themselves.
- **Dashboard hash navigation activates the right tab.** Deep links such as
  `http://airelay.local:3000/#guardrails` worked on first paint but
  programmatic `location.hash` writes and browser back/forward did not flip
  panels — the Compressors and Guardrails tables appeared as all zeros even
  though server-side counters were populated. A `hashchange` listener now
  calls `activateTab()` for every hash transition.

### Changed

- **Hot-path invariant** extended: two opt-in mechanisms may mutate request
  bodies — Compactor (existing) and Guardrails (new in `redact` mode only).
  Both default-off. Documented in `CLAUDE.md`, `docs/ARCHITECTURE.md`.
- **`proxy.js`** now prefers `req._guardrailsBody ?? req._compactorBody`
  when forwarding via http-proxy's `buffer` option. When both features are
  disabled (default), this branch is never taken — zero overhead.
- **`middleware/requestLogger.js`** routes the request URL through
  `sanitizeUrl()` before persistence.
- **`middleware/errorHandler.js`** routes error messages + stack traces
  through `sanitize()` before persistence and before the response body.

### Docs

- New: [`docs/GUARDRAILS.md`](docs/GUARDRAILS.md) (11-section user
  reference: overview, quickstart, modes, detector catalog, banner,
  metrics, custom patterns, deployment presets, safety model, log
  sanitizer, troubleshooting).
- Updated: [`docs/COMPACTOR.md`](docs/COMPACTOR.md) with a new
  [§4.1 Before / After gallery](docs/COMPACTOR.md#41-before--after-gallery)
  — concrete examples + byte/token savings per compressor + pipeline
  composition.
- Updated: README.md (Guardrails callout + gallery link), CLAUDE.md
  (invariant table + docs index row), CONFIGURATION.md (full env-var
  table + deployment presets), ARCHITECTURE.md (new Guardrails module
  section + API surface), ROADMAP.md (moved "prompt redaction in stored
  logs" + related items to Shipped), `.env.example` (every `GUARDRAILS_*`
  var with default and one-line description).

## [0.3.0] — 2026-05-14 — Compactor + Playwright E2E

### Added

- **Chrome MCP visual scenarios runbook** ([scripts/compactor-mcp-scenarios.md](scripts/compactor-mcp-scenarios.md)) — manual playbook that fires 6 bloated-payload scenarios (git diff with lockfile, `ls -l`, npm install log, Node stacktrace, 600-line file, base64 image) against a real Mistral upstream to prove every compressor fires on real-world data, not just fixtures. Includes pass/fail gates and optional evidence-capture under `docs/compactor/evidence/`. Run after merge as the final human-in-the-loop release validation.
- **Playwright E2E framework** — automated browser tests across all 4 dashboard tabs (Setup, Logs, Metrics, Compactor) plus visual regression with OS-pinned baselines. 14 functional + 5 visual specs, 19 total tests, ~25 s end-to-end. In-process Node bootstrap (`tests/e2e/fixtures/test-server.js`) spawns a deterministic fake LLM upstream + AIRelay on port 3100 — **no Docker required for CI**. Determinism via `?testMode=1` (disables Chart.js animations + CSS transitions), seeded fake-token responses, and a `POST /api/test/reset` endpoint (gated by `NODE_ENV=test`). New scripts: `npm run test:e2e`, `npm run test:e2e:visual`, `npm run test:e2e:visual:bless`, `npm run test:e2e:ui`. CI workflow `.github/workflows/e2e.yml` runs vitest + Playwright on every push to main, retains traces + screenshots on failure. Full reference in [docs/e2e-test-plan.md](docs/e2e-test-plan.md).
- **Compactor** — opt-in prompt compression pipeline. Inspired by VSCode 1.120's `chat.tools.compressOutput.enabled` but applied proxy-side so any consumer of AIRelay benefits without SDK changes. Default off; preserves byte-identical passthrough for non-opted-in traffic. When enabled, parses the LLM request, walks provider-specific message shapes (Anthropic Messages, OpenAI Chat / Responses), runs a pipeline of 10 deterministic compressors on `tool_result` content (and optionally other text), and forwards the shrunk body upstream. Full reference in [docs/COMPACTOR.md](docs/COMPACTOR.md).
- **10 compressors**: `ansi-strip`, `blankline-collapse`, `lockfile-drop`, `diff-collapse`, `ls-long-shrink`, `npm-noise-strip`, `repeat-line-dedupe`, `stacktrace-dedupe`, `base64-truncate`, `long-file-elide` (risky). Each is independently toggleable via `COMPACTOR_<NAME>_ENABLED`. Per-compressor deep-dives under [docs/compactor/compressors/](docs/compactor/compressors/).
- **Per-request metrics**: bytes in, bytes out, bytes saved, estimated tokens saved (`bytes_saved / 4` heuristic — no tokenizer dep in v1), per-compressor µs latency, bypass reason. Surfaced on a new **Compactor** dashboard tab with KPI cards (1m / 5m / lifetime savings), per-compressor fires/bytes/avg-µs table, and a recent-events feed. Programmatic access at `GET /api/compactor/summary` and `GET /api/compactor/recent`.
- **Banner injection**: every mutated text segment is prefixed with `[compactor: applied filters=…; bytes …→…; set header X-Compactor: off to bypass]` so the model can see what changed and how to request raw output.
- **Per-request override** via `X-Compactor: on|off|bypass` header. Header is stripped before forwarding upstream. Audit trail via response header `X-Compactor-Applied: <filters>`.
- **Streaming bypass**: requests with `"stream": true` bypass Compactor entirely (no buffering, no first-byte-latency penalty) and emit a `compactor.streaming_bypass` counter + `X-Compactor-Applied: bypass-streaming` response header.
- **Safety model**: (a) default off, (b) per-request opt-out always honored, (c) `system` messages skipped unless `COMPACTOR_ALLOW_RISKY=true`, (d) risky compressors gated, (e) tool-result-only scope by default, (f) property-tested invariants (never grows, idempotent, safe-substring preservation), (g) banner-to-the-model, (h) response header audit trail.
- **Tests**: 58 compactor tests including 30 property-based runs (idempotence + never-grows + result-shape) across all compressors, 14 empirical fixture assertions, 9 safe-substring property tests, and 5 end-to-end tests through the real proxy that verify header opt-out, byte-identical bypass, streaming bypass behavior, lifetime metric recording, and the `/api/compactor/summary` shape.
- **Config**: 17 new `COMPACTOR_*` env vars including master switch, scope toggles, per-compressor toggles, buffer cap (`COMPACTOR_MAX_REQ_BYTES`, default 4 MiB), and long-file threshold. All documented in `CONFIGURATION.md` and `.env.example`.

### Changed

- **Hot-path invariant** restated: "bytes are never modified **for non-opted-in traffic**." Compactor is the explicit, operator-controlled exception. Updated in `CLAUDE.md`, `docs/ARCHITECTURE.md`.
- **`proxy.js`** now consults `req._compactorBody` and forwards the mutated buffer via http-proxy's `buffer` option when present. When Compactor is disabled (default), this branch is never taken — zero overhead.

### Docs

- New: [`docs/COMPACTOR.md`](docs/COMPACTOR.md) (11-section user reference: overview, quickstart, activation, catalog, banner, metrics, streaming, ops, safety, tuning recipes, troubleshooting).
- New: [`docs/compactor/compressors/<name>.md`](docs/compactor/compressors/) — one deep-dive per compressor (10 files), each with trigger heuristic, transform algorithm, before/after examples, known limitations, safety notes.
- Updated: README.md (Compactor callout), CONFIGURATION.md (full env-var table + provider-support matrix), ARCHITECTURE.md (new Compactor module section + API surface), CLAUDE.md (invariant qualification + docs index row), `.env.example` (every `COMPACTOR_*` var with default and one-line description).

## [0.2.7] — 2026-05-12 — Azure OpenAI adapter

### Added

- **Azure OpenAI Service** as the 17th named provider (`PROXY_PROVIDER=azure`). Speaks the OpenAI wire format and is parsed by the OpenAI extractor; pricing is keyed under `azure` so cost reporting is distinct from raw OpenAI. Bundled pricing covers `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1`, `o3-mini`.
- **`AZURE_OPENAI_API_VERSION` env var** (default `2024-10-21`). When `PROXY_PROVIDER=azure` and a request omits the `api-version` query param, the proxy appends it from this value before forwarding. Caller-supplied `api-version` is preserved verbatim (no double-append). Set the env var empty to disable auto-append. Implemented as a single null-comparison branch on the proxy hot path — zero overhead for every other provider.
- **`scripts/e2e-real-prompts.py`** — reusable real-traffic harness that fires 15 deliberate Mistral calls (5 short factual + 5 medium explanations + 5 tool-call prompts using `get_weather` and `calculate` tools). Drives the dashboard's tool-call KPIs, per-model breakdown, and cost extraction with authentic data.
- **Setup tab** lists Azure OpenAI Service under Frontier with a tailored SDK snippet (api-key header, auto-append note).
- **`pricing-completeness` test** now asserts 17 required providers (was 16).

### Fixed

- **Chart y-axis float-precision noise** in the dashboard. Tokens chart had been showing labels like `0.6000000000000001` and `0.39999999999999991` — IEEE-754 binary-float artifacts because the y-tick callback returned the raw number. New `fmtAxis` helper picks decimals from magnitude (≥10 integer, ≥1 → 1 decimal, ≥0.1 → 2 decimals, sub-0.1 → 2 significant figures so 0.0006 stays readable instead of collapsing to "0.00"). Applied to all three Metrics-tab charts.
- **Logs tab shows proxied-request history on first render.** The file-backed app log skips proxied traffic by design (zero sync I/O on the proxy hot path — see `CLAUDE.md`); proxied requests live in the metrics ring buffer instead. `loadLive()` now backfills from both `/api/logs` and `/api/metrics/recent`, merging by timestamp so historical proxy events appear immediately rather than only via live SSE arriving after the page loads. Also corrects a pre-existing ordering bug — the initial buffer was oldest-first while live `bufferAndRender` prepends newest-first; both paths now consistently put newest at the top of the DOM. Frontend-only change; no impact on the hot-path invariant.
- **Consistent timestamp format across Logs rows.** App-log rows had been rendering the raw ISO string (`2026-05-12T13:06:59.799Z`) while proxy rows used a short `HH:MM:SS`. `fmtTime()` is now the single helper for both, and it emits `YYYY-MM-DD HH:MM:SS.mmm` in the browser's local timezone via native `Date` getters (no external library) — sortable, copy-pasteable, ms-precise. Same format propagates to the recent-requests + top-cost tables that share the helper. Malformed timestamps fall back to an empty string so a bad event can't break the row.

### Docs

- `CONFIGURATION.md` provider count bumped to 17, env-var row for `AZURE_OPENAI_API_VERSION`, full Azure recipe, directory row with `azure` ↔ `microsoft` disambiguation note (the legacy `microsoft` alias remains for back-compat).
- `README.md` provider count 17, Azure row in the compat table.

## [0.2.6] — 2026-05-12 — v0.2.5 cleanup

### Fixed

- **`/api/logs/available` now lists `.log.gz` rotated files** (#104). The reader's filename filter was tightened to plain `.log` in v0.2.5; it now reuses the canonical `ROTATED_RE` exported from `src/logs/rotation.js`, so both `app-YYYY-MM-DD.log` and `app-YYYY-MM-DD[.N].log.gz` appear in `rotated[]`. Each rotated entry now carries a `compressed: boolean` flag for the dashboard.
- **`readHistoricLog` can read gzipped historic logs** (#105). On `?date=YYYY-MM-DD`, the reader scans the log directory for every matching part (`app-<date>.log`, `app-<date>.log.gz`, `app-<date>.N.log[.gz]`), streams each `.gz` part through `zlib.createGunzip()`, and enforces `LOG_READ_MAX_MB` against the **decompressed** byte count (aborts the stream early on overflow, so a gzip bomb cannot exhaust memory). Same-day re-rotation policy: all parts for the requested date are merged into one response sorted by mtime ascending — no `&part=N` query param needed.
- **Rotation no longer fails on Windows** (#107). `rotateLogs` previously called `redirectStream(active)` before `fs.renameSync(active, dest)`, opening a fresh writable handle while the rename targeted the same path. Windows holds an exclusive lock on any file with an open writable fd, so the rename failed silently. The file sink's `closeActiveStream()` is now truly async (awaits the `close` event), rename happens with no open handles, and the new active stream opens only after rename succeeds. Cron + size-guard callers were updated to `await rotateLogs()`.
- **Mistral pricing coverage** — added `mistral-medium-latest` ($0.40/$2.00 per 1M) and `open-mistral-7b` ($0.25/$0.25 per 1M) rows to `config/pricing.json`; previously these returned `costUsd=0` despite valid token usage. Source: mistral.ai/pricing. Pricing module now emits a one-shot stderr warning (`[pricing] unknown <provider>:<model> — counting tokens only`) the first time an unseen `provider:model` pair is looked up, so operators notice gaps (#108).
- `CONFIGURATION.md` and `README.md` named-provider count corrected from 15 to 16 post-Cerebras; inline list in `CONFIGURATION.md` now includes `cerebras` (#106).

## [0.2.5] — 2026-05-12 — Log compression + provider links

### Added

- **Gzip rotated logs** — `ENABLE_COMPRESSION=true` now actually compresses rotated `app-YYYY-MM-DD.log` files to `.log.gz` after rename. Active log is never compressed; compression streams via `zlib.createGzip()` so it never doubles disk usage. Retention cleanup counts both `.log` and `.log.gz` files (#36).
- **Provider directory** in `CONFIGURATION.md` — site / pricing / docs links for all 16 named providers (#101).

### Changed

- `CONFIGURATION.md` `ENABLE_COMPRESSION` row no longer says "no-op".

## [0.2.4] — 2026-05-06 — Cerebras provider

### Added

- **Cerebras** as the 16th named provider (`PROXY_PROVIDER=cerebras`). Wafer-scale inference platform; OpenAI-compatible wire format, reuses the OpenAI parser. Pricing entries for `llama3.1-8b` and `qwen-3-235b-a22b`.
- `CONFIGURATION.md` recipe block for Cerebras.
- README provider-compatibility table row for Cerebras.
- Setup tab now lists Cerebras under the Fast inference optgroup.

### Changed

- `pricing-completeness` test now asserts 16 required providers (was 15).

## [0.2.3] — 2026-05-06 — Provider visibility

### Added

- **AnLinkAI** as the 15th named provider (`PROXY_PROVIDER=anlinkai`). Private-beta SEA/MENA aggregator fronting Qwen + DeepSeek; OpenAI-compatible wire format, so it reuses the OpenAI parser and only carries its own pricing entries (`qwen-flash`, `qwen-3.5-flash`, `deepseek-chat`).
- Setup tab now surfaces **all 15 supported providers** (was 5), grouped Frontier / Aggregators / Fast inference / Self-hosted. Generated `.env` snippet now includes the matching `PROXY_PROVIDER` line so cost reporting works on first start.
- README provider-compatibility table expanded with `PROXY_PROVIDER` column for every supported upstream.
- `CONFIGURATION.md` recipe block for AnLinkAI with private-beta caveat and pricing override pointer.

### Changed

- `pricing-completeness` test now asserts 15 required providers (was 14).

## [0.2.2] — 2026-05-06 — Stability

### Added

- Per-request idle watchdog (`PROXY_REQUEST_IDLE_TIMEOUT_MS`, default 120 s) — hung upstream connections no longer accumulate indefinitely (#65).
- Discrete error taxonomy in proxy error handler — `upstream_timeout` / `upstream_refused` / `upstream_reset` / `upstream_dns` / `tls` / `client_abort` instead of opaque codes (#70, #H6).
- Performance & Limits section in `docs/ARCHITECTURE.md` (#84).
- Vitest coverage thresholds (`statements:80`, `branches:75`, `functions:80`, `lines:80`) (#72).
- Tests for `errorHandler` and `requestLogger` middleware (#73).
- Tests for SSE broadcaster: eviction, double-start guard, stop/restart (#74).
- Tests for idle watchdog and client abort (#75).
- Docker Compose log driver caps (`max-size:10m`, `max-file:5`) — bounds container log volume (#89).

### Changed

- Log writer switched from `appendFileSync` to async `WriteStream` with `cork`/`uncork` batching — zero sync I/O on app routes (#61).
- Log reader switched to `fs.promises`; 10 MB read cap; 5-second cache on available-listing endpoint (#62).
- Aggregator `summary()` performs a single ring-buffer scan for all three windows (was 3×); result memoized 1 second (#63).

### Fixed

- Log rotation race: write stream redirected to new path before `renameSync` so no writes land in the renamed file (#64).
- `startMetricsBroadcaster` double-start no longer leaks `tickHandle` (#71).
- Tee buffer nulled immediately on overflow, not deferred (#66).
- Load-test script: renamed `GROUPS`/`REQUESTS` variables to avoid collision with bash built-ins.

### Docs

- Metrics dashboard screenshot embedded in README.

### Known Limitations (v0.2.2)

- **H3 — No proxy backpressure:** A fast upstream feeding a stalled SSE client will accumulate data in Node.js write buffers. No `drain`/`pause`/`resume` flow control is applied on the downstream side. Planned for a future release.
- **H4 — Dual SSE eviction policies:** Metrics and log hubs use identical but separate eviction implementations. Consolidation into a single hub is deferred to v0.3.0.

## [0.2.1] — 2026-05-06 — E2E bug fixes + UI/UX polish + docs overhaul

### Added

- `docs/ARCHITECTURE.md` — canonical architecture reference with Mermaid diagrams (request lifecycle, module map, log rotation).
- `docs/RELEASING.md` — single release checklist; SSOT for the release process.
- Diverging tokens chart split into 4 stacked series: IN prompt tok/s, IN tool tok/s, OUT completion tok/s, OUT tool tok/s.
- Aggregator emits `toolInputTokensPerSec` and `toolOutputTokensPerSec` for tool-call-bearing requests.

### Changed

- Unified log panel; metrics IN/OUT split; token chart.
- Metrics dashboard reorganised: KPI tiles grouped into Cost / Throughput-tokens / Latency-errors / Derived sections; 10 sparklines added; status-pills row removed.
- New diverging Tokens chart (IN above zero, OUT below zero, symmetric Y, abs-value labels/tooltips).
- Derived KPIs surfaced from existing aggregator data: avg cost/req, avg tokens/req, cache hit rate, avg duration, in-flight, top model.
- Documentation overhaul — single-source-of-truth for version (package.json), release notes (this file), roadmap (ROADMAP.md), env vars (CONFIGURATION.md), architecture (docs/ARCHITECTURE.md). README and CLAUDE.md trimmed of duplicates.

### Fixed

- Various E2E-discovered bug fixes and UI/UX improvements.
- `PROXY_PROVIDER` documentation clarified — pricing is keyed by provider name, not wire format. Setting `PROXY_PROVIDER=openai` for a Mistral upstream extracted tokens fine but silently reported `costUsd=0`. `.env.example`, `CONFIGURATION.md`, and `docs/e2e-test-plan.md` now mandate `PROXY_PROVIDER=mistral` for Mistral.
- Log-level badge colors corrected (s2/s4/s5/err now use themed colors instead of gray).

### Removed

- `docs/proxy-metrics-plan.md` (superseded by `docs/ARCHITECTURE.md`).
- `docs/development-plan.md` (content covered in `CONFIGURATION.md` log retention section).

### Known Limitations

The following issues are present in v0.2.1 and fixed in v0.2.2:

- **C1** (`src/logs/logger.js`): `appendFileSync` on every app-route request stalls the event loop under disk pressure. Fixed in #61.
- **C2** (`src/logs/reader.js`): `readFileSync`/`readdirSync` block the loop on log endpoints; listing grows O(N) with retention. Fixed in #62.
- **C3** (`src/metrics/aggregator.js`): `/api/metrics/summary` performs 3 full ring-buffer scans per request. Fixed in #63.
- **C4** (`src/logs/rotation.js`): rotation race condition between `renameSync` and new-file creation can corrupt the log stream. Fixed in #64.
- **H1** (`src/proxy/proxy.js`): no per-request idle timeout — hung upstream accumulates closures indefinitely. Fixed in #65.

## [0.2.0] — Token & Cost Tracking

### Added

- Token extraction for 14 providers (Anthropic, OpenAI, Google, Mistral, Groq, Microsoft, OpenRouter, Together, Fireworks, DeepSeek, xAI, Perplexity, Ollama, Nvidia).
- Per-request cost calculation from bundled pricing config.
- `/api/metrics/models` endpoint — per-model cost breakdown.
- Aggregator rollups: `totalCostUsd`, `totalTokens`, `tokensPerSec`, `byModel` per window.
- Dashboard cost widgets: cost summary bar, per-model table, top-10 expensive requests.
- Configurable opt-out via `PROXY_TOKEN_TRACKING=false` (zero overhead).
- Custom pricing override via `PRICING_CONFIG_PATH`.
- Buffer tee cap via `PROXY_TOKEN_TEE_MAX_BYTES` (default 2 MB).

### Notes

- Streaming-safe buffer tee — passive observer, never touches client byte stream.
- Token extraction deferred to `queueMicrotask` after response completes.
- Anthropic cache token support (cacheRead, cacheWrite pricing).
- Tee skipped on 4xx/5xx and oversize bodies for memory safety.

## [0.1.0] — Initial Release

### Added

- Transparent passthrough proxy (Express + http-proxy).
- Live log + metrics dashboard via SSE.
- Pre-allocated metric ring buffer.
- Log rotation with retention.
- Docker multi-stage build, Tailscale/MagicDNS deployment.
