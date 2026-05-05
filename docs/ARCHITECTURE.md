# Architecture

Canonical architecture reference for AIRelay. All other docs link here — do not
duplicate diagrams or module descriptions elsewhere.

## Request lifecycle (proxied call)

```mermaid
sequenceDiagram
    autonumber
    participant SDK as App SDK
    participant Express as Express<br/>(server.js)
    participant Proxy as proxy.js<br/>(http-proxy)
    participant Agent as agent.js<br/>(http.Agent)
    participant Up as Upstream<br/>(Anthropic / OpenAI / …)
    participant Tee as Body tee<br/>(provider parser)
    participant Ring as collector.js<br/>(ring buffer)
    participant Bcast as broadcaster.js
    participant UI as Dashboard<br/>(SSE EventSource)

    SDK->>Express: POST /proxy/* (auth headers, body stream)
    Express->>Proxy: mount before json() — body never buffered
    Proxy->>Agent: shared keep-alive socket (maxSockets: ∞)
    Agent->>Up: forwarded request (bytes unchanged)
    Up-->>Proxy: response stream (SSE / chunked / JSON)
    Proxy-->>SDK: stream forwarded as-is
    Proxy->>Tee: passive copy (≤ PROXY_TOKEN_TEE_MAX_BYTES)
    Note over Tee: parsed in queueMicrotask<br/>after response end
    Tee->>Ring: record({status, bytes, tokens, costUsd, model})
    Ring->>Bcast: per-event (throttled to SSE_EVENT_RATE/s)
    Bcast->>UI: 'request' event
    Note over Bcast,UI: every METRICS_TICK_MS:<br/>'tick' with rolling 1m/5m/15m
```

**Hot-path invariants** — zero sync I/O, zero body buffering on the SDK-facing
stream, zero allocations beyond the metric event itself. The tee is a passive
observer; if it overflows or fails to parse, the base metric is still recorded.

## Module map

```mermaid
flowchart LR
    subgraph hot[Hot path - no sync I/O]
        proxy[proxy/proxy.js]
        agent[proxy/agent.js]
        collector[metrics/collector.js<br/>ring buffer]
    end
    subgraph slow[Slow path - microtask]
        provider[providers/*.js<br/>14 parsers]
        pricing[providers/pricing.js]
    end
    subgraph fanout[Fan-out]
        aggregator[metrics/aggregator.js<br/>1m / 5m / 15m]
        broadcaster[metrics/broadcaster.js]
        sse[sse/stream.js<br/>log SSE]
    end
    subgraph app[App-event path]
        logger[logs/logger.js]
        rotation[logs/rotation.js]
        reader[logs/reader.js]
    end

    proxy --> agent
    proxy --> collector
    proxy -.passive tee.-> provider
    provider --> pricing
    provider --> collector
    collector --> aggregator
    aggregator --> broadcaster
    broadcaster --> ui[Dashboard SSE]
    sse --> ui
    logger --> rotation
    reader --> ui

    classDef hotcls fill:#3b1f1f,stroke:#f85149,color:#fff
    classDef slowcls fill:#1f2d3b,stroke:#58a6ff,color:#fff
    class proxy,agent,collector hotcls
    class provider,pricing slowcls
```

The logger is **never** invoked per proxied request — it exists for app events
(startup, cron, errors). The metric event path is the only per-request
observability mechanism.

## Log rotation lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active: server boot<br/>rotateLogsIfNeeded()
    Active --> Active: writes append to app.log
    Active --> Rotated: midnight UTC (cron)<br/>OR size > MAX_LOG_SIZE_MB
    Rotated --> Pruned: > LOG_RETENTION_DAYS old<br/>(checked on rotation)
    Pruned --> [*]
    Active --> Rotated: startup detects stale date
```

Active file: `app.log`. Rotated: `app-YYYY-MM-DD.log` (UTC date). Default
retention 7 days; size guard checks every 5 min.

## API surface

```
GET  /health                          uptime, proxy state, upstream reachability, runtime stats

# Logs
GET  /api/logs?limit=500              tail of active log
GET  /api/logs/available              rotated files index
GET  /api/logs/history?date=…         specific rotated file
GET  /api/logs/stream                 SSE — live entries

# Metrics
GET  /api/metrics/summary             snapshot + 1m/5m/15m windows
GET  /api/metrics/recent?limit=200    last N proxied requests
GET  /api/metrics/models              per-model cost/token, sorted by cost desc
GET  /api/metrics/stream              SSE — 'request' (per call) + 'tick' (every METRICS_TICK_MS)

# Proxy
ANY  <PROXY_PATH_PREFIX>/*            transparent passthrough to UPSTREAM_URL
```

## Key design decisions

- **Passthrough = no modification.** Bytes flow through `http-proxy` streams
  unchanged. Byte counters use passive `data` listeners.
- **Hot path zero sync I/O.** No `appendFileSync`, no `JSON.parse` of payloads,
  no compression. `metrics.record()` is O(1) with no allocations beyond the
  event object.
- **Pre-allocated ring buffer.** `MAX_METRIC_EVENTS`-sized array; `head`
  rotates with no `push`/`shift` — bounded GC churn under load.
- **Shared outbound HTTP agent.** Default Node agent caps `maxSockets` at
  5/host; we override to ∞ so concurrency isn't serialized.
- **SSE caps + non-blocking writes.** `MAX_SSE_CLIENTS` evicts oldest on
  overflow; slow clients drop frames rather than queue.
- **DNS-first deployment.** `BIND_HOST=0.0.0.0`. Code never references
  `localhost`. `PUBLIC_BASE_URL` is informational; routing happens via
  Tailscale MagicDNS or hosts file.
- **`dotenv` is a devDependency**, loaded only when `NODE_ENV !== 'production'`.
  Docker injects vars directly.

For env vars see [../CONFIGURATION.md](../CONFIGURATION.md).
For release process see [RELEASING.md](RELEASING.md).
