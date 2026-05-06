# ROADMAP

**Owner:** K (PM + maintainer)
**Audience:** solo dev / homelab — small surface area, fast iteration, no enterprise gates.

This file is the source of truth for **what's planned** and **what's parked**.
For what already shipped, see [CHANGELOG.md](CHANGELOG.md).
For architecture see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Vision

> An API proxy for AI that any codebase can point its SDK at, get observability + cost insight for free, and eventually grow into a smart caching/routing layer — without ever modifying the request bytes that hit the upstream.

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
| v0.2.4 | ⚪ Planned | Cerebras provider (OAI-compat, pricing entry only) |
| v0.2.5 | ⚪ Planned | Azure OpenAI adapter (api-key header + api-version query param) |
| v0.3.0 | ⚪ Planned | Persistence + multi-upstream |
| v0.4.0+ | ⚪ Speculative | Caching, retries, routing intelligence |

Per-release detail in [CHANGELOG.md](CHANGELOG.md).

---

## v0.2.4 — Cerebras provider  ⚪

**Theme:** "One more zero-effort provider while the catalog is hot."

- Add `cerebras` to `src/providers/registry.js` as a thin `OpenAIProvider` subclass.
- `config/pricing.json` entry for `llama-3.3-70b`, `qwen-3-32b` (rates per Cerebras pricing page).
- Setup-tab entry under **Fast inference** group.
- README + CONFIGURATION recipe.

**Effort:** ~1 hour. Pure addition, no parser work.

---

## v0.2.5 — Azure OpenAI adapter  ⚪

**Theme:** "First non-trivial provider — header + query rewrite hook."

OpenAI-compatible body schema, but:
- Auth header is `api-key: <key>` (not `Authorization: Bearer ...`).
- Requires `?api-version=YYYY-MM-DD` query param on every request.
- URL pattern is per-deployment: `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions`.

### Approach
- Small header-rewrite hook in `src/proxy/proxy.js` (kept off the byte-streaming hot path — only mutates request headers before `http-proxy` forwards).
- New env knob `AZURE_OPENAI_API_VERSION` (auto-appended if absent).
- `azure` entry in registry, pricing, and Setup tab.

**Effort:** ~½ day. First time we touch outbound headers; needs care to keep the "no body modification" invariant intact.

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
