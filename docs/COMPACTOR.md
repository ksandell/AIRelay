# Compactor

Opt-in prompt and response compression for AIRelay.

Compactor is a marquee feature of **v0.3.0**. It sits between your application
and the upstream LLM, parses each request, walks the messages, and runs a
pipeline of deterministic text compressors on the bloated parts —
`tool_result` blocks where shell output lands, `git diff` hunks, `npm install`
logs, lockfile diffs, ANSI color codes, repeated log lines, and more.

It is **default-off**. AIRelay's identity remains "transparent passthrough":
when Compactor is disabled, every byte AIRelay receives is the byte it
forwards. Enabling it is an explicit choice: a master env switch plus, if
desired, per-request header overrides.

## Table of Contents

1. [Overview & why](#1-overview--why)
2. [Quickstart](#2-quickstart)
3. [Activation model](#3-activation-model)
4. [Compressor catalog](#4-compressor-catalog)
    - [Before / After gallery](#41-before--after-gallery)
5. [Banner format](#5-banner-format)
6. [Metrics & dashboard](#6-metrics--dashboard)
7. [Streaming behavior](#7-streaming-behavior)
8. [Operational concerns](#8-operational-concerns)
9. [Safety model](#9-safety-model)
10. [Tuning recipes](#10-tuning-recipes)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Overview & why

LLM context windows are valuable real estate. Agents that shell out to
`git diff`, `npm install`, `ls -l`, or large file reads routinely pump
tens of thousands of tokens of low-signal noise back to the model. That
noise displaces real code, real errors, and the agent's reasoning room.

VSCode 1.120 shipped `chat.tools.compressOutput.enabled` to attack this
client-side. Compactor brings the same idea to AIRelay so **any** consumer
of the proxy benefits — no SDK change, no agent rewrite.

A real example. A `git diff` over a refactored package-lock.json:

| Variant | Bytes | ~Tokens |
|---|---|---|
| Raw `tool_result`              | 92,418 | ~23,100 |
| After Compactor (lockfile-drop + diff-collapse + blankline-collapse) | 3,127 | ~780 |
| Savings                        | **96.6%** | **96.6%** |

That's 22,000 tokens that go back to your context.

## 2. Quickstart

Enable the master switch:

```bash
# .env (or docker-compose env)
COMPACTOR_ENABLED=true
```

Restart AIRelay. From this point any client request through the proxy
prefix runs through Compactor. To **opt a single request out** at runtime:

```http
POST /proxy/v1/messages
X-Compactor: off
Content-Type: application/json
...
```

To watch it work: open the dashboard at `http://airelay.local:3000/` and
click the **Compactor** tab. Each compressed request adds a row.

## 3. Activation model

Compactor has three independent decisions on every request: **is it on?**,
**which scopes apply?**, **which compressors run?**

### Master switch

| Var | Default | Effect |
|---|---|---|
| `COMPACTOR_ENABLED` | `false` | When `false`, Compactor is a single boolean check on the request hot path — zero buffering, zero parsing, identity passthrough. |

### Per-request override

The `X-Compactor` request header overrides the master switch for one
request. Header is stripped before the request is forwarded upstream.

| Value | Effect |
|---|---|
| `on` / `true` / `enabled`   | Run Compactor (only meaningful when the master is also on; reserved for future per-request opt-in even when default is off) |
| `off` / `bypass` / `false`  | Skip Compactor for this request — byte-identical passthrough |

The response always carries `X-Compactor-Applied: <comma-sep-filters>` when
Compactor mutated the body, or `X-Compactor-Applied: bypass-streaming` when
a streaming request bypassed it. This is an **audit trail** — clients can
record it for diff-against-original analysis.

### Scopes

| Var | Default | Effect |
|---|---|---|
| `COMPACTOR_REQUEST_BODY` | `true` | Compress outgoing prompts (the VSCode-equivalent direction) |
| `COMPACTOR_RESPONSE_BODY` | `false` | Compress incoming responses (off by default — see [v2 roadmap](#v2-roadmap)) |
| `COMPACTOR_TOOL_RESULT_ONLY` | `true` | Only mutate inside `tool_result` / `role: "tool"` content. When `false`: all message content (still skips `system` unless `COMPACTOR_ALLOW_RISKY=true`) |

### Per-compressor toggles

Every compressor can be individually disabled. Set
`COMPACTOR_<NAME>_ENABLED=false` (uppercased, dashes → underscores) to drop
it from the pipeline without disabling the rest.

```bash
COMPACTOR_DIFF_COLLAPSE_ENABLED=false   # keep diffs untouched
COMPACTOR_LONG_FILE_ELIDE_ENABLED=true  # opt-in to risky compressor (requires COMPACTOR_ALLOW_RISKY)
```

### Risky compressors

Compressors marked `risky: true` can drop content the model needs. They
are gated behind a separate flag:

```bash
COMPACTOR_ALLOW_RISKY=false   # default — risky compressors skipped
COMPACTOR_ALLOW_RISKY=true    # opt in
```

Currently only `long-file-elide` is risky.

## 4. Compressor catalog

Pipeline order is fixed in `src/compactor/registry.js`. Normalizers run
first so downstream compressors see canonical input.

| # | Name | Risky | Purpose | Deep-dive |
|---|---|---|---|---|
| 1 | `ansi-strip`         | no  | Remove ANSI color/escape sequences | [doc](compactor/compressors/ansi-strip.md) |
| 2 | `blankline-collapse` | no  | 3+ blank lines → 1 | [doc](compactor/compressors/blankline-collapse.md) |
| 3 | `lockfile-drop`      | no  | Replace lockfile diff body with `<lockfile diff omitted: N lines>` | [doc](compactor/compressors/lockfile-drop.md) |
| 4 | `diff-collapse`      | no  | Unchanged hunks in unified diffs → `... N lines unchanged ...` (keeps 3 lines of context) | [doc](compactor/compressors/diff-collapse.md) |
| 5 | `ls-long-shrink`     | no  | `ls -l` output → names column only | [doc](compactor/compressors/ls-long-shrink.md) |
| 6 | `npm-noise-strip`    | no  | Strip `npm WARN deprecated`, progress bars, audit summary, funding (keeps `npm ERR!`) | [doc](compactor/compressors/npm-noise-strip.md) |
| 7 | `repeat-line-dedupe` | no  | Consecutive identical lines → `<line repeated N more times>` | [doc](compactor/compressors/repeat-line-dedupe.md) |
| 8 | `stacktrace-dedupe`  | no  | Repeated identical frames → `<frame repeated N more times>` | [doc](compactor/compressors/stacktrace-dedupe.md) |
| 9 | `base64-truncate`    | no  | Long base64 runs → `<base64: N bytes, sha256:...>` | [doc](compactor/compressors/base64-truncate.md) |
| 10 | `long-file-elide`   | **yes** | Text segments > N lines → keep head/tail, elide middle | [doc](compactor/compressors/long-file-elide.md) |

### 4.1 Before / After gallery

One concrete example per compressor, sourced from the property tests at
[tests/compactor/compressors.property.test.js](../tests/compactor/compressors.property.test.js).
Byte counts are exact. Token counts use the standard ~4 chars / token
heuristic and are rounded; exact values vary by tokenizer (Anthropic /
OpenAI / Google differ by ±15%).

> Every example below is the raw output of the corresponding compressor on
> the input shown — no banner prefix and no pipeline composition. The banner
> is added by `src/compactor/pipeline.js` after at least one compressor fires;
> see [§5 Banner format](#5-banner-format).

---

#### 1. `ansi-strip` &nbsp; <small>category: normalizer · safe</small>

Strips ANSI color/escape sequences. Always runs first so downstream
compressors see plain text.

**Before** (37 bytes ≈ 9 tokens)

```
\x1b[31merror\x1b[0m: \x1b[1mbold\x1b[0m text
```

**After** (16 bytes ≈ 4 tokens)

```
error: bold text
```

**Savings:** -21 bytes (-57%) · ~5 tokens saved.
**Use on:** colored CI logs, `git --color=always`, `npm` output.
**Watch out for:** none — color codes carry no signal to the model.
**Toggle:** `COMPACTOR_ANSI_STRIP_ENABLED`.

---

#### 2. `blankline-collapse` &nbsp; <small>category: normalizer · safe</small>

3+ consecutive blank lines collapse to a single blank line.

**Before** (8 bytes ≈ 2 tokens)

```
a




b
```

**After** (4 bytes ≈ 1 token)

```
a

b
```

**Savings:** -4 bytes (-50%) on this trivial case; 2–8% on real logs.
**Use on:** verbose CLI output, stack-trace blocks separated by whitespace.
**Watch out for:** none — preserves a single blank between paragraphs.
**Toggle:** `COMPACTOR_BLANKLINE_COLLAPSE_ENABLED`.

---

#### 3. `lockfile-drop` &nbsp; <small>category: heuristic · safe</small>

Detects unified diffs of `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`
and replaces the body with a one-liner summary. Lockfile churn is the single
largest source of low-signal tokens in agent traffic.

**Before** (~1.2 KB ≈ 300 tokens — header + 50 lines of version bumps)

```
diff --git a/package-lock.json b/package-lock.json
index abc..def 100644
--- a/package-lock.json
+++ b/package-lock.json
+    "version": "1.0.0"
+    "version": "1.0.1"
+    "version": "1.0.2"
... 48 more "version" lines ...
```

**After** (~140 bytes ≈ 35 tokens)

```
diff --git a/package-lock.json b/package-lock.json
index abc..def 100644
--- a/package-lock.json
+++ b/package-lock.json
<lockfile diff omitted: 50 lines>
```

**Savings:** ~88% bytes / tokens on the fixture. Real-world example from
[§1 Overview & why](#1-overview--why): 92,418 B → 3,127 B (**-96.6%**).
**Use on:** any agent that runs `npm install`, `yarn add`, `pnpm i`.
**Watch out for:** drops all version-bump detail — if you need to know which
package moved from x → y, request raw via `X-Compactor: off`.
**Toggle:** `COMPACTOR_LOCKFILE_DROP_ENABLED`.

---

#### 4. `diff-collapse` &nbsp; <small>category: heuristic · safe</small>

In a unified diff, runs of unchanged context lines (8+) collapse to a
3-line head + elision marker + 3-line tail. **Never drops `+`/`-` lines**
(property-tested invariant).

**Before** (~520 bytes ≈ 130 tokens — `@@` header + 15 context + 2 change + 15 context)

```
@@ -1,20 +1,20 @@
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
 unchanged line
-removed
+added
 more unchanged
 more unchanged
... (13 more) ...
```

**After** (~210 bytes ≈ 52 tokens)

```
@@ -1,20 +1,20 @@
 unchanged line
 unchanged line
 unchanged line
... 12 lines unchanged ...
-removed
+added
 more unchanged
 more unchanged
 more unchanged
... 12 lines unchanged ...
```

**Savings:** ~60% bytes / tokens on this fixture; 60–90% on real multi-hunk diffs.
**Use on:** `git diff`, code review prompts.
**Watch out for:** none for safety — the property test in
`safe-substring preservation` guarantees `+`/`-` lines are never dropped.
**Toggle:** `COMPACTOR_DIFF_COLLAPSE_ENABLED`.

---

#### 5. `ls-long-shrink` &nbsp; <small>category: heuristic · safe</small>

`ls -l` output collapses to filenames only. Permission bits, owner, group,
size, and date carry minimal signal in a chat context.

**Before** (193 bytes ≈ 48 tokens)

```
total 24
-rw-r--r--  1 alice group  1234 May 10 12:34 alpha.txt
-rw-r--r--  1 alice group  5678 May 10 12:35 beta.txt
-rwxr-xr-x  1 alice group  9999 May 10 12:36 gamma.sh
```

**After** (27 bytes ≈ 7 tokens)

```
alpha.txt
beta.txt
gamma.sh
```

**Savings:** -166 bytes (**-86%**) · ~41 tokens saved.
**Use on:** any agent that does `ls -l`, `ls -la`, file inventory dumps.
**Watch out for:** drops permission/owner info — if the model needs to
reason about file ownership or `+x` bits, set `X-Compactor: off`.
**Toggle:** `COMPACTOR_LS_LONG_SHRINK_ENABLED`.

---

#### 6. `npm-noise-strip` &nbsp; <small>category: heuristic · safe</small>

Strips `npm WARN deprecated`, `npm notice`, audit summaries, and progress
bars. **Never strips `npm ERR!`** (property-tested invariant) so real
failures still reach the model.

**Before** (130 bytes ≈ 32 tokens)

```
npm WARN deprecated old@1.0.0: use new@2
npm notice created a lockfile
found 2 vulnerabilities
npm ERR! something exploded
```

**After** (27 bytes ≈ 7 tokens)

```
npm ERR! something exploded
```

**Savings:** -103 bytes (**-79%**) · ~25 tokens saved.
**Use on:** any agent running `npm install`, `npm audit`, `npm publish`.
**Watch out for:** Yarn 2 / pnpm patterns are subtly different — file an
issue if you see noise leaking through.
**Toggle:** `COMPACTOR_NPM_NOISE_STRIP_ENABLED`.

---

#### 7. `repeat-line-dedupe` &nbsp; <small>category: heuristic · safe</small>

Consecutive identical lines (3+) collapse to a single line + a counter.

**Before** (370 bytes ≈ 92 tokens)

```
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
connection reset by peer at 192.168.1.42 retrying...
OK
```

**After** (87 bytes ≈ 21 tokens)

```
connection reset by peer at 192.168.1.42 retrying...
<line repeated 6 more times>
OK
```

**Savings:** -283 bytes (**-76%**) · ~71 tokens saved.
**Use on:** flaky-network retry loops, polling logs, watch-mode output.
**Watch out for:** isolated duplicates (2 in a row) are untouched on purpose.
**Toggle:** `COMPACTOR_REPEAT_LINE_DEDUPE_ENABLED`.

---

#### 8. `stacktrace-dedupe` &nbsp; <small>category: heuristic · safe</small>

Repeated identical stack frames (3+) collapse to a single frame + counter.
Detects Node, Python, Java, Ruby, and Go frame syntaxes.

**Before** (165 bytes ≈ 41 tokens)

```
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
    at recurse (file.js:1:1)
caused by error
```

**After** (~85 bytes ≈ 21 tokens)

```
    at recurse (file.js:1:1)
<frame repeated 4 more times>
caused by error
```

**Savings:** ~48% bytes / tokens on this fixture; 30–50% on real infinite-recursion stacks.
**Use on:** recursive call traces, error chains.
**Watch out for:** 2 identical frames are kept; only 3+ collapse.
**Toggle:** `COMPACTOR_STACKTRACE_DEDUPE_ENABLED`.

---

#### 9. `base64-truncate` &nbsp; <small>category: heuristic · safe</small>

Long base64 runs (256+ chars) replaced with a length + sha256 fingerprint
so the model can still reference the blob without paying the token cost.

**Before** (~415 bytes ≈ 103 tokens)

```
prefix AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
... 400 chars total ...
AAAAAA suffix
```

**After** (~70 bytes ≈ 17 tokens)

```
prefix <base64: 300 bytes, sha256:abc123def456> suffix
```

**Savings:** ~83% bytes / tokens on this fixture; 80–95% on embedded images / PDFs.
**Use on:** prompts that paste images, certificates, binary blobs as base64.
**Watch out for:** the model can no longer read the blob content — only
reason about it. If decoding is required, `X-Compactor: off`.
**Toggle:** `COMPACTOR_BASE64_TRUNCATE_ENABLED`.

---

#### 10. `long-file-elide` &nbsp; <small>category: aggressive · **risky**</small>

Text segments > N lines (default 400, configurable via
`COMPACTOR_LONG_FILE_THRESHOLD`) keep the first 50 and last 50 lines; the
middle is elided. **Requires `COMPACTOR_ALLOW_RISKY=true`** — drops user-
authored content.

**Before** (~3.5 KB ≈ 870 tokens — 500 lines of `line 0`…`line 499`)

```
line 0
line 1
line 2
... 497 more lines ...
line 499
```

**After** (~800 bytes ≈ 200 tokens — first 50 + elision + last 50)

```
line 0
line 1
...
line 49
<400 lines elided>
line 450
line 451
...
line 499
```

**Savings:** ~77% bytes / tokens on this fixture; 40–70% on large file pastes.
**Use on:** prompts that include entire files as context.
**Watch out for:** drops the **middle** of the file — if the model needs
line 250, it can't see it. Tune `COMPACTOR_LONG_FILE_THRESHOLD` to raise
the cutoff, or set `X-Compactor: off` per-request.
**Toggle:** `COMPACTOR_LONG_FILE_ELIDE_ENABLED` (also needs `COMPACTOR_ALLOW_RISKY=true`).

---

#### Pipeline composition example

A realistic `npm install` `tool_result` block hits multiple compressors in
sequence. Here's what they produce together:

**Before** (~640 bytes ≈ 160 tokens — ANSI codes + double-blank lines + repeated WARN + ERR)

```
\x1b[31merror\x1b[0m


npm WARN deprecated foo@1.0.0: use foo@2
npm WARN deprecated foo@1.0.0: use foo@2
npm WARN deprecated foo@1.0.0: use foo@2
npm WARN deprecated foo@1.0.0: use foo@2
npm WARN deprecated foo@1.0.0: use foo@2
npm WARN deprecated foo@1.0.0: use foo@2
found 3 vulnerabilities (1 high, 2 moderate)
npm ERR! ELIFECYCLE
```

**After** (~75 bytes ≈ 19 tokens) — pipeline order: `ansi-strip` → `blankline-collapse` → `npm-noise-strip` →
`repeat-line-dedupe` left with only the surviving `npm ERR!`:

```
[compactor: applied filters=ansi-strip,blankline-collapse,npm-noise-strip; bytes 640->75 (-88%); set header X-Compactor: off to bypass]
error

npm ERR! ELIFECYCLE
```

**Cumulative savings:** ~88% bytes / tokens. The model still sees the
single failure signal — `npm ERR! ELIFECYCLE` — and is told what was elided
plus how to opt out.

---

## 5. Banner format

When at least one compressor fires, the mutated text segment is prefixed
with a banner so the model knows what it's looking at:

```
[compactor: applied filters=diff-collapse,ansi-strip; bytes 12340->3120 (-75%); set header X-Compactor: off to bypass]
```

This is intentional — mirrors VSCode's design. The model is told **how to
ask for the raw text** if a critical detail was elided. The exact format
is a stable constant (`src/compactor/banner.js`); downstream tooling can
parse it.

## 6. Metrics & dashboard

### Lifetime counters

Available at `GET /api/compactor/summary`:

```json
{
  "enabled": true,
  "settings": { "requestBody": true, "responseBody": false, "toolResultOnly": true, "allowRisky": false, "maxReqBytes": 4194304, "longFileThreshold": 400 },
  "compressors": { "all": ["ansi-strip", ...], "active": ["ansi-strip", ...] },
  "windows": { "1m": {...}, "5m": {...}, "15m": {...} },
  "lifetime": {
    "requestsCompressed": 124,
    "requestsBypassed": 7,
    "bytesIn": 4214221,
    "bytesOut": 1018443,
    "bytesSaved": 3195778,
    "byCompressor": {
      "diff-collapse":    { "fires": 88,  "bytesSaved": 1872220, "durationMicros": 113000 },
      "lockfile-drop":    { "fires": 12,  "bytesSaved":  982111, "durationMicros":  18000 },
      "ansi-strip":       { "fires": 104, "bytesSaved":   12001, "durationMicros":   8000 }
    },
    "bypassReasons": { "streaming": 5, "no-fires": 2 }
  }
}
```

### Recent events

`GET /api/compactor/recent?limit=50` returns the last N per-request events.

### Dashboard

The **Compactor** tab in the AIRelay dashboard surfaces:

- **KPI cards**: bytes saved (1m / 5m / lifetime), estimated tokens saved
  (lifetime), compression ratio (5m), total bypasses
- **Compressors table**: name, active flag, fires, bytes saved, average µs per fire
- **Recent events table**: timestamp, scope, filters fired, in→out bytes, saved, µs, bypass reason

### The token estimate

We deliberately do **not** ship a tokenizer in v1. "Estimated tokens
saved" is reported as `bytes_saved / 4`, a common rule of thumb for
English/code BPE tokenizers. It is an estimate, not a measurement.

- Underestimates: dense whitespace (tokenizes < 4 bytes/token) and emoji
- Overestimates: long identifiers (tokenizes > 4 bytes/token)

For real numbers, mirror traffic through a `/tokenize` endpoint on your
provider. A tokenizer integration is on the v2 roadmap.

## 7. Streaming behavior

Streaming requests (`"stream": true` in the request body) **bypass
Compactor entirely**. Buffering them would defeat the point of streaming
and would also force AIRelay to violate its first-byte-latency guarantees.

Bypassed streaming requests get:

- A `compactor.streaming_bypass` counter in lifetime metrics
- `X-Compactor-Applied: bypass-streaming` response header
- An event row in `/api/compactor/recent` with `bypassReason: "streaming"`

A common pattern: agents do non-streaming "tool" turns and streaming
"final answer" turns. Compactor will fire on the former and bypass on the
latter — exactly what you want.

## 8. Operational concerns

### Buffering cap

Compactor reads the request body into memory before parsing. The cap is
controlled by `COMPACTOR_MAX_REQ_BYTES` (default **4 MB**).

A request whose body exceeds the cap is **rejected with HTTP 413**, not
silently bypassed. The error body advises clients to retry with
`X-Compactor: off`. This is deliberate — we'd rather fail loudly than
quietly send a giant body through a half-active pipeline.

Tune up if you have legitimate large-context use cases:

```bash
COMPACTOR_MAX_REQ_BYTES=16777216   # 16 MB
```

### Latency

Per request, Compactor adds:

- Buffering: O(body size). On a localhost link this is sub-millisecond
  for typical prompts (< 1 MB).
- JSON parse + walk: < 5 ms for typical 100 KB bodies on modern hardware.
- Per-compressor: each pass is reported in `durationMicros` in metrics.
  Total pipeline overhead on a bloated 100 KB body: typically 1–10 ms.

For latency-sensitive workloads, disable expensive compressors with
`COMPACTOR_<NAME>_ENABLED=false`, or use `X-Compactor: off` on hot paths.

### Disabling at runtime

Compactor is stateless — env vars are read at boot. To change settings,
restart the process. There is no SIGHUP-reload mechanism in v1.

## 9. Safety model

Compactor is a **mutator** of bytes that AIRelay was historically
documented as never modifying. The safety model is layered:

1. **Default off.** No traffic mutates unless an operator explicitly
   sets `COMPACTOR_ENABLED=true`.
2. **Per-request opt-out.** Even when on, any client can send
   `X-Compactor: off` and get byte-identical passthrough.
3. **System messages skipped.** The `system` role is never mutated unless
   `COMPACTOR_ALLOW_RISKY=true`.
4. **Risky compressors gated.** `long-file-elide` is off unless
   `COMPACTOR_ALLOW_RISKY=true`.
5. **Tool-result-only by default.** With the default
   `COMPACTOR_TOOL_RESULT_ONLY=true`, user-authored prompt text is left
   alone — only shell output / tool returns are compressed.
6. **Property-tested invariants.** Every compressor's tests assert:
   - never grows the output
   - is idempotent
   - preserves declared safe substrings (e.g. `diff-collapse` cannot
     drop `+`/`-` lines; `npm-noise-strip` cannot strip `npm ERR!`)
7. **Audit trail in response headers.** `X-Compactor-Applied` lists every
   filter that fired so a client can prove a diff against the original.
8. **Banner to the model.** The mutated content carries a self-describing
   banner; the model is told how to ask for raw text.

If you spot a behavioral regression caused by compression, the right
mitigation is almost always:

1. `X-Compactor: off` on the failing request to confirm it's a Compactor
   issue.
2. `COMPACTOR_<offending>_ENABLED=false` to disable just that compressor.
3. File an issue with a fixture so we can add it to the test corpus.

## 10. Tuning recipes

### Conservative

Safe baseline. Strips obvious noise, leaves anything structural alone.

```bash
COMPACTOR_ENABLED=true
COMPACTOR_TOOL_RESULT_ONLY=true
COMPACTOR_ALLOW_RISKY=false
COMPACTOR_DIFF_COLLAPSE_ENABLED=false
COMPACTOR_LS_LONG_SHRINK_ENABLED=false
COMPACTOR_STACKTRACE_DEDUPE_ENABLED=false
# Active: ansi-strip, blankline-collapse, lockfile-drop, npm-noise-strip,
#         repeat-line-dedupe, base64-truncate
```

### Default

What you get with just `COMPACTOR_ENABLED=true`: every compressor on
except risky ones, scoped to tool-result blocks.

### Aggressive

Maximum compression, including risky compressors and full message scope.

```bash
COMPACTOR_ENABLED=true
COMPACTOR_TOOL_RESULT_ONLY=false
COMPACTOR_ALLOW_RISKY=true
COMPACTOR_LONG_FILE_THRESHOLD=200
```

Use with verification: enable, run a representative workload, eyeball
the dashboard to confirm models still complete tasks correctly.

## 11. Troubleshooting

### "The model keeps asking for the raw output."

The banner is doing its job — the model spotted that elided content
matters. Either disable the firing compressor on that request
(`X-Compactor: off`) or globally
(`COMPACTOR_<NAME>_ENABLED=false`).

### "Compression ratio is lower than expected."

Check the dashboard's per-compressor table. If `diff-collapse` and
`lockfile-drop` show zero fires, your traffic doesn't actually contain
the patterns they target — Compactor only helps with the shapes it
recognizes. Check `/api/compactor/recent` for `bypassReason` values:
`non-json`, `unsupported-provider`, or `no-fires` are common signals.

### "Streaming bypass is too frequent."

That's expected if your agent streams everything. Compactor cannot
compress streaming bodies in v1. Either tell the SDK to use
non-streaming for tool turns, or wait for v2 (incremental SSE
compression is on the roadmap).

### "Bytes-saved counters look wrong."

Counters are bytes of the JSON request body, not bytes inside individual
fields. A 50-byte savings inside a 100 KB body is real but invisible at
the dashboard granularity. Use `/api/compactor/recent` to see per-event
detail.

### v2 roadmap

- Streaming-request compression via incremental SSE rewriting
- Real tokenizer integration (js-tiktoken / anthropic tokenizer)
- Response-body compression (currently scope-flagged but inert)
- Semantic compressors (LLM-as-summarizer) for very long content
- Hot-reload of compressor toggles without process restart
- Per-route configuration (different settings for `/proxy/v1/messages`
  vs `/proxy/v1/chat/completions`)
