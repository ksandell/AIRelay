---
name: dashboard-settings-cache-v060
description: Design spec for v0.6.0 — Dashboard landing tab, runtime Settings tab, and Dragonfly response cache (exact-match, dedup, per-key spend, SSE fan-out)
metadata:
  type: project
---

# v0.6.0 Design Spec — Dashboard + Runtime Settings + Dragonfly Cache

**Date:** 2026-06-18
**Version target:** v0.6.0
**Status:** Approved — ready for implementation

---

## Overview

Three additions to AIRelay in v0.6.0:

1. **Dashboard** — new first tab (default landing page). Combines health, cost, activity, and cache signals from all subsystems into a single view with actionable recommendations.
2. **Settings** — new last tab (always visible). Runtime toggling of all Compactor, Guardrail, and Cache settings without restart. Persisted to `data/settings.json`.
3. **Dragonfly Cache** — optional Redis-compatible sidecar. Exact-match response cache, request deduplication, per-key spend limits, multi-instance SSE fan-out. Default off; zero overhead when disabled.

Semantic cache (embedding provider + vector search) is explicitly deferred to a future release; see ROADMAP.md.

---

## Navigation

**Before:**
```
[Logs*] [Metrics] [Compressors] [Guardrails]   (Setup hidden unless unconfigured)
```

**After:**
```
[Dashboard*] [Logs] [Metrics] [Compressors] [Guardrails] [Cache] [Settings]
```

- Dashboard is the new default tab (active on load, no proxy-check gate).
- Cache tab follows Guardrails; always visible, greyed out when `CACHE_ENABLED=false`.
- Settings is always last and always visible.
- Hash routing: `#dashboard`, `#cache`, `#settings` added alongside existing hashes.

---

## Dashboard tab

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  [Requests today]  [Cost today]  [p95 latency]  [Bytes saved*]  [Cache hit rate*]  │
├──────────────────────────────────────┬───────────────────────────┤
│  Activity chart (RPS + p95)          │  System health            │
│                                      │  ─────────────────────── │
│  Recent requests table               │  Recommendations          │
│                                      │  ─────────────────────── │
│                                      │  Jump to                  │
└──────────────────────────────────────┴───────────────────────────┘
         2/3 width                               1/3 width
```

`*` = conditionally hidden when the feature is disabled.

### KPI row

| Counter | Source | Shown when |
|---|---|---|
| Requests today | `/api/metrics/summary` → `lifetime.total` | Always |
| Cost today | Same, `lifetime.totalCostUsd` | Always |
| p95 latency | `window_1m.p95` (live via SSE) | Always |
| Bytes saved | `/api/compactor/summary` → `lifetime.bytesSaved` as % | `compactorEnabled` |
| Cache hit rate | `/api/cache/summary` → `lifetime.hitRate` as % | `cacheEnabled` |

### Activity chart

Dual-line sparkline: RPS (solid) + p95 latency (dashed), last 30 min. Fed by existing SSE `tick` events.

### Recent requests table

Last 5 proxied requests: time, model, tokens, cost, latency. "View all in Logs →" link.

### System health sidebar

| Row | Source | States |
|---|---|---|
| Proxy | `/api/health` | ● OK / ⚠ Degraded / ✕ Down |
| Compactors | `/api/compactor/summary` | ● On (N/M active) / ○ Off |
| Guardrails | `/api/guardrails/summary` | ● On (N/M active) / ○ Off |
| Cache | `/api/cache/summary` | ● Connected (N keys) / ○ Off / ✕ Disconnected |
| In-flight | SSE `tick.inFlight` | count, live |

### Recommendations panel

Computed client-side. Rules:

| Condition | Message |
|---|---|
| `guardrails.enabled === false` | ⚠ Guardrails disabled — enable at least alert mode → Settings |
| `compactor.enabled && !settings.compactorToolResultOnly` | ℹ Tool-result-only off — tighter scope available → Settings |
| `health.proxy.enabled === false` | ✕ No upstream configured → Settings |
| `health.status !== 'ok'` | ✕ Proxy health check failing — check upstream URL |
| `cache.enabled && !cache.connected` | ✕ Cache enabled but Dragonfly disconnected — check CACHE_REDIS_URL |

Panel hidden when no rules fire.

---

## Settings tab

### Persistence model

- Changes write to `data/settings.json` (gitignored, Docker volume safe).
- `.env` is never modified. Settings file is an overlay loaded at startup.
- No restart required; all runtime-settable features read `config.*` per-request.
- Connection-level vars (`CACHE_REDIS_URL`, `UPSTREAM_URL`, etc.) remain env-only.

### Apply model

- UI tracks `pendingChanges` diff against last-saved state.
- Dirty state: amber "⚠ Unsaved changes" banner + Save / Discard buttons.
- **Save** → POST `/api/settings` with diff → banner clears.
- **Discard** → reset UI to last-fetched state.

### Compactors section

Master toggle → 10 individual compressor toggles (2-column grid) + 4 scope toggles. Off items dimmed. Identical to v0.6.0 original spec.

### Guardrails section

Master toggle → 3 category mode cards (off/alert/block/redact) + 11 detector toggles. Category cards greyed when master off. Identical to v0.6.0 original spec.

### Cache section (new)

Only rendered when `CACHE_REDIS_URL` is configured (env var present); shown regardless of connected state so operator can toggle features.

**Master toggle** — `cacheEnabled` (runtime settable; requires Dragonfly to be reachable)

**Sub-controls** (disabled when master is off):

| Control | Key | Type | Default |
|---|---|---|---|
| Exact match | `cacheExactMatchEnabled` | boolean | `true` |
| TTL (seconds) | `cacheExactTtlSeconds` | integer | `3600` |
| Request dedup | `cacheDedupEnabled` | boolean | `true` |
| Per-key spend limits | `cacheSpendEnabled` | boolean | `false` |
| Daily limit ($) | `cacheSpendDailyLimitUsd` | number | — |
| Monthly limit ($) | `cacheSpendMonthlyLimitUsd` | number | — |
| SSE fan-out | `cacheSseFanoutEnabled` | boolean | `false` |

---

## Cache tab

Follows the Compressors/Guardrails tab pattern.

### KPI cards (1m + lifetime)

| KPI | Source |
|---|---|
| Requests from cache | `window_1m.exactHits` / `lifetime.exactHits` |
| Hit rate % | `lifetime.hitRate` |
| Bytes served from cache | `lifetime.bytesFromCache` |
| Dedup coalesced | `lifetime.dedupCoalesced` |
| Spend rejects | `lifetime.spendRejected` |

### Status row

Dragonfly: ● Connected / ✕ Disconnected  
Exact match: On / Off  
Dedup: On / Off  
Spend limits: On / Off  
SSE fan-out: On / Off

### Recent events feed

Last 20 events: type (HIT / MISS / DEDUP / SPEND-REJECT / BYPASS), key fingerprint (8-char SHA prefix), latency saved (ms), key age (s). Feed via `GET /api/cache/recent`.

### Spend panel

Shown when `cacheSpendEnabled`. Per-key-hash budget bar (daily / monthly usage vs limit). Keys shown as anonymized SHA-256 prefix (first 12 chars).

---

## Backend — cache module

### Files

```
src/cache/
  client.js      — ioredis singleton; lazy connect; graceful degrade when absent
  normalize.js   — strip stream/request-IDs before hashing; keep model/messages/tools/params
  exact.js       — SHA-256(normalized body) → GET/SET with TTL
  dedup.js       — in-process Map<sha256, Promise>; coalesce identical in-flight
  spend.js       — INCR per-key-hash daily/monthly counter; 429 gate before proxy
  fanout.js      — pub/sub tick re-publisher for multi-instance SSE
  metrics.js     — ring counters (hits, misses, dedup, spend rejects, bytes)
  middleware.js  — orchestrates all of the above; mounts before proxy in server.js
  api.js         — GET /api/cache/summary + GET /api/cache/recent
```

### Request pipeline (with cache)

```
Request → proxy prefix
  ↓ cache/middleware.js  (mounts BEFORE proxy — first in mount order)
  ├─ CACHE_ENABLED=false → next()  (zero overhead)
  ├─ SpendGate:  key-hash daily/monthly counter → 429 if over budget
  ├─ DedupCheck: in-process Map<sha256, Promise> → await if in-flight
  ├─ ExactMatch: SHA-256(normalized) → Redis GET → HIT: return + record
  └─ MISS: create dedup entry → next() → proxy runs
       → response end: tee body to Redis in queueMicrotask
       → resolve dedup entry so waiting requests get the response
```

### Config (env vars)

| Var | Default | Runtime-settable |
|---|---|---|
| `CACHE_ENABLED` | `false` | Yes |
| `CACHE_REDIS_URL` | `redis://dragonfly:6379` | No (env-only) |
| `CACHE_EXACT_MATCH_ENABLED` | `true` | Yes |
| `CACHE_EXACT_TTL_SECONDS` | `3600` | Yes |
| `CACHE_DEDUP_ENABLED` | `true` | Yes |
| `CACHE_SPEND_ENABLED` | `false` | Yes |
| `CACHE_SPEND_DAILY_LIMIT_USD` | — | Yes |
| `CACHE_SPEND_MONTHLY_LIMIT_USD` | — | Yes |
| `CACHE_SSE_FANOUT_ENABLED` | `false` | Yes |

`CACHE_REDIS_URL` is env-only; changing it requires restart (ioredis connects once at startup).

### API endpoints

```
GET  /api/cache/summary  → { enabled, connected, exactMatch, dedup, spend, fanout,
                              window_1m: { exactHits, exactMisses, dedupCoalesced,
                                           spendRejected, hitRate, bytesFromCache },
                              lifetime:  { ...same... } }
GET  /api/cache/recent   → [ { ts, type, keyPrefix, latencySavedMs, keyAgeS } ]
```

### Response headers

| Header | Value | When |
|---|---|---|
| `X-Cache` | `HIT`, `MISS`, `DEDUP`, `BYPASS`, `SPEND-REJECT` | All cached-path requests |
| `X-Cache-Age` | seconds since cached | On `HIT` |
| `X-Cache-Key` | first 8 chars of SHA-256 | On `HIT` |
| `X-Spend-Limit-Exceeded` | `daily` or `monthly` | On 429 spend rejection |

### Graceful degrade

When Dragonfly is absent or disconnected:
- `client.js` catches connection errors, sets `connected = false`.
- Middleware checks `connected` before every Redis operation; on false → `next()` immediately.
- No request is ever blocked by a missing cache — the proxy still works.
- `GET /api/cache/summary` returns `{ connected: false }` with zeroed counters.

### Settings schema additions

`src/api/settings.js` SCHEMA extended with:

```js
cacheEnabled:               'boolean',
cacheExactMatchEnabled:     'boolean',
cacheExactTtlSeconds:       'integer',
cacheDedupEnabled:          'boolean',
cacheSpendEnabled:          'boolean',
cacheSpendDailyLimitUsd:    'number',
cacheSpendMonthlyLimitUsd:  'number',
cacheSseFanoutEnabled:      'boolean',
```

`src/config.js` cache getters check `_overrides` first (same pattern as Compactor/Guardrails).

---

## Docker Compose — Dragonfly sidecar

Added to `docker-compose.yml` under the `cache` profile:

```yaml
dragonfly:
  image: docker.dragonflydb.io/dragonflydb/dragonfly:v1.26.2
  profiles: ["cache"]
  ports:
    - "6379:6379"
  volumes:
    - dragonfly-data:/data
  ulimits:
    memlock: -1
  restart: unless-stopped
```

Activated with: `docker compose --profile cache up`  
Or: `COMPOSE_PROFILES=cache docker compose up`

App service gets `CACHE_REDIS_URL: ${CACHE_REDIS_URL:-redis://dragonfly:6379}` and all `CACHE_*` vars plumbed through.

---

## Backend changes summary

1. **`src/cache/`** — new module (8 files, see above).
2. **`src/config.js`** — 9 new cache getters checking `_overrides` first.
3. **`src/api/settings.js`** — SCHEMA + ENV_DEFAULTS + `buildEffective()` extended with cache keys.
4. **`src/server.js`** — mount `cacheMiddleware` as first middleware before proxy; register `cacheRouter`.
5. **`src/index.js`** — `await initCacheClient()` after `loadOverrides()`.
6. **`docker-compose.yml`** — Dragonfly sidecar + `CACHE_*` env vars in app service.
7. **`docker-compose.override.yml`** — `CACHE_REDIS_URL` plumbed for dev.
8. **`.env.example`** — all `CACHE_*` vars with defaults.
9. **`CONFIGURATION.md`** — `CACHE_*` env var table + Dragonfly deployment recipe.
10. **`docs/ARCHITECTURE.md`** — `src/cache/` added to module map.
11. **`docs/OPERATIONS.md`** — Dragonfly health check + cache flush commands.
12. **`public/index.html`** — Cache tab button + panel.
13. **`public/app.js`** — Cache tab JS; Dashboard cache KPI tile + health row + recommendation.
14. **`public/style.css`** — Cache tab styles (reuses compressor-card/kpi patterns).

---

## Data flow — Settings save (cache example)

```
User toggles "Exact match" off in Settings
  → pendingChanges = { cacheExactMatchEnabled: false }
  → banner appears
  → Save clicked
  → POST /api/settings { cacheExactMatchEnabled: false }
    → applyOverrides(patch) — _overrides updated in memory
    → writeFile data/settings.json
    → return { effective }
  → next proxied request: cache/middleware.js checks config.cacheExactMatchEnabled → false
  → exact-match lookup skipped; dedup + spend still active
```

---

## Error handling

- Cache Redis errors → log warning, `connected = false`, graceful bypass (never blocks requests).
- Spend counter Redis error → log warning, allow request through (fail-open).
- Dedup `Promise` rejection → log, remove from Map, allow request through.
- `POST /api/settings` with `cacheExactTtlSeconds: "abc"` → 400 `{ error: 'Invalid value for cacheExactTtlSeconds: expected integer' }`.

---

## Testing

- **Unit:** `src/cache/normalize.js` — idempotent, strips stream field; `src/cache/exact.js` — SHA-256 stability; `src/cache/spend.js` — counter logic with mocked Redis.
- **Integration:** `GET /api/cache/summary` returns correct shape; `POST /api/settings` with cache keys updates in-memory; middleware gracefully degrades when Redis absent.
- **E2E (Playwright):** Cache tab renders when `CACHE_ENABLED=false` (disabled state); Settings cache section visible; Dashboard cache KPI hidden when disabled.
- **Visual regression:** Cache tab baseline + updated Dashboard baseline with cache KPI tile.

---

## Out of scope for v0.6.0

- Proxy connection config (upstream URL, provider, prefix) — remains `.env`-only, requires restart.
- Semantic / vector cache — deferred to future release (see ROADMAP.md).
- Per-user settings or multi-tenant config.
- Settings export / import.
