# Operations Runbook

Operational reference for AIRelay in a homelab Docker deployment.

## Health Check

```bash
curl -s http://airelay.local:3000/health | jq .
```

Expected: `{"status":"ok","uptime":<seconds>}`

## Restart the Container

```bash
docker compose restart airelay
# or full cycle:
docker compose down && docker compose up -d
```

## View Live Logs

```bash
# Docker log driver output (last 100 lines + follow):
docker compose logs -f --tail=100 airelay

# Application JSON log (today):
curl -s "http://airelay.local:3000/api/logs?limit=200" | jq .

# Available log dates:
curl -s http://airelay.local:3000/api/logs/available | jq .
```

## Metrics Snapshot

```bash
curl -s http://airelay.local:3000/api/metrics/summary | jq .
curl -s http://airelay.local:3000/api/metrics/models  | jq .
```

## Cache (Dragonfly)

Start with cache enabled:
```bash
CACHE_ENABLED=true docker compose --profile cache up -d
```

Check Dragonfly connection:
```bash
curl -s http://airelay.local:3000/api/cache/summary | jq .connected
```

Cache stats:
```bash
curl -s http://airelay.local:3000/api/cache/summary | jq '{enabled, connected, keyCount, lifetime}'
```

Flush all cached responses (clears Dragonfly entirely):
```bash
docker compose exec dragonfly redis-cli FLUSHALL
```

Or target only AIRelay cache keys:
```bash
docker compose exec dragonfly redis-cli --scan --pattern 'airelay:exact:*' | xargs docker compose exec dragonfly redis-cli DEL
```

Restart just Dragonfly (data persisted to volume):
```bash
docker compose restart dragonfly
```

## Log Rotation

Rotation is automatic (nightly, configurable via `LOG_RETENTION_DAYS`).
Rotated files land in `LOG_DIR` as `app-YYYY-MM-DD.log`.
Docker log driver caps: 10 MB per file, 5 files max.

To force a manual rotation, restart the container — the writer re-opens on start.

## Capacity Limits

| Knob | Env var | Default | Notes |
|------|---------|---------|-------|
| In-memory metric events | `MAX_METRIC_EVENTS` | 10 000 | Ring buffer; oldest evicted |
| Log read cap | `LOG_READ_MAX_MB` | 10 MB | Per `/api/logs` call |
| API result rows | `MAX_API_RESULT_ROWS` | 5 000 | `/api/logs` + `/api/metrics/recent` |
| Body parse cap | `PROXY_MAX_BODY_PARSE_MB` | 10 MB | Provider token extraction only |
| SSE clients | `MAX_SSE_CLIENTS` | 50 | Per hub (metrics + logs each) |
| Request idle timeout | `PROXY_REQUEST_IDLE_TIMEOUT_MS` | 120 000 ms | Kills hung upstream connections |

## Known Limitations

- **No backpressure on slow clients** (H3): A fast upstream feeding a slow dashboard client will accumulate data in Node.js write buffers. Under sustained high traffic with a stalled browser, memory can grow. Mitigation: `MAX_SSE_CLIENTS` + `ulimits.nofile=65536` in docker-compose.
- **Dual SSE eviction policies** (H4): Metrics and log SSE hubs share the same eviction logic but are independent instances.
- **Metric history**: In-memory ring buffer by default (restarts clear it). Enable SQLite persistence via `METRICS_DB_PATH` (shipped in v0.4.0).

## Scaling Notes

The proxy is designed for single-container homelab use. `ulimits.nofile=65536` in `docker-compose.yml` allows ~64 K concurrent file descriptors. Under typical LLM traffic (long-lived streaming requests), the bottleneck is upstream API rate limits, not the proxy.
