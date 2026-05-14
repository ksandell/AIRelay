# Changelog

All notable changes to AIRelay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
