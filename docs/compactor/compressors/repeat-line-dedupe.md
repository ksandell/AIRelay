# `repeat-line-dedupe`

**Purpose** — Collapse runs of identical consecutive lines (typical log
spam pattern).

**Risky** — no.

**Toggle** — `COMPACTOR_REPEAT_LINE_DEDUPE_ENABLED` (default `true`).

## Trigger heuristic

Always applies (no cheap probe — the algorithm itself is cheap).

## Transform

Walk lines. When line `i` matches line `i+1`, count the run length.
If `run >= 3` and the line isn't empty:

```
<line>
<line repeated N-1 more times>
```

Empty lines are not deduplicated (that's `blankline-collapse`'s job).

Only fires when the resulting text is actually shorter than the original
— short repeats below the break-even point (a few chars × 3) leave the
input untouched.

## Before / after

```
[BEFORE]
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
OK

[AFTER]
connection reset by peer at 192.168.1.42 retrying...
<line repeated 4 more times>
OK
```

## Known limitations

- Only consecutive duplicates. Non-adjacent repeats are kept.
- Very short repeats (e.g. 3× `"OK"`) may break even with the placeholder
  text and won't fire.

## Safety notes

Property tests assert never-grows and idempotence. The first instance of
the repeated line is always preserved, so the model sees the content; only
"and the same again, many times" is compressed.
