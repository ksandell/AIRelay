# `lockfile-drop`

**Purpose** — Detect a lockfile diff inside a unified-diff segment and
replace its body with a one-line summary.

**Risky** — no.

**Toggle** — `COMPACTOR_LOCKFILE_DROP_ENABLED` (default `true`).

## Trigger heuristic

The input contains a `diff --git` or `--- ` header AND at least one of:
`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `pnpm-lock.yml`,
`Cargo.lock`, `poetry.lock`, `composer.lock`, `Gemfile.lock`,
`Pipfile.lock`, `go.sum`.

## Transform

For each file-header block whose path ends in a known lockfile name:

1. Capture the full header block (`diff --git`, `index`, `--- a/`, `+++ b/`,
   plus any `new file mode`, `rename from/to`, `similarity index` lines).
2. Walk forward until the next file header (`diff --git` or another
   `--- /+++` pair) or EOF.
3. Replace everything from the second header line through the body with
   `<lockfile diff omitted: N lines>`.

The first file-header line (`diff --git a/X b/X`) is kept so the model
still knows which file changed.

If the body is fewer than 4 lines, no elision (cost > benefit).

## Before / after

```
[BEFORE]
diff --git a/package-lock.json b/package-lock.json
index abc..def 100644
--- a/package-lock.json
+++ b/package-lock.json
+    "version": "1.0.0"
+    "version": "1.0.1"
+    "version": "1.0.2"
... (300 more lines)

[AFTER]
diff --git a/package-lock.json b/package-lock.json
<lockfile diff omitted: 304 lines>
```

## Known limitations

- Matches by basename. A file named `not-really-package-lock.json` will be
  flagged if it ends with `package-lock.json` — vanishingly rare in
  practice.
- Vendored lockfiles in arbitrary subdirectories are still caught (good).
- Does not detect non-standard lockfile names (e.g. `pnpm-workspace.yaml`,
  custom monorepo lock manifests).

## Safety notes

Property tests assert never-grows and idempotence. File headers are
preserved, so the model retains awareness that "the lockfile changed"
without seeing the noise.
