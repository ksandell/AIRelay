# Configuration Guide

Reference for every knob the proxy exposes. If you're installing for the first time, start with [INSTALL.md](INSTALL.md) — come back here when you need to tune something or add a second provider.

---

## Table of contents

- [Configuration model](#configuration-model)
- [The Setup tab](#the-setup-tab)
- [Environment variables](#environment-variables)
- [Provider recipes](#provider-recipes)
- [Wiring your SDK](#wiring-your-sdk)
- [DNS and hostnames](#dns-and-hostnames)
- [TLS](#tls)
- [Tuning for load](#tuning-for-load)
- [Production checklist](#production-checklist)

---

## Configuration model

All configuration is via **environment variables**. Two ways to set them:

| Method | When to use |
|---|---|
| `.env` file in the project root | Local Node and Docker dev. The `docker-compose.override.yml` file (auto-loaded in dev) reads this. |
| `docker-compose.yml` `environment:` block | Production Docker — env vars are baked into the compose stack. |

Precedence: shell environment > `docker-compose.yml` > `.env` > defaults from `src/config.js`.

The `.env.example` file is the canonical list — copy it to `.env` and edit.

---

## The Setup tab

When the dashboard starts and `UPSTREAM_URL` is empty (proxy disabled), a **Setup** tab appears in the top nav. It is a guided form that:

1. Asks which provider you want to proxy (Anthropic / OpenAI / Gemini / OpenRouter / Custom).
2. Asks a few server settings (path prefix, port, public hostname, TLS).
3. **Generates the exact `.env` file you need.** Click **Copy**, paste into your project's `.env`, restart the proxy.
4. Shows the SDK code snippet you'll paste into your application.

The Setup tab is **read-only** — it never writes to disk and never sees your API key. As soon as `UPSTREAM_URL` is set and the proxy is enabled, the Setup tab hides itself on next page load.

---

## Environment variables

Every variable, what it does, and when you'd touch it. Defaults match `.env.example`.

### Server

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP listen port. |
| `BIND_HOST` | `0.0.0.0` | **Do not change.** Binding to `127.0.0.1` makes the proxy unreachable from any other machine. |
| `NODE_ENV` | `development` | `production` skips `dotenv` loading and turns on production niceties. |
| `PUBLIC_BASE_URL` | _(unset)_ | Informational only — appears in `/health` and the dashboard footer. Has no effect on routing. |
| `TZ` | `UTC` | **Do not change.** All timestamps and rotation logic assume UTC. |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | How long to wait for in-flight requests to drain on `SIGTERM` before forced exit. |

### Proxy

| Var | Default | Notes |
|---|---|---|
| `UPSTREAM_URL` | _(unset)_ | The vendor API host the proxy forwards to. Empty = proxy disabled (returns 503 at the prefix). |
| `PROXY_PATH_PREFIX` | `/proxy` | All `/<prefix>/*` requests are forwarded. Strip the prefix off the inbound URL before forwarding. |
| `PROXY_TRUST_FORWARDED` | `false` | Add `X-Forwarded-*` headers. Off by default because adding headers is technically a modification. |
| `PROXY_INSECURE_TLS` | `false` | Disable upstream TLS cert verification. Use **only** for self-signed dev upstreams. |

### Metrics

| Var | Default | Notes |
|---|---|---|
| `MAX_METRIC_EVENTS` | `10000` | Ring buffer size — older events overwritten. ~10 minutes at moderate load. |
| `METRICS_TICK_MS` | `1000` | Cadence of aggregate broadcasts to the dashboard. Don't go below 250 ms. |

### Logs

| Var | Default | Notes |
|---|---|---|
| `LOG_DIR` | `./data/logs` | Where app log files live. Container default: `/data/logs` (persistent volume). |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |
| `LOG_RETENTION_DAYS` | `7` | Rotated files older than this are deleted. |
| `MAX_LOG_SIZE_MB` | `50` | If active log exceeds this, rotation triggers (checked every 5 min). |
| `CRON_SCHEDULE` | `0 0 * * *` | Daily rotation cron. UTC. |
| `ENABLE_COMPRESSION` | `false` | Future — gzip rotated logs. Currently a no-op. |

### SSE (live streams)

| Var | Default | Notes |
|---|---|---|
| `MAX_SSE_CLIENTS` | `50` | Hard cap on concurrent dashboard clients. Oldest is evicted on overflow. |
| `SSE_EVENT_RATE` | `50` | Per-event metric stream throttle (events/s). Aggregate ticks always go through. |
| `SSE_HEARTBEAT_MS` | `30000` | Keep-alive ping interval to prevent intermediary timeouts. |

### Token & Cost Tracking

The proxy can extract token usage from upstream responses and compute per-request cost in USD using a bundled pricing table. Tracking is response-only — request bodies are never inspected — and runs on a non-blocking tee of the response stream. If the response exceeds `PROXY_TOKEN_TEE_MAX_BYTES`, extraction is abandoned for that request and the base metric event is recorded without token/cost fields. Set `PROXY_TOKEN_TRACKING=false` to fully bypass the tee for v0.1-equivalent zero overhead.

| Var | Default | Notes |
|---|---|---|
| `PROXY_PROVIDER` | `generic` | Named providers (14): `anthropic`, `openai`, `google`, `mistral`, `groq`, `microsoft`, `openrouter`, `together`, `fireworks`, `deepseek`, `xai`, `perplexity`, `ollama`, `nvidia`. Fallback: `generic` (records bytes only — no token/cost fields). Selects the response parser and pricing table key. |
| `PROXY_TOKEN_TRACKING` | `true` | Set `false` to disable body inspection entirely (zero-overhead passthrough). |
| `PRICING_CONFIG_PATH` | _(unset)_ | Optional path to a JSON file that **deep-merges** over the bundled `config/pricing.json`. Use this to add models or override prices without forking. |
| `PROXY_TOKEN_TEE_MAX_BYTES` | `2097152` | Per-request body buffer cap (2 MiB) for token extraction. Larger responses skip extraction so big SSE streams don't pin memory. |

#### Provider setup examples

```env
# Anthropic
UPSTREAM_URL=https://api.anthropic.com
PROXY_PROVIDER=anthropic

# OpenAI
UPSTREAM_URL=https://api.openai.com/v1
PROXY_PROVIDER=openai

# Groq (OpenAI-compatible wire format, but pricing keyed under "groq")
UPSTREAM_URL=https://api.groq.com/openai/v1
PROXY_PROVIDER=groq

# Mistral (OpenAI-compatible wire format, but pricing keyed under "mistral")
UPSTREAM_URL=https://api.mistral.ai
PROXY_PROVIDER=mistral

# Ollama (local, $0 cost — pricing table has "*": {input:0, output:0})
UPSTREAM_URL=http://ollama-host:11434
PROXY_PROVIDER=ollama
```

> **OpenAI-compatible ≠ `PROXY_PROVIDER=openai`.** Mistral, Groq, Together,
> Fireworks, DeepSeek, Perplexity, OpenRouter all speak the OpenAI schema —
> their providers extend `OpenAIProvider` for extraction. But pricing is keyed
> by **provider name**, so picking `openai` for a Mistral upstream will extract
> tokens correctly and report `costUsd=0`. Always pick the provider that owns
> the model.

Cost shows as `$0.00` for Ollama since local inference is free; tokens are still counted and surfaced.

#### Pricing override

Prices are expressed in **USD per million tokens** (`$/MTok`). The bundled file lives at `config/pricing.json`; point `PRICING_CONFIG_PATH` at your own file to layer on top. Format:

```json
{
  "providers": {
    "anthropic": {
      "claude-sonnet-4-6": { "input": 3.00, "output": 15.00, "cacheWrite": 3.75, "cacheRead": 0.30 }
    },
    "openai": {
      "gpt-4o": { "input": 2.50, "output": 10.00 }
    }
  }
}
```

`cacheRead` and `cacheWrite` are optional (Anthropic prompt caching). The override is **deep-merged**: only the keys you specify are replaced, everything else from the bundled file is preserved. Use it to add new models, correct stale prices, or pin internal pricing for reimbursable tenants.

---

## Provider recipes

Drop these into your `.env`:

### Anthropic (Claude API)

```env
UPSTREAM_URL=https://api.anthropic.com
PROXY_PATH_PREFIX=/proxy
```

Your SDK keeps sending `x-api-key` and `anthropic-version` — the proxy forwards them.

### OpenAI

```env
UPSTREAM_URL=https://api.openai.com/v1
PROXY_PATH_PREFIX=/proxy
```

The `/v1` is part of the upstream URL so your SDK's `baseURL` ends at `/proxy`. The proxy concatenates: `/proxy/chat/completions` → `https://api.openai.com/v1/chat/completions`.

### Google Gemini

```env
UPSTREAM_URL=https://generativelanguage.googleapis.com
PROXY_PATH_PREFIX=/proxy
```

Gemini accepts the API key as `?key=…` query string or the `x-goog-api-key` header. Both are forwarded.

### OpenRouter

```env
UPSTREAM_URL=https://openrouter.ai/api/v1
PROXY_PATH_PREFIX=/proxy
```

OpenRouter is OpenAI-compatible — point any OpenAI SDK at it.

### Self-hosted upstream (HTTP)

```env
UPSTREAM_URL=http://upstream-host:8080
PROXY_PATH_PREFIX=/proxy
```

### Self-hosted upstream (HTTPS, self-signed cert)

```env
UPSTREAM_URL=https://upstream-host:8443
PROXY_PATH_PREFIX=/proxy
PROXY_INSECURE_TLS=true
```

Only use `PROXY_INSECURE_TLS=true` for genuinely self-signed dev upstreams. Real provider TLS certs always validate.

### NOT supported: AWS Bedrock

AWS Bedrock and any other API using **SigV4 request signing** are not compatible. The signature is bound to the request's `Host` header, which the proxy rewrites for the upstream. Supporting Bedrock would require holding AWS credentials and re-signing each request — see [ROADMAP.md](ROADMAP.md) v0.4+.

---

## Wiring your SDK

Once the proxy is running at `http://<your-host>:3000`:

### Anthropic SDK (Node.js)

```js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "http://airelay.local:3000/proxy",
});
```

### Anthropic SDK (Python)

```python
import anthropic
import os

client = anthropic.Anthropic(
    api_key=os.environ["ANTHROPIC_API_KEY"],
    base_url="http://airelay.local:3000/proxy",
)
```

### OpenAI SDK (Node.js)

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "http://airelay.local:3000/proxy",
});
```

### OpenAI SDK (Python)

```python
from openai import OpenAI
import os

client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"],
    base_url="http://airelay.local:3000/proxy",
)
```

### Plain `curl`

```bash
# Anthropic
curl http://airelay.local:3000/proxy/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}'

# OpenAI
curl http://airelay.local:3000/proxy/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
```

The proxy never reads or stores your API key — it forwards the entire request, headers and body, byte-for-byte.

---

## DNS and hostnames

The proxy is reached by **DNS name + port**, not `localhost`. Three options:

### Option 1: Tailscale MagicDNS (recommended for teams)

1. Install [Tailscale](https://tailscale.com/download) on the host running the proxy.
2. Run `sudo tailscale up` (Linux) or sign in via the GUI (Windows/macOS).
3. The host is now reachable at `<host>.<your-tailnet>.ts.net:3000` from any device on your tailnet.
4. (Optional) Set a friendlier name in the Tailscale admin console.

The proxy needs no Tailscale-specific config — it just binds to `0.0.0.0` and Tailscale handles routing.

### Option 2: hosts file (LAN-only)

On every machine that will call the proxy, add to `/etc/hosts` (Linux/macOS) or `C:\Windows\System32\drivers\etc\hosts` (Windows):

```
192.168.1.42  airelay.local
```

Replace `192.168.1.42` with the proxy host's LAN IP. Now `http://airelay.local:3000` resolves locally.

Editing the Windows hosts file requires running Notepad **as administrator**.

### Option 3: real DNS

If you have a DNS server or registrar, add an `A` record pointing `airelay.example.com` to your host's IP. No proxy-side change needed.

### Setting `PUBLIC_BASE_URL`

This is an **informational** field — it appears in `/health` and the dashboard footer so operators can see the canonical URL at a glance. It does **not** affect routing. Set it to whatever URL your team will use:

```env
PUBLIC_BASE_URL=http://airelay.tailnet.ts.net:3000
```

---

## TLS

### Inbound (clients → proxy)

The proxy speaks **plain HTTP** on `PORT`. There is no TLS termination built in. If you need HTTPS in front of the proxy:

- **Tailscale Funnel / serve** can put TLS in front of any tailnet service.
- **Caddy / nginx / Traefik** as a reverse proxy on port 443, forwarding to the AIRelay port.

### Outbound (proxy → upstream)

The proxy uses Node's default TLS verification — **on by default**. Real provider certs (api.anthropic.com, api.openai.com, etc.) all validate cleanly.

`PROXY_INSECURE_TLS=true` disables verification. Use only for self-signed dev upstreams. **Never set this for a real provider** — you'd be silently MITM-able.

---

## Tuning for load

The defaults handle hundreds of concurrent requests on a small VM. If you're running heavier:

| Knob | Symptom that suggests raising it | Cap |
|---|---|---|
| `MAX_METRIC_EVENTS` | Recent-requests view doesn't go back far enough | RAM-bounded; 100k uses ~30 MB |
| Docker `ulimits.nofile` | "EMFILE: too many open files" in app log | OS-dependent; set to 65536+ in compose |
| `MAX_SSE_CLIENTS` | Dashboard clients getting evicted | Each client = 1 fd; size with `ulimits` |
| `SSE_EVENT_RATE` | Live request feed feels laggy on high RPS | Aggregates always tick; events are best-effort |

For a load test: `npx autocannon -c 200 -d 30 http://airelay.local:3000/proxy/...` against a stub upstream. Watch `/health`'s `eventLoopLagMs` — should stay under 5 ms.

---

## Production checklist

Before pointing real production traffic at the proxy:

- [ ] `UPSTREAM_URL` matches the provider's official host (no typos)
- [ ] `PROXY_INSECURE_TLS=false` (the default) — confirm it's not been turned on accidentally
- [ ] `BIND_HOST=0.0.0.0` (the default) — required for any non-localhost access
- [ ] `PORT` is open in the host firewall (and not exposed to the public internet unless you've put auth in front)
- [ ] `TZ=UTC` — required for log rotation correctness across hosts
- [ ] Persistent log volume mounted (Docker: `log-data:/data/logs` is in `docker-compose.yml`)
- [ ] `docker compose ps` shows `restart: unless-stopped`
- [ ] Healthcheck passes: `curl http://localhost:3000/health` → `status: ok` and `proxy.upstreamReachable: true`
- [ ] Smoke test: a real SDK call goes through and shows up in the Metrics tab
- [ ] Streaming smoke test: a streaming request from your SDK actually streams (chunks arrive incrementally — not all at once at the end)
- [ ] Dashboard is **not** exposed to the public internet — there is no auth on it. Use Tailscale ACL, VPN, or a reverse proxy with auth.

---

## Capacity & Limits

These knobs control memory usage and throughput ceilings. All have safe defaults for homelab use.

| Env var | Default | What it limits |
|---------|---------|----------------|
| `MAX_METRIC_EVENTS` | `10000` | Ring buffer depth; oldest events evicted when full |
| `LOG_READ_MAX_MB` | `10` | Max bytes read per `/api/logs` or `/api/logs/history` call |
| `MAX_API_RESULT_ROWS` | `5000` | Max rows returned by `/api/logs` and `/api/metrics/recent` |
| `PROXY_MAX_BODY_PARSE_MB` | `10` | Request/response body size cap before token extraction is skipped |
| `MAX_SSE_CLIENTS` | `50` | Max concurrent SSE connections per hub (metrics + logs each) |
| `PROXY_REQUEST_IDLE_TIMEOUT_MS` | `120000` | Idle timeout for hung upstream connections (ms) |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | Graceful shutdown drain timeout (ms) |

**Memory estimate:** `MAX_METRIC_EVENTS × ~500 bytes ≈ 5 MB` at defaults. Increase `MAX_METRIC_EVENTS` for longer in-memory history.

**Tuning for high traffic:** Lower `PROXY_REQUEST_IDLE_TIMEOUT_MS` to reclaim connections faster; raise `MAX_METRIC_EVENTS` only if you have headroom. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for a runbook.

---

## See also

- [INSTALL.md](INSTALL.md) — first-time setup
- [README.md](README.md) — what this is
- [ROADMAP.md](ROADMAP.md) — what's coming
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture diagrams + design decisions
