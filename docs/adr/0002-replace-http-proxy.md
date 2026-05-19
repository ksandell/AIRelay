# ADR 0002 — Replace unmaintained `http-proxy`

- **Status:** Accepted (in principle); blocked on perf baseline before code lands
- **Date:** 2026-05-19
- **Milestone:** v0.4.2 (issue #127)
- **Decider:** repo maintainer

## Context

The proxy hot path uses `http-proxy ^1.18.1` (last release
[2020-10-13](https://www.npmjs.com/package/http-proxy)) via a single
module-scoped `createProxyServer` instance:

```js
// src/proxy/proxy.js
import httpProxy from 'http-proxy'

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  secure: false,
  ws: false,
  selfHandleResponse: false,
})

proxy.on('proxyRes', /* ... */)
proxy.on('error',    /* ... */)
proxy.web(req, res, { target, agent }, errCb) // per-request, target is route-dependent
```

`http-proxy` is the load-bearing component of AIRelay — every proxied byte
flows through it. CLAUDE.md states **the proxy hot path is hot path**:

> Proxy hot path has zero sync I/O — no appendFileSync, no JSON.parse of
> payloads, no compression. Bytes are never modified for non-opted-in traffic.

The library being unmaintained creates two risks:

1. **Security:** unpatched advisories in `http-proxy` or its transitive deps
   (this is partly why we keep eating `brace-expansion` audit churn).
2. **Node compatibility drift:** `http-proxy` predates Node 22 LTS. It works
   today but each Node bump is a fingers-crossed run of the E2E suite.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Stay on `http-proxy 1.18.1`** | Zero risk of behavior drift. Known-good with our E2E suite. | Unmaintained — risk accumulates. Already accruing audit churn through transitives. |
| **Swap to `http-proxy-3`** (community-maintained fork) | Drop-in API surface (`createProxyServer`, `web()`, same events). Active maintenance. Same Stream + Node `http` primitives — no new abstractions. | Fork divergence: must verify our specific event handlers (`proxyRes`, `error`) still receive the same arguments + that `selfHandleResponse: false` semantics are preserved. Smaller community than original. |
| **Swap to `node-http-proxy-3` or a different fork** | Some forks have additional features (websocket compression, etc.). | We use none of those features (`ws: false`). |
| **Hand-roll using `node:http`** | Zero deps, full control over the hot path. Removes a whole class of upstream-lib risk. | Significant code: streaming, error propagation, Host rewrite, `X-Forwarded-*` opt-in, error-callback signatures. High risk of subtle regression against the existing E2E + proxy test suite (~30 tests covering streaming, backpressure, error mapping). |

## Decision

**Swap to `http-proxy-3`** when a perf baseline confirms parity (req/s, p50,
p99 against a stub upstream). Hand-rolling is rejected for now — the
maintenance cost outweighs the dep risk while `http-proxy-3` exists and is
maintained.

## Rationale

- `http-proxy-3` is API-compatible with the surface we actually use
  (`createProxyServer`, `proxy.web(req, res, opts, errCb)`, `'proxyRes'` and
  `'error'` events). The swap should be a one-line import change in
  `src/proxy/proxy.js`.
- Per CLAUDE.md the hot-path invariants are **zero sync I/O, byte-identical
  passthrough, passive tee for token extraction in `queueMicrotask`**. None
  of these involve `http-proxy` internals — we never call `selfHandleResponse:
  true`. Drop-in risk is low.
- Hand-rolling would re-implement Host rewriting, agent injection,
  `selfHandleResponse=false` proxyRes piping, and error-callback signatures.
  Each is a footgun. We get no operational win for that work.

## Perf baseline — required before code merges

Capture against the in-repo fake upstream (`tests/e2e/fixtures/test-server.js`)
under `docs/load-test.sh` or equivalent:

| Metric | Current (`http-proxy 1.18.1`) | New (`http-proxy-3`) | Tolerance |
|---|---|---|---|
| req/s sustained, 64 concurrent, 60 s | _measure_ | _measure_ | within 5% |
| latency p50 | _measure_ | _measure_ | within 2 ms |
| latency p99 | _measure_ | _measure_ | within 5 ms |
| RSS @ steady state | _measure_ | _measure_ | within 10 MB |

If `http-proxy-3` regresses outside tolerance on any row, the swap is paused
pending investigation — do not merge on functional tests alone.

## Consequences

- Action: capture baseline numbers on `develop` HEAD into
  `docs/adr/0002-perf-baseline.md` (companion file, added with the swap PR).
- Action: open swap PR with `http-proxy ^1.18.1 → http-proxy-3 ^1.23.x`.
  Full `npm test` + `npm run test:e2e` + `npm run test:e2e:visual` required.
- Audit-fix churn around `brace-expansion` (via `test-exclude`) is unrelated
  to `http-proxy` itself — Dependabot (#138) will keep that current
  independently.
- Revisit "hand-roll on `node:http`" if `http-proxy-3` also becomes
  unmaintained.

## References

- [npm: http-proxy](https://www.npmjs.com/package/http-proxy) — last release
  2020-10-13, version 1.18.1
- [npm: http-proxy-3](https://www.npmjs.com/package/http-proxy-3) — active
  fork, 1.23.2 at decision time
- `src/proxy/proxy.js` — sole consumer
- `tests/proxy/` — regression suite the swap must pass unchanged
- CLAUDE.md "Hot-path invariants — do not violate"
