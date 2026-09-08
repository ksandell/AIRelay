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

## CI

CI is a release gate, not a per-push service. **The E2E workflow (Playwright,
functional + visual) runs on merge to `main` only**, plus `workflow_dispatch` to
exercise a branch on demand. Nothing runs on a schedule, on pull requests, or on
pushes to `develop`, so a PR showing "no checks reported" is expected, not a
misconfiguration.

**CodeQL is not a workflow.** Code scanning uses GitHub's *default setup*
(Settings → Code security), configured with the `extended` query suite. GitHub
schedules and runs it — there is no file in `.github/workflows/` to maintain,
and on a public repo it costs no Actions minutes. The old advanced workflow was
removed: it had never once fired on `push` or `pull_request` despite being
configured for both, and default setup cannot coexist with it. Findings appear
under the repository's Security tab.

That puts the burden of proof before the merge: `npm run lint && npm test`
locally is the gate, and `npm run test:e2e` for anything touching the dashboard.

**If GitHub Actions credits are exhausted**, a queued, skipped, or failed run is
not a release blocker — ignore it and rely on the local run. Do not hold a
release waiting for minutes to reset.

Dependabot still opens its weekly PRs; those consume no Actions minutes on their
own, and with the trigger above they run no workflow until their changes reach
`main`.

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
