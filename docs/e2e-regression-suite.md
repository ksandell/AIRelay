# AIRelay E2E Regression Suite

**Generic, reusable test plan.** Re-runnable per release; results are
machine-comparable. Provider-agnostic — pick any upstream you have a key for.
For Mistral-specific cost-extraction depth tests, see `e2e-test-plan.md`.

Run it for every release tag (`vX.Y.Z`). Append the run summary to
`docs/e2e-runs/<tag>.md`.

---

## 0. Run metadata (fill in)

| Field | Value |
|---|---|
| Tag | `vX.Y.Z` |
| Date (UTC) | `YYYY-MM-DD HH:MM` |
| Operator | |
| Host OS | |
| Docker version | |
| Upstream | e.g. `https://api.anthropic.com` |
| Provider | e.g. `anthropic` |
| Has valid API key? | yes / no (no = error-path-only mode) |

---

## 1. Build & deploy (mandatory — every run)

The container under test **must be a fresh image built from the working tree**,
never a cached or running instance from a previous version.

```bash
# Isolated compose project so it can coexist with other stacks.
docker compose -f docker-compose.yml -p airelay-e2e down -v
docker compose -f docker-compose.yml -p airelay-e2e up -d --build
```

`.env` minimum:

```dotenv
PORT=3000
UPSTREAM_URL=https://api.anthropic.com   # or your provider
PROXY_PROVIDER=anthropic                 # must match pricing key
PROXY_PATH_PREFIX=/proxy
PROXY_TOKEN_TRACKING=true
ENABLE_COMPRESSION=true                  # exercises gzip rotation
LOG_DIR=/data/logs
TZ=UTC
```

**Acceptance**:

| Check | Command | Pass |
|---|---|---|
| Container healthy | `docker compose -p airelay-e2e ps` | `Up ... (healthy)` |
| Health endpoint | `curl -s :3000/health` | `status:"ok"`, `proxy.upstreamReachable:true` |
| Unit tests | `npm test` | all pass on Linux; one Windows-only `rotation.test.js` failure is acceptable (file-handle lock) |

---

## 2. Functional scenarios

Each row is independent. Re-run any in isolation.

| ID | Scenario | Command (abbreviated) | Pass criteria |
|---|---|---|---|
| F1 | Health | `curl :3000/health` | `status:ok`, `upstreamReachable:true`, `bindHost:0.0.0.0`, `eventLoopLagMs<200` |
| F2 | Dashboard reachable | open `http://localhost:3000/` | renders; no JS console errors; footer shows `proxy → <upstream>` |
| F3 | Logs tab populates | issue 5 proxy calls; switch to Logs | `entries` count > 0; latest row top |
| F4 | Metrics tab populates | switch to Metrics | KPI tiles non-empty; RPS chart redraws |
| F5 | SSE live update | open `/api/metrics/stream` | event every ≤1.5s while traffic flows |
| F6 | Auth passthrough | proxy call w/ valid key | upstream returns `2xx`; `costUsd > 0` in `/api/metrics/summary` |
| F7 | Auth passthrough (no key) | proxy call without key | `401` from upstream; **request still counted** in metrics |
| F8 | Streaming SSE | proxy call w/ `stream:true` | response stays open; body unchanged byte-for-byte |
| F9 | 503 when upstream disabled | unset `UPSTREAM_URL`, restart | `/proxy/...` returns `503`; dashboard still works |
| F10 | `/api/logs?limit=N` | `curl ":3000/api/logs?limit=10"` | array of ≤10 entries, newest first |
| F11 | `/api/logs/available` | `curl :3000/api/logs/available` | `active` populated; `rotated[]` includes any rotated `.log` **and `.log.gz`** files ⚠ |
| F12 | `/api/metrics/summary` | `curl :3000/api/metrics/summary` | windows `1m`, `5m`, `1h` present; `count` ≥ traffic |
| F13 | `/api/metrics/models` | `curl :3000/api/metrics/models` | one row per model with non-zero traffic |
| F14 | `/api/metrics/recent?limit=N` | `curl ":3000/api/metrics/recent?limit=10"` | ≤N items, with `ts, ms, status, model?` |
| F15 | favicon | `curl :3000/favicon.ico` | `200` or `204` (never `500`) |

`⚠ F11`: in v0.2.5 with `ENABLE_COMPRESSION=true`, `listAvailableLogs()`
filters with `^app-\d{4}-\d{2}-\d{2}\.log$` — `.log.gz` is excluded. Known
regression (see §6 Bug Watchlist).

---

## 3. Concurrency / performance test (mandatory)

Drives sustained concurrent load against the proxy. Captures end-to-end
throughput and tail-latency under contention.

### 3.1 Burst test — 1000 requests, 100 concurrent

```bash
python -c "
import subprocess, time, concurrent.futures
N, CONC = 1000, 100
def fire(i):
  t0 = time.time()
  r = subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}','--max-time','15',
    '-X','POST','http://localhost:3000/proxy/v1/messages',
    '-H','x-api-key: dummy','-H','anthropic-version: 2023-06-01','-H','content-type: application/json',
    '-d','{\"model\":\"claude-haiku-4-5\",\"max_tokens\":20,\"messages\":[{\"role\":\"user\",\"content\":\"burst\"}]}'],
    capture_output=True, text=True)
  return r.stdout.strip(), time.time()-t0
start=time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=CONC) as ex:
  results = list(ex.map(fire, range(N)))
dur=time.time()-start
codes=[r[0] for r in results]; lats=sorted(r[1] for r in results)
print(f'RPS={N/dur:.1f}  codes={dict((c,codes.count(c)) for c in set(codes))}')
def pct(p): return lats[int(len(lats)*p)-1]
print(f'p50={pct(0.5)*1000:.0f}ms p95={pct(0.95)*1000:.0f}ms p99={pct(0.99)*1000:.0f}ms max={lats[-1]*1000:.0f}ms')
"
```

| Metric | Acceptable | Investigate |
|---|---|---|
| RPS (client-observed) | ≥ 100 | < 50 |
| p95 latency | < 1000 ms over local network to real upstream | > 1500 ms |
| p99 latency | < 1500 ms | > 3000 ms |
| Curl timeouts (`000`) | 0 | any |
| Container `eventLoopLagMs` during test | < 50 | > 100 |
| Container RSS growth (start → end) | < 50 MB | > 200 MB |

### 3.2 Sustained test — optional 5-minute soak

Hold 50 concurrent for 300 s. Watch `/api/metrics/summary` `windows.5m.rps`.
Acceptance: no error spike, no OOM, no log file > 50 MB if `MAX_LOG_SIZE_MB=50`.

---

## 4. v0.2.5-specific features

### 4.1 Gzip rotation

```bash
docker exec airelay-e2e-app-1 node -e \
  "import('./src/logs/rotation.js').then(async m=>{await m.rotateLogs();})"
docker exec airelay-e2e-app-1 sh -c 'ls -la /data/logs/'
docker exec airelay-e2e-app-1 sh -c 'gunzip -c /data/logs/*.log.gz | head -3'
```

| Check | Pass |
|---|---|
| `.log.gz` file exists after rotation | yes |
| `.gz` decompresses to valid newline-delimited JSON | yes |
| Original `.log` removed | yes |
| `app.log` recreated (size 0) | yes |
| Same-day re-rotation produces `.1.log[.gz]` suffix | yes |

### 4.2 Provider directory (CONFIGURATION.md)

```bash
awk '/^### Provider directory/,/^### [^P]/' CONFIGURATION.md | grep -c '^| [A-Z]'
```

| Check | Pass |
|---|---|
| Row count (excluding header) | 16 |
| All providers in `src/providers/registry.js` appear in directory | yes |
| Inline "Named providers (N)" prose count matches directory | yes — should say **16** |

---

## 5. Dashboard screenshots (Chrome MCP)

Capture the **Metrics** tab during the §3 burst:

| Frame | When | Save as |
|---|---|---|
| baseline | before traffic | `metrics-baseline.png` |
| mid-burst (~ t+10s) | during burst | `metrics-burst.png` |
| post-burst (~ t+90s) | tail-off | `metrics-tail.png` |

Verify visible:

- KPI tiles: Total Cost, RPS, p95, p99, Errors, Bytes in/out
- Charts: Requests/sec, P95 latency, Tokens
- Footer: `proxy → <upstream> | inflight: <n> | loop lag: <ms>`

Recommended viewport: 1600×1000.

---

## 6. Bug watchlist (carry forward across runs)

Track regressions or partial fixes by ID. Each entry: ID, first-seen tag,
file:line, repro, status.

| ID | First seen | Where | Issue | Status |
|---|---|---|---|---|
| BW-001 | v0.2.5 | `src/logs/reader.js:95` | `listAvailableLogs` regex misses `.log.gz` → rotated compressed logs invisible to API/UI | open |
| BW-002 | v0.2.5 | `src/logs/reader.js:52` | `readHistoricLog` reads only `.log`, can't read `.log.gz` | open |
| BW-003 | v0.2.5 | `CONFIGURATION.md:105` | Inline text says "Named providers (15)"; Cerebras (v0.2.4) makes 16 | open |
| BW-004 | v0.2.5 | `tests/logs/rotation.test.js:29` | Test fails on Windows (file-handle lock during rename) | platform-specific, Linux OK |

---

## 7. Run summary template

Save as `docs/e2e-runs/<tag>.md`. Re-using this template is what lets you
diff across releases.

```markdown
# E2E run — vX.Y.Z — YYYY-MM-DD

## Environment
- Operator:
- Docker:
- Upstream / provider:
- API key available: yes / no

## §1 deploy
- Build: PASS / FAIL
- Health: PASS / FAIL
- npm test: <n> passed / <m> failed

## §2 functional (Fn)
| ID | Result | Notes |
|---|---|---|
| F1 | PASS | |
| F2 | PASS | |
| ... | | |

## §3 concurrency
- RPS: <n>
- p50 / p95 / p99 / max: <ms>
- Timeouts: <n>
- RSS Δ: <MB>

## §4 v0.2.5 features
- Gzip rotation: PASS / FAIL
- Provider directory rows: <n>

## §5 screenshots
- metrics-baseline.png
- metrics-burst.png
- metrics-tail.png

## §6 bug watchlist deltas
- New: BW-NNN — ...
- Resolved: BW-NNN
- Still open: BW-001, BW-002, ...

## Verdict
PASS / PASS-WITH-WARNINGS / FAIL
```

---

## 8. Comparison between runs

For two completed runs A and B:

| Dimension | How to compare |
|---|---|
| Throughput | diff §3 RPS (B should be ≥ A − 10 %) |
| Tail latency | diff §3 p95 and p99 (regression if B > A · 1.25) |
| Memory | diff §3 RSS Δ (alert if B > A + 30 MB) |
| Open bugs | diff §6 (any new without resolved = regression) |
| Functional pass count | identical, except features added/removed in CHANGELOG |

A run-comparison script can `jq` the JSON summaries — keep §3 measurements
machine-parseable in the run file (e.g. fenced ```json``` block).
