# AIRelay

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.0-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&logoColor=white)](docker-compose.yml)
[![Tests: Vitest](https://img.shields.io/badge/tests-vitest-6E9F18.svg?logo=vitest&logoColor=white)](https://vitest.dev)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)]()

**An API proxy for AI.** Sits between your codebase and any AI/LLM HTTP API (Anthropic, OpenAI, Gemini, OpenRouter, self-hosted). Forwards bytes unchanged. Surfaces live logs + per-request metrics in a browser dashboard.

> **What this is not:** a desktop chat client, a CLI assistant, or a browser extension. The target traffic is server-to-API SDK calls from a codebase.

---

## What you get

- **Transparent passthrough.** Streaming AI responses (SSE / chunked) flow through unmodified — your SDK doesn't know the proxy is there.
- **Live dashboard.** RPS, p50/p95/p99, error rate, status histogram, recent-requests table — updated in real time.
- **Guided setup.** First time you open the dashboard, a Setup tab walks you through generating the right `.env` for your provider.
- **Token & cost tracking** — per-request input/output tokens + USD cost for 14 providers (Anthropic, OpenAI, Google, Mistral, Groq, Microsoft, OpenRouter, Together, Fireworks, DeepSeek, xAI, Perplexity, Ollama, Nvidia)
- **Per-model breakdown** — cost/token aggregates via `/api/metrics/models`, sortable by spend
- **Single Docker container.** No DB, no Redis, no system cron. Bring `UPSTREAM_URL` and go.
- **Cross-platform.** Identical on Windows Docker Desktop, macOS, and Linux.

---

## 60-second quickstart

```bash
git clone https://github.com/<your-org>/airelay.git
cd airelay
cp .env.example .env
docker compose up --build
```

Open **`http://localhost:3000`** in a browser. If `UPSTREAM_URL` isn't set, the dashboard's **Setup tab** generates the `.env` you need — paste it in, restart, done.

Then point your SDK at `http://localhost:3000/proxy`:

```js
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "http://localhost:3000/proxy",
});
```

That's it. Every request now flows through the proxy and shows up on the dashboard.

---

## Going further

| If you want to… | Read |
|---|---|
| Install on Windows / macOS / Linux step-by-step | [INSTALL.md](INSTALL.md) |
| Configure env vars, providers, DNS, TLS | [CONFIGURATION.md](CONFIGURATION.md) |
| Understand the architecture | [docs/proxy-metrics-plan.md](docs/proxy-metrics-plan.md) |
| See what's coming next | [ROADMAP.md](ROADMAP.md) |

---

## Provider compatibility

| Provider | `UPSTREAM_URL` |
|---|---|
| Anthropic | `https://api.anthropic.com` |
| OpenAI | `https://api.openai.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Self-hosted | any HTTP/HTTPS endpoint |

**Not compatible:** AWS Bedrock and other SigV4-signed APIs (the proxy rewrites the `Host` header, which invalidates SigV4 signatures). See [CONFIGURATION.md](CONFIGURATION.md#not-supported-aws-bedrock).

---

## Supported Providers

Token & cost tracking is built in for 14 providers. Set `PROXY_PROVIDER` to enable per-request token extraction and cost calculation.

| Provider | `PROXY_PROVIDER` | Tokens | Cost |
|---|---|---|---|
| Anthropic Claude | `anthropic` | ✓ | ✓ |
| OpenAI | `openai` | ✓ | ✓ |
| Google Gemini | `google` | ✓ | ✓ |
| Mistral | `mistral` | ✓ | ✓ |
| Groq | `groq` | ✓ | ✓ |
| Microsoft Azure OpenAI | `microsoft` | ✓ | ✓ |
| OpenRouter | `openrouter` | ✓ | ✓ |
| Together AI | `together` | ✓ | ✓ |
| Fireworks | `fireworks` | ✓ | ✓ |
| DeepSeek | `deepseek` | ✓ | ✓ |
| xAI Grok | `xai` | ✓ | ✓ |
| Perplexity | `perplexity` | ✓ | ✓ |
| Ollama | `ollama` | ✓ | $0 (local) |
| Nvidia NIM | `nvidia` | ✓ | ✓ |
| _other_ | `generic` | — | — |

`generic` falls back to no extraction — bytes still pass through, but no token or cost data is recorded.

---

## Tech stack

Node.js 22+ · Express · `http-proxy` · vanilla JS dashboard with Chart.js · Vitest · Docker multi-stage (`node:22-alpine`).

---

## Contributing

1. Branch from `main`.
2. `npm run lint && npm test` must pass.
3. Conventional Commits (`feat:`, `fix:`, `chore:`, …).
4. PR with summary + test plan.

---

## License

[MIT](LICENSE) © 2026 Kim Sandell
