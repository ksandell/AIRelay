# `blankline-collapse`

**Purpose** — Collapse runs of 3+ blank lines into a single blank line.

**Risky** — no.

**Toggle** — `COMPACTOR_BLANKLINE_COLLAPSE_ENABLED` (default `true`).

## Trigger heuristic

Input contains `\n\n\n` (at least three consecutive newlines, possibly
with intermediate whitespace).

## Transform

Single regex: `/(?:[ \t]*\r?\n){3,}/g` → `'\n\n'`.

Lines containing only spaces or tabs count as "blank" for this purpose.
A single CRLF or LF separator stays.

## Before / after

```
[BEFORE]  hello\n\n\n\n\nworld
[AFTER]   hello\n\nworld
```

## Known limitations

- Universal — runs on any text with 3+ newlines. May affect Markdown
  rendering if the model cares about exact blank-line counts (rare).
- Whitespace-only lines (spaces, tabs) are treated as blank.

## Safety notes

Property tests assert never-grows and idempotence. No printable content
is altered.
