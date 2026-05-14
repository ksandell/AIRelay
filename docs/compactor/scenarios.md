# Compactor — Chrome MCP visual scenarios

Manual runbook for proving the Compactor compressors fire on **real
Mistral traffic** with real-world bloated payloads. Distinct from the
automated Playwright suite, which uses a fake upstream and synthetic
fixtures.

**Audience:** an operator running Claude Code with Chrome MCP active, or a
human with a browser. Either works — the scenarios are the same.

**Why this exists:** property tests + E2E fixtures prove the compressors
*work*. This runbook proves they *fire* on data the model would actually
see in the wild, and that the Mistral upstream still returns valid
completions when bytes are mutated.

---

## 0. Pre-requisites

1. **Mistral API key.** Get one from <https://console.mistral.ai/>. If you
   are an LLM agent running this script, **ask the user for the key** —
   never embed it in a commit.

2. **AIRelay running with Compactor enabled.** From repo root:

   ```bash
   # In .env (or via docker-compose env)
   UPSTREAM_URL=https://api.mistral.ai
   PROXY_PROVIDER=mistral
   PROXY_PATH_PREFIX=/proxy
   PROXY_TOKEN_TRACKING=true
   COMPACTOR_ENABLED=true
   COMPACTOR_TOOL_RESULT_ONLY=false   # so user-role text content is eligible too
   COMPACTOR_ALLOW_RISKY=true         # needed for Scenario E (long-file-elide)
   ```

   ```bash
   npm run docker:down && npm run docker:up
   ```

3. **Set env var with the key** (do not paste into .env):

   ```bash
   export MISTRAL_API_KEY="<provided>"
   ```

4. **Dashboard reachable**: open <http://airelay.local:3000/> (or your
   configured DNS + port). Confirm `/health` returns 200.

5. **Reset metrics** so KPI counters start at zero:

   ```bash
   # Optional — only meaningful if NODE_ENV=test was set on the container
   curl -sX POST http://airelay.local:3000/api/test/reset
   ```

   (In production NODE_ENV the endpoint 404s — that's intentional. Just
   note your starting numbers from the Compactor tab and diff after.)

---

## 1. Scenarios

Each scenario is a real `curl` to `/proxy/v1/chat/completions` with a
deliberately bloated `role: "user"` or `role: "tool"` message embedding a
real-world artifact. Every scenario targets a specific compressor (or
combination).

For each scenario:

1. **Run the curl.** Capture the response status and `X-Compactor-Applied`
   header (`curl -i` shows it).
2. **Open the Compactor tab.** Verify:
   - The KPI "Bytes saved (lifetime)" KPI **increased**.
   - The compressors table row for the targeted compressor's **`Fires`
     counter incremented**.
   - The recent-events table top row shows the expected filter(s) in
     "Filters fired".
3. **Inspect `/api/compactor/recent?limit=1`** for the exact byte counts.
4. **Capture evidence**: screenshot the Compactor tab. Save as
   `docs/compactor/evidence/<scenario>.png` (manual; not committed by
   default — uncomment from `.gitignore` if you want to track them).

### Scenario A — Git diff with a lockfile

Targets `lockfile-drop` + `diff-collapse`. Real diff captured from any
repo with a non-trivial lockfile diff. Save the diff into `/tmp/diff.txt`
first (example: `git diff HEAD~50 -- package-lock.json > /tmp/diff.txt`).

```bash
jq -Rn --rawfile diff /tmp/diff.txt '{
  model: "mistral-small-latest",
  messages: [
    { role: "user",
      content: "Review this diff and summarize the risk.\n\n" + $diff }
  ]
}' | curl -sX POST http://airelay.local:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- -i | head -20
```

**Expected:**
- `200 OK`
- `X-Compactor-Applied: lockfile-drop,diff-collapse` (or similar)
- Dashboard fires counter on `lockfile-drop` AND `diff-collapse` ≥ 1
- Byte reduction ≥ 80% (lockfiles are the worst offenders)

### Scenario B — `ls -lah /usr/lib` output

Targets `ls-long-shrink`.

```bash
LS_OUT=$(ls -lah /usr/lib | head -100)
jq -n --arg ls "$LS_OUT" '{
  model: "mistral-small-latest",
  messages: [
    { role: "user",
      content: "Pick the largest 3 files from this listing.\n\n" + $ls }
  ]
}' | curl -sX POST http://airelay.local:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- -i | head -20
```

**Expected:** `ls-long-shrink` fires, ≥ 50% byte reduction (the
size/owner/perm columns are stripped).

### Scenario C — Full `npm install` log

Targets `npm-noise-strip` + `blankline-collapse` + `ansi-strip`.
Capture a real noisy install:

```bash
cd /tmp && rm -rf npm-noise && mkdir npm-noise && cd npm-noise
echo '{"name":"x","version":"1.0.0"}' > package.json
npm install express@^4 --loglevel=info --no-audit 2>&1 | head -200 > /tmp/npm.log
# Add some noise manually if your local cache makes it too clean
echo -e "\nnpm WARN deprecated example-old@1.0.0: replaced by example-new" >> /tmp/npm.log
echo "npm notice created a lockfile" >> /tmp/npm.log
echo "found 5 vulnerabilities (2 moderate, 3 high)" >> /tmp/npm.log
```

```bash
jq -Rn --rawfile log /tmp/npm.log '{
  model: "mistral-small-latest",
  messages: [
    { role: "user",
      content: "Did anything go wrong in this install?\n\n" + $log }
  ]
}' | curl -sX POST http://airelay.local:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- -i | head -20
```

**Expected:** `npm-noise-strip` fires, `blankline-collapse` likely fires.
`npm ERR!` lines (if any) **must be preserved** — verify by checking
`/api/compactor/recent` against the input.

### Scenario D — Node stacktrace with repeated frames

Targets `stacktrace-dedupe`.

```bash
cat > /tmp/stack.txt <<'EOF'
RangeError: Maximum call stack size exceeded
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at main (file.js:10:1)
EOF

jq -Rn --rawfile s /tmp/stack.txt '{
  model: "mistral-small-latest",
  messages: [{ role: "user", content: "Diagnose this crash:\n\n" + $s }]
}' | curl -sX POST http://airelay.local:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- -i | head -20
```

**Expected:** `stacktrace-dedupe` fires.

### Scenario E — 600-line file dump (risky)

Targets `long-file-elide`. **Requires `COMPACTOR_ALLOW_RISKY=true`.**

```bash
seq 1 600 | awk '{print "line " $1}' > /tmp/big.txt

jq -Rn --rawfile f /tmp/big.txt '{
  model: "mistral-small-latest",
  messages: [{ role: "user",
    content: "Find any duplicate line numbers:\n\n" + $f }]
}' | curl -sX POST http://airelay.local:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- -i | head -20
```

**Expected:** `long-file-elide` fires; ≥ 80% byte reduction; banner
visible in the upstream-bound payload via dashboard recent events.

### Scenario F — Base64-embedded image

Targets `base64-truncate`.

```bash
# Any small PNG works; example uses a 1×1 black PNG
B64=$(printf '\x89PNG\r\n\x1a\n%.0s' {1..400} | base64 -w0)

jq -n --arg b "$B64" '{
  model: "mistral-small-latest",
  messages: [
    { role: "user",
      content: "Describe this base64 PNG header: " + $b }
  ]
}' | curl -sX POST http://airelay.local:3000/proxy/v1/chat/completions \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- -i | head -20
```

**Expected:** `base64-truncate` fires; replaces blob with
`<base64: N bytes, sha256:...>`.

---

## 2. Pass / fail gates

For the runbook to be considered green:

- All 6 scenarios return `200 OK` from Mistral (proves mutation didn't
  break the upstream contract).
- Every scenario sets `X-Compactor-Applied: <one or more filter names>`
  that includes the **targeted** compressor.
- Lifetime `Bytes saved` KPI on the dashboard increases by **≥ 30%
  cumulative** across all 6 scenarios vs the starting baseline.
- `npm ERR!` lines from Scenario C are preserved verbatim in the
  upstream-bound payload.
- No console errors in the dashboard during the run.

---

## 3. Cleanup

```bash
# Disable Compactor in .env
sed -i.bak 's/^COMPACTOR_ENABLED=true/COMPACTOR_ENABLED=false/' .env
npm run docker:down && npm run docker:up

# Unset the key
unset MISTRAL_API_KEY
```

---

## 4. Evidence capture (optional)

If you want to commit the screenshots as living examples of the feature:

```bash
mkdir -p docs/compactor/evidence
# Save your Chrome MCP screenshots / GIFs into docs/compactor/evidence/{A..F}.png
# Then edit .gitignore to allow them, and add to a follow-up PR.
```

This is **not** part of the default release — it's a separate optional
PR titled `docs(compactor): add real-world compression evidence`.
