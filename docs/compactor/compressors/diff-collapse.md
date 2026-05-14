# `diff-collapse`

**Purpose** — Collapse long runs of unchanged context lines inside
unified-diff hunks, while preserving every `@@` header and every `+`/`-`
line.

**Risky** — no.

**Toggle** — `COMPACTOR_DIFF_COLLAPSE_ENABLED` (default `true`).

## Trigger heuristic

Input contains an `@@` substring AND matches `/^@@.*@@/m` (a hunk header
at start-of-line somewhere).

## Transform

For each hunk:

1. Walk the hunk body line-by-line.
2. When you find a run of N consecutive context lines (lines starting with
   a space), check `N >= MIN_RUN` (8).
3. If so, keep the first 3 and last 3 lines and replace the middle with
   `... <N-6> lines unchanged ...`.
4. Otherwise keep all context lines as-is.

`+`/`-` lines are **never** dropped or modified.

## Before / after

```
[BEFORE]
@@ -1,40 +1,40 @@
 unchanged 1
 unchanged 2
 unchanged 3
 unchanged 4
 unchanged 5
 unchanged 6
-old line
+new line
 unchanged 7
 unchanged 8
 unchanged 9
 unchanged 10
 unchanged 11
 unchanged 12

[AFTER]
@@ -1,40 +1,40 @@
 unchanged 1
 unchanged 2
 unchanged 3
... 0 lines unchanged ...
 unchanged 4
 unchanged 5
 unchanged 6
-old line
+new line
 unchanged 7
 unchanged 8
 unchanged 9
... 0 lines unchanged ...
 unchanged 10
 unchanged 11
 unchanged 12
```

(In this small example the savings are modest. On a 500-line hunk with
only a 2-line change, savings are typically 80–90%.)

## Known limitations

- Only collapses runs of **8+** context lines. Short hunks pass through
  unchanged.
- Does not understand `--- a/file` / `+++ b/file` boundaries beyond
  delegating to outer flow — file headers are preserved by being
  non-context lines.

## Safety notes

Property tests assert:
- Never grows output (returns original if collapsed version isn't smaller)
- Idempotent
- **Number of `+`/`-` lines after transform ≥ number before** (safe-substring)

This guarantee is critical: the model must see every change.
