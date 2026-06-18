---
name: dashboard-settings-v060
description: Design spec for v0.6.0 — Dashboard landing tab + runtime Settings tab with live Compactor/Guardrail toggles
metadata:
  type: project
---

# v0.6.0 Design Spec — Dashboard + Runtime Settings

**Date:** 2026-06-18
**Version target:** v0.6.0
**Status:** Approved — ready for implementation

---

## Overview

Two new tabs added to the AIRelay dashboard:

1. **Dashboard** — new first tab (default landing page). Combines the most important health, cost, and activity signals from all tabs into a single view with actionable recommendations.
2. **Settings** — new last tab (always visible). Allows runtime toggling of all Compactor and Guardrail settings without restarting the server. Changes are persisted to `data/settings.json` and survive restarts.

---

## Navigation changes

**Before:**
```
[Logs*] [Metrics] [Compressors] [Guardrails]   (Setup hidden unless unconfigured)
```

**After:**
```
[Dashboard*] [Logs] [Metrics] [Compressors] [Guardrails]   [Settings]
```

- Dashboard is the new default tab (`active` on load, no proxy-check gate).
- Settings is always visible (replaces the hidden-unless-unconfigured Setup tab for runtime config). The initial Setup wizard flow remains for first-run onboarding.
- Hash routing: `#dashboard`, `#settings` added alongside existing hashes.

---

## Dashboard tab

### Layout — two columns

```
┌─────────────────────────────────────────────────────────┐
│  [KPI]  [KPI]  [KPI]  [KPI]                            │
├──────────────────────────────────┬──────────────────────┤
│  Activity chart (RPS + p95)      │  System health       │
│                                  │  ─────────────────── │
│  Recent requests table           │  Recommendations     │
│                                  │  ─────────────────── │
│                                  │  Jump to             │
└──────────────────────────────────┴──────────────────────┘
       2/3 width                          1/3 width
```

![Dashboard mockup](../screenshots/dashboard-mockup.png)

### KPI row (4 counters)

| Counter | Source | Notes |
|---|---|---|
| Requests today | `/api/metrics/summary` → `lifetime.total` (or day rollup if SQLite enabled) | |
| Cost today | Same, `lifetime.totalCostUsd` | |
| p95 latency | `window_1m.p95` | Live |
| Bytes saved | `/api/compactor/summary` → `lifetime.bytesSaved` as % | Only shown when Compactor enabled |

### Activity chart

- Dual-line sparkline: RPS (solid) + p95 latency (dashed), last 30 min.
- Data from SSE `tick` events — no extra endpoint needed.
- Matches the existing Chart.js integration in the Metrics tab.

### Recent requests table

- Last 5 proxied requests: time, model, tokens, cost, latency.
- "View all in Logs →" link switches to Logs tab.
- Data from `/api/metrics/recent` (already exists).

### System health sidebar

| Row | Source | States |
|---|---|---|
| Proxy | `/api/health` | ● OK (green) / ⚠ Degraded (amber) / ✕ Down (red) |
| Compactors | `/api/compactor/summary` → `enabled` + `compressors.active.length` | ● On (N of M active) / ○ Off |
| Guardrails | `/api/guardrails/summary` → `enabled` + `detectors.active.length` | ● On (N of M active) / ○ Off |
| In-flight | SSE `tick` → `inFlight` | count, live |

### Recommendations panel

Computed **client-side** from the fetched summary state — no dedicated backend endpoint. Rules:

| Condition | Recommendation |
|---|---|
| `guardrails.enabled === false` | ⚠ Guardrails disabled — enable at least alert mode → Settings |
| `compactor.enabled && !settings.toolResultOnly` | ℹ Tool-result-only off — tighter scope available → Settings |
| `health.proxy.enabled === false` | ✕ No upstream configured → Settings (Setup) |
| `health.status !== 'ok'` | ✕ Proxy health check failing — check upstream URL |

Recommendations link directly to the Settings tab (or specific tabs). Panel hidden when no recommendations.

### Quick links

Static links to switch to Metrics, Compressors, Guardrails, Logs tabs.

### Data fetching

On tab activation: parallel fetch of `/api/health`, `/api/metrics/summary`, `/api/metrics/recent`, `/api/compactor/summary`, `/api/guardrails/summary`. KPIs + sparkline update via existing SSE `tick` events (same connection used by Metrics tab).

---

## Settings tab

![Settings mockup](../screenshots/settings-mockup.png)

### Persistence model

- Changes write to **`data/settings.json`** (gitignored, created on first save).
- `.env` is **never modified**. Settings file is an overlay — loaded at startup after env vars, overrides win.
- No server restart required. Compactor/Guardrail modules read `config.*` per-request; the override layer propagates immediately.
- If `data/settings.json` is missing, defaults to empty (env vars are authoritative).

### Apply model

- UI tracks a `pendingChanges` diff object against the last-saved server state.
- Dirty state: amber "⚠ Unsaved changes" banner + Save / Discard buttons appear.
- **Save** — POST `/api/settings` with the diff, server responds with new effective config, banner clears.
- **Discard** — resets UI to last-fetched server state, banner clears.

### Compactors section

**Master toggle** — `COMPACTOR_ENABLED` override. When off, all sub-controls are visually disabled (not hidden — user can still preview config before enabling).

**Scope toggles** (2-column grid):

| Toggle | Env var |
|---|---|
| Request body | `COMPACTOR_REQUEST_BODY` |
| Response body | `COMPACTOR_RESPONSE_BODY` |
| Tool results only | `COMPACTOR_TOOL_RESULT_ONLY` |
| Allow risky ⚠ | `COMPACTOR_ALLOW_RISKY` |

**Individual compressors** — 2-column grid of all 10 compressors. Each card: name, one-line description, on/off toggle, `risky` badge where applicable. Off items dimmed (opacity 0.5). Controlled via `COMPACTOR_<NAME>_ENABLED` override.

### Guardrails section

**Master toggle** — `GUARDRAILS_ENABLED` override. When off, category cards are greyed out with note "Enable Guardrails above to configure detector modes."

**Category mode cards** (3 cards, one per category):

Each card shows: category name, brief description, 4-pill mode selector (off / alert / block / redact), accent border colour matches selected mode.

| Category | Env var | Detectors |
|---|---|---|
| Secrets | `GUARDRAILS_SECRETS_MODE` | AWS key, GitHub PAT, OpenAI key, Anthropic key, generic bearer… |
| PII | `GUARDRAILS_PII_MODE` | Email, phone, credit card, SSN, IP address… |
| Prompt Injection | `GUARDRAILS_INJECTION_MODE` | Injection patterns, jailbreak phrases… |

**Individual detectors** — 2-column grid of all 11 detectors. Each card: detector name, category label, on/off toggle. Controlled via `GUARDRAILS_<NAME>_ENABLED` override. Off items dimmed.

### Footer

> Saved to `data/settings.json` · Base `.env` never modified · No restart required

---

## Backend changes

### 1. `src/config.js` — override layer

```js
// New: mutable in-memory override store
let _overrides = {}

// Called once at startup
export async function loadOverrides() {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8')
    _overrides = JSON.parse(raw)
  } catch { _overrides = {} }
}

// Called by POST /api/settings
export async function applyOverrides(patch) {
  _overrides = { ..._overrides, ...patch }
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(_overrides, null, 2))
}

// All config.compactor.* and config.guardrails.* getters check _overrides first
export const compactor = {
  get enabled() { return _overrides.compactorEnabled ?? env.COMPACTOR_ENABLED === 'true' },
  // … etc
}
```

### 2. `src/api/settings.js` — new route

```
GET  /api/settings       → { effective: {...}, overrides: {...}, defaults: {...} }
POST /api/settings       → body: partial patch → applies + persists → 200 { effective }
```

Validation: only known keys accepted (whitelist). Unknown keys → 400.

### 3. `data/settings.json` — new file

Added to `.gitignore`. Schema:

```json
{
  "compactorEnabled": true,
  "compactorRequestBody": true,
  "compactorResponseBody": false,
  "compactorToolResultOnly": true,
  "compactorAllowRisky": false,
  "compactorAnsiStripEnabled": true,
  "guardrailsEnabled": false,
  "guardrailsSecretsMode": "alert",
  "guardrailsPiiMode": "redact",
  "guardrailsInjectionMode": "off",
  "guardrailsAwsAccessKeyEnabled": true
  // … etc
}
```

---

## Data flow — Settings save

```
User clicks Save
  → POST /api/settings { patch }
    → validate whitelist
    → applyOverrides(patch)          ← merges _overrides in memory (instant)
    → writeFile data/settings.json  ← async, non-blocking
    → return { effective }
  → UI receives new effective config
  → pendingChanges cleared, banner hidden
  → Compactor/Guardrails pick up new config on next request (no restart)
```

---

## Error handling

- `POST /api/settings` with unknown keys → 400 `{ error: 'Unknown setting key: foo' }`
- `POST /api/settings` with invalid value type → 400 `{ error: 'Invalid value for compactorEnabled: expected boolean' }`
- `data/settings.json` write failure → 500, in-memory override still applied (changes survive until next restart)
- Missing `data/settings.json` at startup → silently ignored, env vars authoritative

---

## Testing

- **Unit:** `src/config.js` override layer — `loadOverrides`, `applyOverrides`, getter fallback chain
- **Integration:** `GET /api/settings` returns correct merged config; `POST /api/settings` updates in-memory and writes file
- **E2E (Playwright):** Settings tab renders; toggle a compressor → dirty banner appears → Save → banner clears → re-fetch shows new state
- **Visual regression:** new Dashboard and Settings baseline screenshots (Linux + Windows)

---

## Out of scope for v0.6.0

- Proxy connection config (upstream URL, provider, prefix) — remains `.env`-only, requires restart
- Redis / caching — v0.7.0
- Per-user settings or multi-tenant config
- Settings export / import
