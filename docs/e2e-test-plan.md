# AIRelay E2E Test Plan

Two complementary layers:

| Layer | Tool | When | Cost |
|---|---|---|---|
| **Automated browser E2E** (new in v0.3.0) | Playwright + in-process test server | Every push to main; locally with `npm run test:e2e` | Free, ~30 s |
| **Visual regression** (new in v0.3.0) | Playwright `toHaveScreenshot()` | Every push to main (Linux baselines) | Free, ~30 s |
| **Backend integration** | vitest, real HTTP, fake upstream | Every push (already in `npm test`) | Free, ~10 s |
| **Manual real-LLM playbook** (this doc, below) | Human + real Mistral key | Before each release | Real API spend |

## Automated layer — Playwright

```bash
# Run functional E2E (browser flows across all 4 tabs)
npm run test:e2e

# Run visual regression (pixel diff vs committed baselines)
npm run test:e2e:visual

# Re-bless visual baselines after intentional UI changes
npm run test:e2e:visual:bless

# Interactive debug UI
npm run test:e2e:ui
```

Server boot is in-process: `tests/e2e/fixtures/test-server.js` spawns a
deterministic fake LLM upstream + AIRelay on port 3100. **No Docker required**
— Playwright's `webServer` block handles lifecycle. The fake upstream returns
a fixed Mistral-shaped chat completion so token + cost extraction populate
realistic numbers without spending real API budget.

Specs live under `tests/e2e/`:

```
tests/e2e/
├── fixtures/
│   ├── test-server.js     in-process bootstrap
│   └── seed-traffic.js    deterministic seeding helpers
├── functional/
│   ├── setup-tab.spec.js
│   ├── logs-tab.spec.js
│   ├── metrics-tab.spec.js
│   └── compactor-tab.spec.js
├── visual/
│   └── dashboard.visual.spec.js
└── __screenshots__/       Linux baselines, committed
```

Determinism techniques used:
- `?testMode=1` query param disables Chart.js animations and CSS transitions
  (see `public/app.js` `TEST_MODE` block + `style.css` `data-test-mode`).
- Fake upstream returns fixed token counts (`prompt:12, completion:2`) so
  KPI values are predictable across runs.
- `fullyParallel: false` + `workers: 1` because the in-process server has
  shared metrics-ring-buffer state.
- Visual diffs allow `maxDiffPixelRatio: 0.01` to absorb font-rendering noise.
- CI pins `ubuntu-22.04` to match committed baselines; locally on Windows
  visual diffs may be noisy — use `npm run test:e2e` (functional only).

### OS-pinned baselines (gotcha)

Playwright suffixes snapshot files with the OS (`*-visual-linux.png`,
`*-visual-win32.png`, `*-visual-darwin.png`). Blessing on one OS does **not**
cover the others — each platform you care about needs its own committed
baseline. AIRelay CI runs on Linux, so `*-visual-linux.png` is the
load-bearing set; `*-visual-win32.png` is a convenience for the maintainer's
local dev loop. (We learned this the hard way in [run 26108146650](https://github.com/ksandell/AIRelay/actions/runs/26108146650)
— v0.4.0 tagged with only win32 baselines, CI red on `main`. Backfilled post-v0.4.2.)

To regenerate Linux baselines after an intentional UI change:

1. Dispatch the **Bless baselines** workflow
   (`.github/workflows/bless-baselines.yml`) from the Actions tab on your
   branch.
2. Download the `visual-baselines-linux` artifact.
3. Diff against the committed PNGs by eye — if the change matches intent,
   replace `tests/e2e/visual/dashboard.visual.spec.js-snapshots/*-visual-linux.png`
   with the artifact contents and commit.

Equivalent local recipe (requires Docker):

```bash
docker run --rm -v "${PWD}:/w" -w /w mcr.microsoft.com/playwright:v1.60.0-jammy \
  bash -lc "npm ci && npm run test:e2e:visual:bless"
```

Pin the image tag to whatever `npx playwright --version` resolves.

## Chrome MCP visual scenarios (manual, real LLM)

A third layer for **operators with a Claude Code + Chrome MCP session**:
real LLM traffic, real Mistral, live dashboard inspection. Distinct from
the automated Playwright suite (which uses a fake upstream).

Runbook: **[compactor/scenarios.md](compactor/scenarios.md)**

Walks 6 bloated-payload scenarios (git diff with lockfile, `ls -l`, npm
install log, Node stacktrace, 600-line file, base64 image) and verifies
each targeted compressor fires on real data. Captures evidence screenshots
under `docs/compactor/evidence/` (not committed by default).

Use this as the final human-in-the-loop validation before tagging a release.

## Manual real-LLM playbook — Mistral upstream

Below is the legacy manual playbook. Use **only** before a release, when you
want to validate against the real provider:



```
UPSTREAM_URL=https://api.mistral.ai
PROXY_PROVIDER=mistral
PROXY_PATH_PREFIX=/proxy
PROXY_TOKEN_TRACKING=true
```

> **`PROXY_PROVIDER` MUST be `mistral`, NOT `openai`.** Even though Mistral
> speaks the OpenAI-compatible wire format, pricing in `config/pricing.json` is
> keyed by **provider name**. Setting `PROXY_PROVIDER=openai` extracts tokens
> correctly but reports `costUsd=0` because there is no `openai → mistral-*`
> entry. The `mistral.js` provider extends `OpenAIProvider`, so extraction
> logic is identical — only the pricing key differs.
>
> Cost assertions in S1/S3 will silently fail otherwise. Do **not** substitute
> another provider unless you also load a matching pricing file via
> `PRICING_CONFIG_PATH`.

Run this whenever the dashboard, proxy, or provider extraction code changes.

---

## Platform

**Docker Desktop** on Windows. The AIRelay container is the unit under test.

Restart the container to pick up env changes or a code rebuild:

```bash
npm run docker:down
npm run docker:up
```

`docker:up` auto-loads `docker-compose.override.yml` in dev, which mounts
`./src` and `./public` for live edits.

## Prerequisites

| Check               | Command                                        | Expected                                      |
| ------------------- | ---------------------------------------------- | --------------------------------------------- |
| Docker compose up   | `npm run docker:up`                            | container `airelay-app-1` healthy             |
| Health endpoint     | `curl -s http://localhost:3000/health \| jq .` | `status:"ok"`, `proxy.upstreamReachable:true` |
| Dashboard reachable | open `http://localhost:3000/`                  | renders, no console errors                    |
| Unit tests          | `npm test`                                     | 193+ pass                                     |

## One-time secret input

The only secret needed is `MISTRAL_API_KEY`. Export it in the shell that runs
the curl scenarios — **never** commit it, log it, or paste it into the
dashboard:

```bash
export MISTRAL_API_KEY="..."     # ask the user; do NOT hard-code
```

If the key is missing, scenarios S1–S4 are skipped; S5–S7 still run.

---

## Scenarios

### S1 — Plain chat completion

```bash
curl -sS -o "${TMPDIR:-/tmp}/s1.json" -w "%{http_code}\n" \
  -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral-small-latest","max_tokens":40,"messages":[{"role":"user","content":"say hi"}]}'
```

Expected:

- HTTP `200`
- Dashboard `#logs`: a new `POST /proxy/v1/chat/completions` entry with `200`, model badge `mistral-small-latest`, non-zero `↓ ↑` bytes.
- Dashboard `#metrics`:
  - `Prompt tok/s` and `Completion tok/s` cards both > 0 within 1–2 ticks.
  - `Bytes in (5 min)` and `Bytes out (5 min)` both > 0.
  - `Tool calls (1 min)` = `0` (no tools used).
  - Token chart draws Prompt + Completion lines.
  - Status pill `2xx` increments by 1.
  - Per-model row shows `mistral-small-latest` with provider `openai`, `requests:1`.

### S2 — Streaming chat

```bash
curl -sN -o "${TMPDIR:-/tmp}/s2.txt" -w "%{http_code}\n" \
  -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral-small-latest","stream":true,"max_tokens":40,"messages":[{"role":"user","content":"count to five"}]}'
```

Expected:

- HTTP `200`, body is SSE.
- Token chart updates within ≤ 2 s with rising completion line.
- Per-model row count increments to 2.

### S3 — Tool-call request

```bash
curl -sS -o "${TMPDIR:-/tmp}/s3.json" -w "%{http_code}\n" \
  -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"mistral-small-latest",
    "max_tokens":200,
    "tool_choice":"any",
    "tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],
    "messages":[{"role":"user","content":"what is the weather in Oslo?"}]
  }'
```

Expected:

- HTTP `200`, response body contains `choices[0].message.tool_calls`.
- Dashboard:
  - `Tool calls (1 min)` increments to `1` within ≤ 2 s.
  - Log entry lists the request normally.

### S4 — Tool-result follow-up

Capture `tool_calls[0].id` from the S3 response, then send a follow-up:

```bash
TOOL_ID=$(jq -r '.choices[0].message.tool_calls[0].id' "${TMPDIR:-/tmp}/s3.json")

curl -sS -o "${TMPDIR:-/tmp}/s4.json" -w "%{http_code}\n" \
  -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\":\"mistral-small-latest\",
    \"max_tokens\":80,
    \"messages\":[
      {\"role\":\"user\",\"content\":\"weather in Oslo\"},
      {\"role\":\"assistant\",\"tool_calls\":[{\"id\":\"$TOOL_ID\",\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"{\\\"city\\\":\\\"Oslo\\\"}\"}}]},
      {\"role\":\"tool\",\"tool_call_id\":\"$TOOL_ID\",\"content\":\"7C clear\"}
    ]
  }"
```

Expected:

- HTTP `200`.
- `Tool calls (1 min)` increments by ≥ 1 (counts the `role:tool` request block).

### S5 — Failure path (bad key)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer not-a-real-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"x"}]}'
```

Expected:

- HTTP `401`.
- Dashboard log shows red/4xx entry; status pill `4xx` +1; `Errors (1 min)` > 0.

### S6 — Past-date selection (regression)

UI: switch the date dropdown from `Live` to a stored date.

- Proxy filter checkbox disabled, label dimmed (opacity ≈ 0.4).
- Tooltip on the checkbox label: `Live only — proxy requests not stored on disk`.
- Switch back to `Live` → checkbox re-enabled.

### S7 — Clear button (regression)

UI: with at least one entry visible, click `Clear`.

- List empties; footer reads `0 entries`.

---

## Load test — S8

10 concurrent groups × 100 requests each (1 000 total). Random 1–2 s delay between
requests within each group. All groups fire in parallel.

```bash
# Run from the repo root — takes ~2.5 min
bash docs/load-test.sh
```

Expected (Mistral `mistral-small-latest`):

- All 1 000 requests return HTTP `200`.
- p50 ≤ 400 ms, p95 ≤ 600 ms.
- `errorRate` = 0 in the 5-minute window.
- `/api/metrics/summary` `.windows["5m"].byModel["mistral-small-latest"].requests` = 1 000.

### Reference run — 2026-05-06

| Metric | Value |
|---|---|
| Total | 1 000 / 1 000 ✓ |
| 200 OK | 100 % |
| p50 | 245 ms |
| p95 | 427 ms |
| p99 | 1 306 ms |
| Peak RPS | 3.33 |
| Tokens/s | 93.5 |
| Total cost | $0.0047 |

---

## Pass criteria

- All scenario expectations met (S6 requires ≥ 2 days of rotated logs).
- `npm test` ≥ 579 passing.
- `npm run lint` clean.
- No console errors in dashboard.

## DOM IDs (verified via `javascript_tool`)

| Element | Selector |
|---|---|
| Log list | `#logList` |
| Clear button | `#clearBtn` |
| Date select | `#dateSelect` |
| Proxy filter checkbox | `#filterProxy` |
| Status bar | `#statusBar` |

Available dates API: `GET /api/logs/available` → `{ active, rotated: [{date, sizeBytes}] }`

## MCP execution notes

- Use `tabs_context_mcp { createIfEmpty: true }` to obtain a numeric `tabId`.
- Batch UI actions via `browser_batch` to avoid round-trip overhead.
- Read state via `javascript_tool` (returns JSON) — cheaper than screenshots.
- Take screenshots **only on failure**; full-page screenshots flood context.
- After each scenario, optionally hit `GET /api/metrics/summary` to assert
  numeric expectations server-side without needing the UI.
