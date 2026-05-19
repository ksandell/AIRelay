#!/usr/bin/env bash
# Create the v0.4.2 — Dependency refresh milestone and all child issues
# on ksandell/AIRelay. Idempotency: re-running will create duplicates.
# Run once, then check `gh issue list --milestone "v0.4.2 — Dependency refresh"`.
set -euo pipefail

REPO=ksandell/AIRelay
TITLE="v0.4.2 — Dependency refresh"
DESC="Security + supportability bumps; replace unmaintained http-proxy; CI Playwright image bump in lock-step; Dependabot + CodeQL housekeeping. No new product features."

echo "Creating milestone…"
M=$(gh api -X POST "repos/${REPO}/milestones" \
  -f title="${TITLE}" -f state=open -f description="${DESC}" --jq .number)
echo "  milestone #${M}"

mkissue() {
  local title="$1" labels="$2" body="$3"
  gh issue create -R "${REPO}" -t "${title}" -b "${body}" -l "${labels}" -m "${M}"
}

VERIFY=$'\n## Verification\n- `npm ci && npm audit` clean (or expected only)\n- `npm run lint`\n- `npm test` + `npm run test:coverage` (>=80%)\n- `npm run test:e2e` and `npm run test:e2e:visual`\n- Docker smoke: `npm run docker:up`, SSE/streaming probe through `/proxy/*`, `/health` green'

mkissue "chore(deps): npm audit fix — brace-expansion advisory (GHSA-jxxr-4gwj-5jf2)" \
  "security,deps" \
  "Transitive \`brace-expansion@5.0.2-5.0.5\` via \`test-exclude\` is flagged moderate (CVSS 6.5, ReDoS-style DoS). \`npm audit fix\` resolves it.${VERIFY}"

mkissue "chore(deps): patch bumps — express 4.22.2 + @playwright/test latest 1.x + CI image + baselines" \
  "deps,ci" \
  "Bump express 4.22.1 -> 4.22.2 (patch). Bump @playwright/test to latest 1.x AND CI image \`mcr.microsoft.com/playwright:v1.60.0-jammy\` referenced in docs/e2e-test-plan.md to the matching tag. Regenerate **both** win32 and linux visual baselines (Linux via the \`Bless visual baselines\` workflow dispatch) so CI stays green.${VERIFY}"

mkissue "chore(deps): vitest + @vitest/coverage-v8 3 -> 4" \
  "deps,testing" \
  "Major bump. Review vitest 4 migration notes (config shape, snapshot format, default pool). Dev-only impact.${VERIFY}"

mkissue "chore(deps): eslint 9 -> 10" \
  "deps,tooling" \
  "Major bump. Repo already uses flat config (\`eslint.config.js\`). Audit deprecated rules.${VERIFY}"

mkissue "chore(deps): dotenv 16 -> 17 — verify .env / PROXY_ROUTES / GUARDRAILS_* parse equivalence" \
  "deps" \
  "Major bump. dotenv 17 changes quoting / multiline semantics. Add a parse-equivalence test against \`.env.example\` plus any inline JSON values used in \`PROXY_ROUTES\` and \`GUARDRAILS_CUSTOM_PATTERNS_FILE\`.${VERIFY}"

mkissue "chore(deps): fast-check 3 -> 4" \
  "deps,testing" \
  "Major bump. Property-test arbitraries API moved. Dev-only.${VERIFY}"

mkissue "decision: node-cron 3 -> 4 vs swap to croner (rotation/retention scheduler)" \
  "decision,deps" \
  "node-cron 4.x is a TS rewrite with API churn. \`croner\` is smaller, zero-dep, actively maintained, near drop-in. Scheduler is internal-only (log rotation + retention prune). Decide before bumping. Output: ADR + chosen library wired in.${VERIFY}"

mkissue "decision+impl: replace unmaintained http-proxy (last release 2020) — candidate http-proxy-3" \
  "decision,security,hot-path" \
  "\`http-proxy@1.18.1\` has had no releases since 2020. Replace with a maintained drop-in (preferred: \`http-proxy-3\`). Hot-path invariants from CLAUDE.md must hold: zero sync I/O on proxy path, SSE streaming intact, raw-byte passthrough for non-opted-in traffic, future WS \`server.on('upgrade')\` story preserved. **Capture a perf baseline** (req/s, p50/p99 latency, response-body byte-equivalence) against a stub upstream BEFORE and AFTER the swap; attach to PR.${VERIFY}"

mkissue "chore: enable Dependabot (weekly grouped PRs for npm + github-actions + docker)" \
  "ci,deps" \
  "Add \`.github/dependabot.yml\` with weekly schedule, grouped minor+patch PRs for npm (dev / prod groups), github-actions, and docker ecosystems. Reduces drift between releases.${VERIFY}"

mkissue "chore: enable CodeQL default workflow for JS" \
  "security,ci" \
  "Add \`.github/workflows/codeql.yml\` (default JavaScript config). Runs on push + weekly schedule.${VERIFY}"

mkissue "chore: pin Docker base to node:22.x-alpine3.x (no floating tag) + verify wget healthcheck" \
  "docker" \
  "Replace \`node:22-alpine\` with a fully-pinned tag (e.g. \`node:22.20-alpine3.21\`) across all three Dockerfile stages. Verify \`wget\` is still present and \`/health\` HEALTHCHECK passes.${VERIFY}"

mkissue "chore(deferred -> v0.5.0): express 4 -> 5 migration (path-to-regexp v8, async errors)" \
  "breaking,deferred" \
  "Defer to v0.5.0. Breaking: path-to-regexp v8 routing, async error propagation, signature removals. Hot-path proxy mount is load-bearing — full E2E + visual regen required.${VERIFY}"

mkissue "chore(deferred -> v0.5.1): Node.js Docker base 22 -> 24 LTS after 2025-10-28" \
  "deferred" \
  "Defer until Node 24 enters LTS (2025-10-28) AND \`better-sqlite3\` publishes prebuilt binaries for it (otherwise \`npm ci\` on Alpine will compile from source). Then bump Dockerfile base across all stages and \`engines.node\`.${VERIFY}"

echo ""
echo "Done. Issues in milestone:"
gh issue list -R "${REPO}" --milestone "${TITLE}" --limit 30
