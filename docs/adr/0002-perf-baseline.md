# ADR 0002 — Perf baseline: `http-proxy` 1.18.1 → `http-proxy-3` 1.23.2

Companion to [ADR 0002](0002-replace-http-proxy.md). Captures the
before/after numbers that gate the proxy-lib swap (issue #127).

## Harness

`scripts/perf-baseline.mjs` — in-process fake upstream (constant ~250-byte
JSON response) + AIRelay `createApp()`, then 64 concurrent workers hammering
`POST /proxy/v1/chat/completions` for 10 s after a 1 s warmup. Keep-alive
agent. Token tracking enabled (`PROXY_PROVIDER=mistral`,
`PROXY_TOKEN_TRACKING=true`). Run on the same machine, back-to-back.

Command:

```
node scripts/perf-baseline.mjs --concurrency=64 --duration=10000
```

## Results

| Metric          | `http-proxy 1.18.1` (before) | `http-proxy-3 1.23.2` (after) | Δ        | Tolerance | Verdict |
|---              |---:                          |---:                            |---:      |---:       |---:     |
| Requests (10 s) | 32,704                       | 35,328                         | +2,624   | —         |         |
| **req/s**       | **3,270.4**                  | **3,532.8**                    | **+8.0%**| within 5% | ✅ better |
| **p50 (ms)**    | **17.17**                    | **15.09**                      | **−2.08**| within 2 ms | ✅ better |
| **p99 (ms)**    | **41.73**                    | **42.05**                      | **+0.32**| within 5 ms | ✅ pass |
| **Max RSS (MB)**| **192.4**                    | **193.8**                      | **+1.4** | within 10 MB | ✅ pass |
| Node            | v25.8.1                      | v25.8.1                        | —        | —         |         |

## Other observations

- `http-proxy 1.18.1` emits `DEP0060: util._extend` on every process start.
  `http-proxy-3 1.23.2` does not. Independent of the perf numbers, this
  removes a deprecation warning we'd eventually have to chase on a future
  Node bump.
- API surface used by `src/proxy/proxy.js` — `createProxyServer`,
  `proxy.web(req, res, opts, errCb)`, `'proxyRes'` and `'error'` events,
  `selfHandleResponse: false` — is byte-compatible. The swap was a one-line
  `import` change.
- Full vitest sweep (432/432) passes unchanged after the swap.

## Gate verdict

All four tolerances from ADR 0002 are met or improved. Swap **approved**
for merge.
