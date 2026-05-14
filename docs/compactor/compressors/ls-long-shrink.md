# `ls-long-shrink`

**Purpose** — Reduce `ls -l` style directory listings to the filename
column only.

**Risky** — no.

**Toggle** — `COMPACTOR_LS_LONG_SHRINK_ENABLED` (default `true`).

## Trigger heuristic

Input contains a `-rw` / `drwx` style permission prefix at start-of-line
somewhere.

## Transform

For each contiguous block of lines that look like `ls -l` entries
(or `total N` headers), if the block is 3+ lines long, replace each
entry line with just its filename column. `total N` headers are dropped
entirely.

Pattern: `<type><perms> <links> <user> <group> <size> <month> <day> <year-or-time> <name>`.

Surrounding non-listing text is untouched.

## Before / after

```
[BEFORE]
total 24
-rw-r--r--  1 alice group  1234 May 10 12:34 alpha.txt
-rw-r--r--  1 alice group  5678 May 10 12:35 beta.txt
-rwxr-xr-x  1 alice group  9999 May 10 12:36 gamma.sh

[AFTER]
alpha.txt
beta.txt
gamma.sh
```

## Known limitations

- BSD/macOS `ls -l` output has slightly different column spacing — the
  pattern is permissive but may miss exotic locales.
- Extended attributes (`+` suffix on perms) are handled.
- Symlink target arrows (`->`) survive only as part of the name column.

## Safety notes

Property tests assert never-grows and idempotence. The filename column
— the only semantically meaningful part for an agent — is always
preserved.
