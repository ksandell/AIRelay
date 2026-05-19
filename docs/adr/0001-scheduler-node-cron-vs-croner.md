# ADR 0001 — Scheduler: stay on node-cron 4 vs swap to croner

- **Status:** Accepted
- **Date:** 2026-05-19
- **Milestone:** v0.4.2 (issue #126)
- **Decider:** repo maintainer

## Context

`src/index.js` uses `node-cron` exactly once, to fire log rotation +
metrics-retention pruning on a configurable schedule (default `0 0 * * *`,
timezone `UTC`):

```js
import cron from 'node-cron'

cron.schedule(
  config.cronSchedule,
  async () => { await rotateLogs(); /* prune */ },
  { timezone: 'UTC' },
)
```

The current pin is `node-cron ^3.0.3`. `node-cron 4.x` is now available (`4.2.1`
at decision time). `croner` (`10.0.1`) is the other widely-used pure-JS
cron-expression scheduler. Both are off the hot path — the scheduler runs once
per day on the default schedule and never touches a proxied request.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Stay on node-cron, bump 3 → 4** | Smallest diff. Same API shape (`cron.schedule(expr, fn, { timezone })`). Active maintenance (4.x cut 2024-2025). | v4 is a breaking change — schedule object API now returns a task with `.start()/.stop()` rather than starting eagerly; need to verify our call site. |
| **Swap to croner** | Zero dependencies, smaller install footprint. Supports more expression dialects (Quartz, vixie-cron, jcron). `.busy()`/`.previousRun()` introspection. | Different API — `Cron(expr, opts, fn)`, no separate `.schedule()`. One-time API migration cost for a feature we use once. |
| **Drop the lib, use `setTimeout` math** | Zero deps. | Hand-rolling cron-expression parsing or restricting to "every N hours" loses operator flexibility (`CRON_SCHEDULE` is a documented env var). |

## Decision

**Stay on node-cron, bump to v4.** Swap to croner is **deferred** as a
nice-to-have, not a need-to-have.

## Rationale

- **One call site, one schedule.** The maintenance surface is so small that
  the strongest case for switching libraries — better ergonomics across many
  jobs — does not apply.
- **CRON_SCHEDULE is operator-facing.** Both libs accept the same
  vixie-cron 5-field expression for the values our defaults use, so neither
  forces a docs change.
- **node-cron 4 migration is a one-line change at most:**
  `cron.schedule(...)` still works in v4; the returned object now requires
  `.start()` if `autoStart: false` is passed. We pass no opts other than
  `timezone`, which keeps the default `autoStart: true` behavior.
- **croner's wins (introspection, multiple dialects) buy us nothing today.**
  Log rotation either ran or it didn't — `logger.info('cron: rotating logs')`
  is sufficient signal.

## Consequences

- Action: open a follow-up PR bumping `node-cron ^3 → ^4`. Verify
  `cron.schedule(expr, fn, { timezone: 'UTC' })` still auto-starts in v4 (the
  v4 changelog says it does unless `noOverlap` / `autoStart: false` is set).
  If the call site needs `.start()` explicitly, add it; otherwise the diff is
  package.json + lock only.
- No source-file API surface changes for the rest of the codebase.
- Revisit if/when we add a second scheduled job with different cadence or
  need overlap-prevention semantics that node-cron 4 lacks.

## References

- node-cron README, v4 changelog (npm: node-cron@4.2.1)
- croner README (npm: croner@10.0.1)
- `src/index.js` lines 1, 47-68 (sole consumer)
- `.env.example` `CRON_SCHEDULE=0 0 * * *` (operator-facing knob)
