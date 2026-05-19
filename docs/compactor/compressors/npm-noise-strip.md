# `npm-noise-strip`

**Purpose** — Strip npm/yarn/pnpm boilerplate that adds nothing for the
model: deprecation warnings, audit summaries, funding notices, progress
bars.

**Risky** — no.

**Toggle** — `COMPACTOR_NPM_NOISE_STRIP_ENABLED` (default `true`).

## Trigger heuristic

Input contains any of: `npm WARN`, `npm notice`, `npm fund`, `npm audit`,
`vulnerabilities`, `Progress: resolved` (pnpm).

## Transform

Per-line filter. Each line is checked against a curated pattern list and
dropped if it matches. **Lines starting with `npm ERR!` are never
stripped** — error output is signal, not noise.

Patterns stripped:
- `npm WARN deprecated …`
- `npm notice …`
- `npm fund …`
- `N packages are looking for funding`
- `  run \`npm fund\` for details`
- `found N vulnerabilities`
- ` N <severity> severity`
- `To address …, run:`
- `Run \`npm audit\` for details`
- Progress-bar-only lines (`[====>      ]`, `[...]`)
- Yarn / pnpm equivalents (`Progress: resolved N, reused M`, `Packages: +N`)

## Before / after

```
[BEFORE]
npm WARN deprecated foo@1.0.0: use new@2
npm notice created a lockfile
[================>          ]
found 3 vulnerabilities (2 moderate, 1 high)
  3 moderate severity vulnerabilities
To address all issues, run:
  npm audit fix
npm ERR! code ELIFECYCLE
npm ERR! Error: command failed

[AFTER]
npm ERR! code ELIFECYCLE
npm ERR! Error: command failed
```

## Known limitations

- Patterns are tied to npm's current output. Future npm versions may
  introduce new noise we don't yet recognize.
- Yarn 1.x specific patterns are covered; Yarn 2+ Berry's different
  output style may slip through partially.

## Safety notes

Property tests assert:
- Never grows output
- Idempotent
- **Every `npm ERR!` line in the input is present in the output** (safe-substring)

The error-line guarantee is the single most important behavior here.
