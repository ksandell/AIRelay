# Changelog

All notable changes to AIRelay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
