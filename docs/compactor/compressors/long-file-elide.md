# `long-file-elide`

**Purpose** — Truncate the middle of very long text segments inside
tool results (typical pattern: agent reads a 2000-line file).

**Risky** — **yes**. May drop content the model needs.

**Toggle** — `COMPACTOR_LONG_FILE_ELIDE_ENABLED` (default `true`, but
**inert unless `COMPACTOR_ALLOW_RISKY=true`**).

## Trigger heuristic

Segment contains at least `COMPACTOR_LONG_FILE_THRESHOLD` newlines
(default `400`). Counted directly without splitting for cheapness.

## Transform

If line count ≥ threshold AND `lines.length > 100` (head + tail):

1. Keep first 50 lines.
2. Insert `<N lines elided>` marker.
3. Keep last 50 lines.

## Before / after

```
[BEFORE]   (a 600-line file dump)
[AFTER]    First 50 lines + "<500 lines elided>" + Last 50 lines
```

## Known limitations

- Hard cutoff at fixed line counts. A file where the relevant content is
  in the middle will be elided incorrectly.
- Does not look at content semantics — a 600-line CSV gets the same
  treatment as 600 lines of source code.

## Why "risky"

The model's request for a tool result is an explicit ask for the whole
file. Eliding the middle silently violates that contract. Use only when:
- You're confident the model only needs head/tail awareness.
- You've measured that aggressive token reduction outweighs occasional
  re-asks.

The banner makes the elision visible to the model, but a model that
doesn't read banners (or doesn't know it can request raw text) may go
down a wrong path.

## Safety notes

Property tests assert never-grows and idempotence. **No safe-substring
guarantee** — that's what makes this compressor risky. Setting
`COMPACTOR_ALLOW_RISKY=true` is the explicit acknowledgment.
