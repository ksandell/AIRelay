# `stacktrace-dedupe`

**Purpose** — Collapse repeated identical frames in a stack trace.
Targets infinite-recursion crashes that print the same frame thousands
of times.

**Risky** — no.

**Toggle** — `COMPACTOR_STACKTRACE_DEDUPE_ENABLED` (default `true`).

## Trigger heuristic

Input contains a recognizable frame pattern from any of:
- Node / JS: `    at funcName (file.js:L:C)`
- Python: `  File "x.py", line N, in funcName`
- Ruby: `    from /path/to/file.rb:L:in 'method'`
- Go: `    main.go:L +0x0`

## Transform

Walk lines. When a frame line is followed by 2+ identical copies of
itself (3+ total), keep the first and replace the rest with
`    <frame repeated N-1 more times>`.

Non-frame lines (caused-by markers, the actual error message) are
untouched.

## Before / after

```
[BEFORE]
RangeError: Maximum call stack size exceeded
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at main (file.js:10:1)

[AFTER]
RangeError: Maximum call stack size exceeded
    at recurse (file.js:1:1)
    <frame repeated 4 more times>
    at main (file.js:10:1)
```

## Known limitations

- Different runtimes have different frame indentation conventions; we
  cover the common ones but exotic JVM/CLR formats may pass through.
- Frames that *almost* match (e.g. same function, different line number)
  are not collapsed. This is intentional — those represent real
  recursion depth, not pure repetition.

## Safety notes

Property tests assert never-grows and idempotence. The first instance of
the repeated frame and all non-frame surrounding context are preserved.
