# Changelog

All notable changes to AIRelay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Discrete error taxonomy in proxy error handler — `upstream_timeout` / `upstream_refused` / `upstream_reset` / `upstream_dns` / `tls` instead of opaque codes (closes #H6).
- Vitest coverage thresholds (`statements:80`, `branches:75`, `functions:80`, `lines:80`).
- Docker Compose log driver caps (`max-size:10m`, `max-file:5`) — bounds container log volume.

### Known limitations (tracked for v0.2.2)

These were surfaced by the 2026-05-06 deep analysis; fixes are tracked in
milestone [v0.2.2 — Stability](https://github.com/ksandell/AIRelay/milestone/4):

- Sync `appendFileSync` in request logger blocks the event loop on `/api/*` routes (#C1).
- Sync `readFileSync` / `readdirSync` on `/api/logs*` (#C2).
- Aggregator scans the ring buffer 3× per `/summary` call (#C3).
- Log rotation can race with concurrent `appendFileSync` (#C4).
- No idle watchdog on proxied requests — closures leak under hung upstream (#H1).

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
