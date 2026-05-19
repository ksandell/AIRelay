# Multi-upstream routing

Opt-in feature (v0.4.0). When unset, AIRelay behaves exactly as in v0.3.0:
one upstream, one path prefix, one provider.

## When to use

- You want a single AIRelay instance to fan out to **multiple AI providers**,
  e.g. `/proxy/anthropic/* → api.anthropic.com` and
  `/proxy/openai/* → api.openai.com/v1`.
- You want to A/B compare upstreams (e.g. `/proxy/prod → main` vs
  `/proxy/canary → staging`) and see per-route metrics on the dashboard.
- You want per-route policy: enable `trustForwarded` on internal upstreams,
  keep it off on public ones.

## Configuration

Two sources, evaluated in priority order:

1. `PROXY_ROUTES` — inline JSON (env var, highest priority).
2. `ROUTES_CONFIG_PATH` — path to a JSON file.

If neither is set, the v0.3.0 single-route fallback runs from
`UPSTREAM_URL` + `PROXY_PATH_PREFIX` + `PROXY_PROVIDER`.

### File schema

```json
{
  "routes": [
    {
      "prefix": "/proxy/anthropic",
      "upstream": "https://api.anthropic.com",
      "provider": "anthropic"
    },
    {
      "prefix": "/proxy/openai",
      "upstream": "https://api.openai.com/v1",
      "provider": "openai",
      "trustForwarded": false
    }
  ]
}
```

### Inline env override

```bash
PROXY_ROUTES='{"routes":[{"prefix":"/proxy/a","upstream":"http://a.local","provider":"generic"},{"prefix":"/proxy/b","upstream":"http://b.local","provider":"openai"}]}'
```

Both an array or a wrapped `{ "routes": [...] }` object are accepted.

## Matching

Routes are sorted by descending prefix length at startup. The longest
matching prefix wins. So:

```
/proxy/anthropic/v1/messages   → matched by "/proxy/anthropic"
/proxy/v1/messages             → matched by "/proxy" (if present)
```

Duplicate prefixes (after trailing-slash normalization) fail at startup —
misconfig is loud, not silent.

## Per-route behavior

| Field | Effect |
|---|---|
| `prefix` | Mounted as an Express path prefix. Must start with `/`. |
| `upstream` | Passed as the `target` of every forwarded request. |
| `provider` | Drives the token-extraction parser + pricing key. |
| `trustForwarded` | Overrides the global `PROXY_TRUST_FORWARDED` per route. |

Compactor + Guardrails middleware mount under **every** route prefix when
their respective master switches are enabled. There is no per-route
master-switch in v0.4.0; per-detector / per-compressor toggles are global.

## Observability

- Active routes: `GET /api/metrics/routes` → `[{prefix, upstream, provider}]`.
- Per-event route attribution: every metric event carries the `route` field
  (the matched prefix string).
- Dashboard: the Metrics tab gains a **Route** dropdown that filters the
  recent-requests table + history queries by route.
- SQLite `events` table (when persistence is on) includes a `route` column,
  indexed jointly with `ts` for fast time-range queries scoped to one route.

## Backwards compatibility

A v0.3.0 `.env` with only `UPSTREAM_URL=…` continues to work unchanged. The
proxy synthesizes a single route at startup. Tests covering this path remain
in `tests/proxy/`.

## Troubleshooting

**A request returned 404 even though my prefix looks right.** Express does
exact-prefix matching; ensure the prefix starts with `/` and the request
path includes it verbatim (e.g. `/proxy/anthropic/v1/messages`, not
`/anthropic/v1/messages`).

**Two routes share a prefix.** Startup throws — fix the config and restart.

**Per-request metrics show the wrong upstream.** Confirm route ordering at
`GET /api/metrics/routes`. Longest prefix wins.

**Token extraction is wrong.** Check the route's `provider` field. A
Mistral upstream with `provider: "openai"` will parse tokens but report
`costUsd: 0` (no `openai → mistral-*` pricing entry).
