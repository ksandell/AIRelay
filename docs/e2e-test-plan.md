# AIRelay E2E Test Plan — Mistral upstream

Authoritative end-to-end test playbook for the dashboard + proxy. Uses **Mistral**
as the upstream provider:

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

## Pass criteria

- All scenario expectations met.
- `npm test` ≥ 193 passing.
- `npm run lint` clean.
- No console errors in dashboard.

## MCP execution notes

- Use `tabs_context_mcp { createIfEmpty: true }` to obtain a numeric `tabId`.
- Batch UI actions via `browser_batch` to avoid round-trip overhead.
- Read state via `javascript_tool` (returns JSON) — cheaper than screenshots.
- Take screenshots **only on failure**; full-page screenshots flood context.
- After each scenario, optionally hit `GET /api/metrics/summary` to assert
  numeric expectations server-side without needing the UI.
