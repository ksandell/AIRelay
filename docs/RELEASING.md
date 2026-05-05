# Releasing AIRelay

Single checklist for cutting a new version. Each step has exactly one
source-of-truth file — do not duplicate version strings elsewhere.

## Checklist

- [ ] **Bump `package.json`** version (`X.Y.Z`).
- [ ] **Add a `CHANGELOG.md` section** at the top:
  ```md
  ## [X.Y.Z] — YYYY-MM-DD — <theme>

  ### Added / Changed / Fixed / Removed
  - …
  ```
- [ ] **Update `ROADMAP.md`** status table — flip the just-shipped row to ✅,
      and add the next planned row if applicable.
- [ ] **Verify SSOT**: no other doc states the version. Quick check —
      `grep -rn "X\.Y\.Z" --include='*.md'` should hit only CHANGELOG.md and
      ROADMAP.md.
- [ ] `npm run lint && npm test` clean.
- [ ] PR titled `chore(release): vX.Y.Z`. Body ticks this checklist.
- [ ] Merge → tag `vX.Y.Z` → `git push --tags`.
- [ ] Create GitHub release; paste the matching CHANGELOG section.
- [ ] Confirm README badges resolve (Node version, Docker badge, etc.).

## What lives where

| Fact | File |
|------|------|
| Current version | `package.json` |
| Per-release notes | `CHANGELOG.md` |
| Roadmap / phase status | `ROADMAP.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| Env vars | `CONFIGURATION.md` |
| Install steps | `INSTALL.md` |
| E2E test plan | `docs/e2e-test-plan.md` |
| Release process | this file |

If you need to mention a version in README/CLAUDE.md/INSTALL/CONFIGURATION,
**link to CHANGELOG.md instead** — never hardcode.
