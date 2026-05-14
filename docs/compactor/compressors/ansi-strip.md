# `ansi-strip`

**Purpose** — Remove ANSI escape / color sequences from terminal output.

**Risky** — no.

**Toggle** — `COMPACTOR_ANSI_STRIP_ENABLED` (default `true`).

## Trigger heuristic

Cheap probe: input contains at least one ESC byte (``).

## Transform

Three independent regex passes:

1. **CSI / SGR** (`ESC [ <params> <final-byte>`) — covers color codes,
   cursor moves, clear-line, etc.
2. **OSC** (`ESC ] ... BEL` or `ESC \`) — title-setting, hyperlinks.
3. **Short 2-byte sequences** (`ESC <single>`) — SS3, reset, etc.

Pure removal — no replacement text. Plain printable characters
surrounding sequences are untouched.

## Before / after

```
[BEFORE]  \x1b[31mERROR\x1b[0m: \x1b[1mfile not found\x1b[0m
[AFTER]   ERROR: file not found
```

## Known limitations

- Does not handle DEC private mode (`ESC [ ? ... h`) edge cases on
  non-standard terminals.
- A bare `\x1b` byte not followed by a recognized sequence character will
  remain — by design (avoids false positives on JSON-encoded data).

## Safety notes

Property tests assert:
- Never grows output
- Idempotent
- Returns valid result shape

No safe-substring assertions — ANSI escapes have no semantic content
beyond presentation, so any printable text the model needs is preserved
by definition.
