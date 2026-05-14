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
| v0.3.0 | ✅ Done | **Compactor + Playwright E2E** — opt-in prompt compression (10 compressors, default-off) + automated browser tests across all 4 dashboard tabs (no Docker for CI) |
| v0.4.0+ | ⚪ Speculative | Persistence + multi-upstream; Compactor v2 (tokenizer for real token-savings reporting, streaming-request compression via incremental SSE rewriting, semantic compressors); caching, retries, routing intelligence |

Per-release detail in [CHANGELOG.md](CHANGELOG.md).

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

## v0.3.0 — Persistence + Multi-Upstream  ⚪

**Theme:** "Don't lose history on restart, and let one proxy fan out to multiple providers."

### Candidates

- **SQLite-backed metric history** — write every metric event to a local SQLite DB; UI gains "last 24h", "last 7d" views; ring buffer remains the live source of truth.
- **Multi-upstream routing** — per-prefix routing table, e.g. `/proxy/anthropic/* → api.anthropic.com`, `/proxy/openai/* → api.openai.com`. Per-route provider profile.
- **Dashboard route filter** — slice metrics by upstream / model.
- **Cost rollups** — daily/weekly summaries, CSV export.

### Open questions

1. SQLite WAL on Windows Docker volumes — known fsync quirks. Acceptance test required.
2. Multi-upstream config format — env vars only (string-encoded), or a separate YAML/JSON file?

---

## v0.4.0+ — Speculative

> Prioritization is loose. Items move up based on actual usage friction.

- **Response cache** — exact-match cache for deterministic prompts (`temperature=0`), opt-in per route.
- **Smart retries** — automatic retry on `429` / transient `5xx` with exponential backoff. Honors `Retry-After`.
- **Model fallback chains** — primary `claude-sonnet-4-6` → fallback `claude-haiku-4-5` on overload.
- **Per-API-key budgets** — daily $ limit per inbound key with a 429 when exceeded.
- **WebSocket / Realtime API support** — `server.on('upgrade')` passthrough.
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

- **Releases** are dated tags (`vX.Y.Z`). No fixed cadence — ships when scope is done.
- **Branching:** trunk-based. Feature branches off `develop`, merge via PR.
- **Cutting a release:** follow [docs/RELEASING.md](docs/RELEASING.md).
