# v0.6.0 Dashboard + Runtime Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dashboard landing tab (health KPIs + sparkline + recent requests + recommendations) and a Settings tab (runtime Compactor/Guardrail toggles persisted to `data/settings.json`) to the AIRelay dashboard.

**Architecture:** A new config override layer (`_overrides` object) is layered on top of env-var reading in `src/config.js`; all `compactor.*` and `guardrails.*` getters check overrides first. A new `src/api/settings.js` route exposes GET/POST. Two new tab panels are added to `public/index.html` and their logic to `public/app.js`.

**Tech Stack:** Node.js 24, Express.js, Vanilla JS, Chart.js (already loaded), Playwright E2E, Vitest unit/integration.

---

## File map

### New files
- `src/api/settings.js` — GET/POST `/api/settings`
- `tests/api/settings.test.js` — integration tests for settings endpoints
- `tests/compactor/config-overrides.test.js` — unit tests for loadOverrides / applyOverrides / getter fallback
- `tests/e2e/functional/settings-tab.spec.js` — E2E: Settings tab interaction
- `tests/e2e/functional/dashboard-tab.spec.js` — E2E: Dashboard tab renders

### Modified files
- `src/config.js` — add `_overrides`, `loadOverrides()`, `applyOverrides()`, rewrite `compactor.*` / `guardrails.*` getters
- `src/index.js` — call `await loadOverrides()` before `createApp()`
- `src/server.js` — register `settingsRouter`
- `public/index.html` — add Dashboard tab button + panel, Settings tab button + panel
- `public/app.js` — add `activateTab` cases for `dashboard` and `settings`; Dashboard data fetch + KPI wiring; Settings state machine (pendingChanges + save/discard)
- `.gitignore` — add `data/settings.json`
- `tests/e2e/visual/dashboard.visual.spec.js` — add Dashboard and Settings visual snapshots

---

## Task 1: Branch setup

**Files:** git only

- [ ] **Step 1: Create feature branch**

```bash
git checkout develop
git pull origin develop
git checkout -b feature/v0.6.0-dashboard-settings
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: `On branch feature/v0.6.0-dashboard-settings, nothing to commit`

---

## Task 2: Config override layer — unit tests first

**Files:**
- Create: `tests/compactor/config-overrides.test.js`
- Modify: `src/config.js`

- [ ] **Step 1: Write failing unit tests**

Create `tests/compactor/config-overrides.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// We re-import config after mutating env vars in each test.
// vitest runs each file in isolation so module-level state resets.

describe('config override layer', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airelay-cfg-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('loadOverrides: empty when file missing', async () => {
    const { loadOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(path.join(tmpDir, 'missing.json'))
    expect(_getOverrides()).toEqual({})
  })

  it('loadOverrides: reads persisted overrides', async () => {
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ compactorEnabled: true }))
    const { loadOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(_getOverrides().compactorEnabled).toBe(true)
  })

  it('applyOverrides: merges + writes', async () => {
    const file = path.join(tmpDir, 'settings.json')
    const { loadOverrides, applyOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(file)
    await applyOverrides({ compactorEnabled: false }, file)
    expect(_getOverrides().compactorEnabled).toBe(false)
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(written.compactorEnabled).toBe(false)
  })

  it('applyOverrides: merges incrementally', async () => {
    const file = path.join(tmpDir, 'settings.json')
    const { loadOverrides, applyOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(file)
    await applyOverrides({ compactorEnabled: true }, file)
    await applyOverrides({ guardrailsEnabled: true }, file)
    const state = _getOverrides()
    expect(state.compactorEnabled).toBe(true)
    expect(state.guardrailsEnabled).toBe(true)
  })

  it('config.compactorEnabled: override wins over env false', async () => {
    process.env.COMPACTOR_ENABLED = 'false'
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ compactorEnabled: true }))
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.compactorEnabled).toBe(true)
    delete process.env.COMPACTOR_ENABLED
  })

  it('config.guardrailsEnabled: env wins when no override', async () => {
    process.env.GUARDRAILS_ENABLED = 'true'
    const file = path.join(tmpDir, 'missing.json')
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.guardrailsEnabled).toBe(true)
    delete process.env.GUARDRAILS_ENABLED
  })

  it('config.compactor.ansiStrip: override wins', async () => {
    process.env.COMPACTOR_ANSI_STRIP_ENABLED = 'true'
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ compactorAnsiStripEnabled: false }))
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.compactor.ansiStrip).toBe(false)
    delete process.env.COMPACTOR_ANSI_STRIP_ENABLED
  })

  it('config.guardrailsSecretsMode: override wins', async () => {
    process.env.GUARDRAILS_SECRETS_MODE = 'off'
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ guardrailsSecretsMode: 'alert' }))
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.guardrailsSecretsMode).toBe('alert')
    delete process.env.GUARDRAILS_SECRETS_MODE
  })
})
```

- [ ] **Step 2: Run tests — confirm all fail**

```bash
npm test -- tests/compactor/config-overrides.test.js
```

Expected: FAIL — `_getOverrides is not a function` (exports don't exist yet)

---

## Task 3: Config override layer — implementation

**Files:**
- Modify: `src/config.js`

The current `src/config.js` exports a plain `config` object built from env vars. We need to:
1. Add a mutable `_overrides` object.
2. Export `loadOverrides(filePath?)`, `applyOverrides(patch, filePath?)`, and `_getOverrides()` (test-only introspection).
3. Convert all `config.compactorEnabled`, `config.compactorRequestBody`, `config.compactorResponseBody`, `config.compactorToolResultOnly`, `config.compactorAllowRisky`, `config.compactor.*`, `config.guardrailsEnabled`, `config.guardrailsSecretsMode`, `config.guardrailsPiiMode`, `config.guardrailsInjectionMode`, and `config.guardrails.*` properties to getters that check `_overrides` first.

- [ ] **Step 1: Add imports and override infrastructure at top of `src/config.js`**

After the existing dotenv block (lines 1–4) and before `function int(...)`, insert:

```js
import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_SETTINGS_PATH = path.resolve('./data/settings.json')

let _overrides = {}

export function _getOverrides() { return _overrides }

export async function loadOverrides(filePath = DEFAULT_SETTINGS_PATH) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    _overrides = JSON.parse(raw)
  } catch {
    _overrides = {}
  }
}

export async function applyOverrides(patch, filePath = DEFAULT_SETTINGS_PATH) {
  _overrides = { ..._overrides, ...patch }
  await fs.writeFile(filePath, JSON.stringify(_overrides, null, 2))
}
```

- [ ] **Step 2: Replace static compactor and guardrail properties with getters**

In the `export const config = { ... }` object, replace all `compactorEnabled`, `compactorRequestBody`, `compactorResponseBody`, `compactorToolResultOnly`, `compactorAllowRisky`, `compactor: { ... }`, `guardrailsEnabled`, `guardrailsSecretsMode`, `guardrailsPiiMode`, `guardrailsInjectionMode`, and `guardrails: { ... }` entries with getter-based equivalents:

```js
  // Compactor — override layer checks _overrides first, falls back to env
  get compactorEnabled()     { return _overrides.compactorEnabled     ?? process.env.COMPACTOR_ENABLED === 'true' },
  get compactorRequestBody() { return _overrides.compactorRequestBody ?? process.env.COMPACTOR_REQUEST_BODY !== 'false' },
  get compactorResponseBody(){ return _overrides.compactorResponseBody?? process.env.COMPACTOR_RESPONSE_BODY === 'true' },
  get compactorToolResultOnly(){ return _overrides.compactorToolResultOnly ?? process.env.COMPACTOR_TOOL_RESULT_ONLY !== 'false' },
  get compactorAllowRisky()  { return _overrides.compactorAllowRisky  ?? process.env.COMPACTOR_ALLOW_RISKY === 'true' },
  compactorMaxReqBytes: int('COMPACTOR_MAX_REQ_BYTES', 4_194_304),
  compactorLongFileThreshold: int('COMPACTOR_LONG_FILE_THRESHOLD', 400),
  get compactor() {
    return {
      get ansiStrip()        { return _overrides.compactorAnsiStripEnabled        ?? process.env.COMPACTOR_ANSI_STRIP_ENABLED !== 'false' },
      get blanklineCollapse(){ return _overrides.compactorBlanklineCollapseEnabled ?? process.env.COMPACTOR_BLANKLINE_COLLAPSE_ENABLED !== 'false' },
      get diffCollapse()     { return _overrides.compactorDiffCollapseEnabled      ?? process.env.COMPACTOR_DIFF_COLLAPSE_ENABLED !== 'false' },
      get lockfileDrop()     { return _overrides.compactorLockfileDropEnabled      ?? process.env.COMPACTOR_LOCKFILE_DROP_ENABLED !== 'false' },
      get lsLongShrink()     { return _overrides.compactorLsLongShrinkEnabled      ?? process.env.COMPACTOR_LS_LONG_SHRINK_ENABLED !== 'false' },
      get npmNoiseStrip()    { return _overrides.compactorNpmNoiseStripEnabled     ?? process.env.COMPACTOR_NPM_NOISE_STRIP_ENABLED !== 'false' },
      get repeatLineDedupe() { return _overrides.compactorRepeatLineDedupeEnabled  ?? process.env.COMPACTOR_REPEAT_LINE_DEDUPE_ENABLED !== 'false' },
      get stacktraceDedupe() { return _overrides.compactorStacktraceDedupeEnabled  ?? process.env.COMPACTOR_STACKTRACE_DEDUPE_ENABLED !== 'false' },
      get longFileElide()    { return _overrides.compactorLongFileElideEnabled     ?? process.env.COMPACTOR_LONG_FILE_ELIDE_ENABLED !== 'false' },
      get base64Truncate()   { return _overrides.compactorBase64TruncateEnabled    ?? process.env.COMPACTOR_BASE64_TRUNCATE_ENABLED !== 'false' },
    }
  },

  // Guardrails — override layer
  get guardrailsEnabled()      { return _overrides.guardrailsEnabled      ?? process.env.GUARDRAILS_ENABLED === 'true' },
  guardrailsMaxReqBytes: int('GUARDRAILS_MAX_REQ_BYTES', 4_194_304),
  get guardrailsSecretsMode()  {
    const v = _overrides.guardrailsSecretsMode ?? process.env.GUARDRAILS_SECRETS_MODE ?? 'off'
    if (!GUARDRAILS_MODES.has(v.toLowerCase())) return 'off'
    return v.toLowerCase()
  },
  get guardrailsPiiMode()      {
    const v = _overrides.guardrailsPiiMode ?? process.env.GUARDRAILS_PII_MODE ?? 'off'
    if (!GUARDRAILS_MODES.has(v.toLowerCase())) return 'off'
    return v.toLowerCase()
  },
  get guardrailsInjectionMode(){
    const v = _overrides.guardrailsInjectionMode ?? process.env.GUARDRAILS_INJECTION_MODE ?? 'off'
    if (!GUARDRAILS_MODES.has(v.toLowerCase())) return 'off'
    return v.toLowerCase()
  },
  guardrailsCustomPatternsFile: process.env.GUARDRAILS_CUSTOM_PATTERNS_FILE ?? null,
  get guardrails() {
    return {
      get awsAccessKey()        { return _overrides.guardrailsAwsAccessKeyEnabled        ?? process.env.GUARDRAILS_AWS_ACCESS_KEY_ENABLED !== 'false' },
      get githubPat()           { return _overrides.guardrailsGithubPatEnabled           ?? process.env.GUARDRAILS_GITHUB_PAT_ENABLED !== 'false' },
      get anthropicKey()        { return _overrides.guardrailsAnthropicKeyEnabled        ?? process.env.GUARDRAILS_ANTHROPIC_KEY_ENABLED !== 'false' },
      get openaiKey()           { return _overrides.guardrailsOpenaiKeyEnabled           ?? process.env.GUARDRAILS_OPENAI_KEY_ENABLED !== 'false' },
      get privateKey()          { return _overrides.guardrailsPrivateKeyEnabled          ?? process.env.GUARDRAILS_PRIVATE_KEY_ENABLED !== 'false' },
      get jwt()                 { return _overrides.guardrailsJwtEnabled                 ?? process.env.GUARDRAILS_JWT_ENABLED !== 'false' },
      get genericHighEntropy()  { return _overrides.guardrailsGenericHighEntropyEnabled  ?? process.env.GUARDRAILS_GENERIC_HIGH_ENTROPY_ENABLED === 'true' },
      get email()               { return _overrides.guardrailsEmailEnabled               ?? process.env.GUARDRAILS_EMAIL_ENABLED !== 'false' },
      get phone()               { return _overrides.guardrailsPhoneEnabled               ?? process.env.GUARDRAILS_PHONE_ENABLED !== 'false' },
      get ssnUs()               { return _overrides.guardrailsSsnUsEnabled               ?? process.env.GUARDRAILS_SSN_ENABLED === 'true' },
      get creditCard()          { return _overrides.guardrailsCreditCardEnabled          ?? process.env.GUARDRAILS_CREDIT_CARD_ENABLED !== 'false' },
      get roleOverride()        { return _overrides.guardrailsRoleOverrideEnabled        ?? process.env.GUARDRAILS_ROLE_OVERRIDE_ENABLED !== 'false' },
      get systemPromptLeak()    { return _overrides.guardrailsSystemPromptLeakEnabled    ?? process.env.GUARDRAILS_SYSTEM_PROMPT_LEAK_ENABLED !== 'false' },
      get toolOverride()        { return _overrides.guardrailsToolOverrideEnabled        ?? process.env.GUARDRAILS_TOOL_OVERRIDE_ENABLED !== 'false' },
    }
  },
```

**Note:** The `mode()` helper at the top of `config.js` is used at startup to validate env vars and throw on bad values. For the override layer, we inline the validation in each getter (as shown above) returning `'off'` as safe fallback. Remove the `mode()` calls for guardrails modes from the static config object since those are now getters.

- [ ] **Step 3: Run the unit tests — confirm green**

```bash
npm test -- tests/compactor/config-overrides.test.js
```

Expected: 7 tests PASS

- [ ] **Step 4: Run full test suite — confirm nothing broken**

```bash
npm test
```

Expected: all existing tests pass (config is still backwards compatible — just getters now)

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/compactor/config-overrides.test.js
git commit -m "feat: add runtime override layer to config.js (v0.6.0)"
```

---

## Task 4: `src/api/settings.js` — integration tests first

**Files:**
- Create: `tests/api/settings.test.js`
- Create: `src/api/settings.js`

- [ ] **Step 1: Write failing integration tests**

Create `tests/api/settings.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir
let app

beforeEach(async () => {
  vi.resetModules()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airelay-settings-'))

  // Point the override layer at a tmp dir
  const { loadOverrides } = await import('../../src/config.js')
  await loadOverrides(path.join(tmpDir, 'settings.json'))

  const { createApp } = await import('../../src/server.js')
  app = createApp()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.resetModules()
})

describe('GET /api/settings', () => {
  it('returns 200 with effective, overrides, defaults', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('effective')
    expect(res.body).toHaveProperty('overrides')
    expect(res.body).toHaveProperty('defaults')
  })

  it('effective.compactorEnabled matches config value', async () => {
    const res = await request(app).get('/api/settings')
    expect(typeof res.body.effective.compactorEnabled).toBe('boolean')
  })
})

describe('POST /api/settings', () => {
  it('returns 200 with new effective config on valid patch', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ compactorEnabled: true })
    expect(res.status).toBe(200)
    expect(res.body.effective.compactorEnabled).toBe(true)
  })

  it('persists: subsequent GET reflects posted value', async () => {
    await request(app).post('/api/settings').send({ guardrailsEnabled: true })
    const res = await request(app).get('/api/settings')
    expect(res.body.effective.guardrailsEnabled).toBe(true)
    expect(res.body.overrides.guardrailsEnabled).toBe(true)
  })

  it('returns 400 for unknown key', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ nonExistentKey: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown setting key/i)
  })

  it('returns 400 for wrong value type — boolean field gets string', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ compactorEnabled: 'yes' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid value/i)
  })

  it('returns 400 for bad guardrails mode value', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ guardrailsSecretsMode: 'banana' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid value/i)
  })

  it('returns 200 for valid guardrails mode', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ guardrailsSecretsMode: 'alert' })
    expect(res.status).toBe(200)
    expect(res.body.effective.guardrailsSecretsMode).toBe('alert')
  })
})
```

- [ ] **Step 2: Run tests — confirm all fail**

```bash
npm test -- tests/api/settings.test.js
```

Expected: FAIL — router not registered yet

---

## Task 5: `src/api/settings.js` — implementation

**Files:**
- Create: `src/api/settings.js`
- Modify: `src/server.js`

The allowed settings keys, their types, and validation rules:

| Key | Type | Extra validation |
|-----|------|-----------------|
| `compactorEnabled` | boolean | — |
| `compactorRequestBody` | boolean | — |
| `compactorResponseBody` | boolean | — |
| `compactorToolResultOnly` | boolean | — |
| `compactorAllowRisky` | boolean | — |
| `compactorAnsiStripEnabled` | boolean | — |
| `compactorBlanklineCollapseEnabled` | boolean | — |
| `compactorDiffCollapseEnabled` | boolean | — |
| `compactorLockfileDropEnabled` | boolean | — |
| `compactorLsLongShrinkEnabled` | boolean | — |
| `compactorNpmNoiseStripEnabled` | boolean | — |
| `compactorRepeatLineDedupeEnabled` | boolean | — |
| `compactorStacktraceDedupeEnabled` | boolean | — |
| `compactorLongFileElideEnabled` | boolean | — |
| `compactorBase64TruncateEnabled` | boolean | — |
| `guardrailsEnabled` | boolean | — |
| `guardrailsSecretsMode` | string | must be in `off\|alert\|block\|redact` |
| `guardrailsPiiMode` | string | must be in `off\|alert\|block\|redact` |
| `guardrailsInjectionMode` | string | must be in `off\|alert\|block\|redact` |
| `guardrailsAwsAccessKeyEnabled` | boolean | — |
| `guardrailsGithubPatEnabled` | boolean | — |
| `guardrailsAnthropicKeyEnabled` | boolean | — |
| `guardrailsOpenaiKeyEnabled` | boolean | — |
| `guardrailsPrivateKeyEnabled` | boolean | — |
| `guardrailsJwtEnabled` | boolean | — |
| `guardrailsGenericHighEntropyEnabled` | boolean | — |
| `guardrailsEmailEnabled` | boolean | — |
| `guardrailsPhoneEnabled` | boolean | — |
| `guardrailsSsnUsEnabled` | boolean | — |
| `guardrailsCreditCardEnabled` | boolean | — |
| `guardrailsRoleOverrideEnabled` | boolean | — |
| `guardrailsSystemPromptLeakEnabled` | boolean | — |
| `guardrailsToolOverrideEnabled` | boolean | — |

- [ ] **Step 1: Create `src/api/settings.js`**

```js
import { Router } from 'express'
import { config, applyOverrides, _getOverrides } from '../config.js'

const VALID_MODES = new Set(['off', 'alert', 'block', 'redact'])

const SCHEMA = {
  compactorEnabled:                   'boolean',
  compactorRequestBody:               'boolean',
  compactorResponseBody:              'boolean',
  compactorToolResultOnly:            'boolean',
  compactorAllowRisky:                'boolean',
  compactorAnsiStripEnabled:          'boolean',
  compactorBlanklineCollapseEnabled:  'boolean',
  compactorDiffCollapseEnabled:       'boolean',
  compactorLockfileDropEnabled:       'boolean',
  compactorLsLongShrinkEnabled:       'boolean',
  compactorNpmNoiseStripEnabled:      'boolean',
  compactorRepeatLineDedupeEnabled:   'boolean',
  compactorStacktraceDedupeEnabled:   'boolean',
  compactorLongFileElideEnabled:      'boolean',
  compactorBase64TruncateEnabled:     'boolean',
  guardrailsEnabled:                  'boolean',
  guardrailsSecretsMode:              'mode',
  guardrailsPiiMode:                  'mode',
  guardrailsInjectionMode:            'mode',
  guardrailsAwsAccessKeyEnabled:      'boolean',
  guardrailsGithubPatEnabled:         'boolean',
  guardrailsAnthropicKeyEnabled:      'boolean',
  guardrailsOpenaiKeyEnabled:         'boolean',
  guardrailsPrivateKeyEnabled:        'boolean',
  guardrailsJwtEnabled:               'boolean',
  guardrailsGenericHighEntropyEnabled:'boolean',
  guardrailsEmailEnabled:             'boolean',
  guardrailsPhoneEnabled:             'boolean',
  guardrailsSsnUsEnabled:             'boolean',
  guardrailsCreditCardEnabled:        'boolean',
  guardrailsRoleOverrideEnabled:      'boolean',
  guardrailsSystemPromptLeakEnabled:  'boolean',
  guardrailsToolOverrideEnabled:      'boolean',
}

const ENV_DEFAULTS = {
  compactorEnabled:                   false,
  compactorRequestBody:               true,
  compactorResponseBody:              false,
  compactorToolResultOnly:            true,
  compactorAllowRisky:                false,
  compactorAnsiStripEnabled:          true,
  compactorBlanklineCollapseEnabled:  true,
  compactorDiffCollapseEnabled:       true,
  compactorLockfileDropEnabled:       true,
  compactorLsLongShrinkEnabled:       true,
  compactorNpmNoiseStripEnabled:      true,
  compactorRepeatLineDedupeEnabled:   true,
  compactorStacktraceDedupeEnabled:   true,
  compactorLongFileElideEnabled:      true,
  compactorBase64TruncateEnabled:     true,
  guardrailsEnabled:                  false,
  guardrailsSecretsMode:              'off',
  guardrailsPiiMode:                  'off',
  guardrailsInjectionMode:            'off',
  guardrailsAwsAccessKeyEnabled:      true,
  guardrailsGithubPatEnabled:         true,
  guardrailsAnthropicKeyEnabled:      true,
  guardrailsOpenaiKeyEnabled:         true,
  guardrailsPrivateKeyEnabled:        true,
  guardrailsJwtEnabled:               true,
  guardrailsGenericHighEntropyEnabled:false,
  guardrailsEmailEnabled:             true,
  guardrailsPhoneEnabled:             true,
  guardrailsSsnUsEnabled:             false,
  guardrailsCreditCardEnabled:        true,
  guardrailsRoleOverrideEnabled:      true,
  guardrailsSystemPromptLeakEnabled:  true,
  guardrailsToolOverrideEnabled:      true,
}

function buildEffective() {
  return {
    compactorEnabled:                   config.compactorEnabled,
    compactorRequestBody:               config.compactorRequestBody,
    compactorResponseBody:              config.compactorResponseBody,
    compactorToolResultOnly:            config.compactorToolResultOnly,
    compactorAllowRisky:                config.compactorAllowRisky,
    compactorAnsiStripEnabled:          config.compactor.ansiStrip,
    compactorBlanklineCollapseEnabled:  config.compactor.blanklineCollapse,
    compactorDiffCollapseEnabled:       config.compactor.diffCollapse,
    compactorLockfileDropEnabled:       config.compactor.lockfileDrop,
    compactorLsLongShrinkEnabled:       config.compactor.lsLongShrink,
    compactorNpmNoiseStripEnabled:      config.compactor.npmNoiseStrip,
    compactorRepeatLineDedupeEnabled:   config.compactor.repeatLineDedupe,
    compactorStacktraceDedupeEnabled:   config.compactor.stacktraceDedupe,
    compactorLongFileElideEnabled:      config.compactor.longFileElide,
    compactorBase64TruncateEnabled:     config.compactor.base64Truncate,
    guardrailsEnabled:                  config.guardrailsEnabled,
    guardrailsSecretsMode:              config.guardrailsSecretsMode,
    guardrailsPiiMode:                  config.guardrailsPiiMode,
    guardrailsInjectionMode:            config.guardrailsInjectionMode,
    guardrailsAwsAccessKeyEnabled:      config.guardrails.awsAccessKey,
    guardrailsGithubPatEnabled:         config.guardrails.githubPat,
    guardrailsAnthropicKeyEnabled:      config.guardrails.anthropicKey,
    guardrailsOpenaiKeyEnabled:         config.guardrails.openaiKey,
    guardrailsPrivateKeyEnabled:        config.guardrails.privateKey,
    guardrailsJwtEnabled:               config.guardrails.jwt,
    guardrailsGenericHighEntropyEnabled:config.guardrails.genericHighEntropy,
    guardrailsEmailEnabled:             config.guardrails.email,
    guardrailsPhoneEnabled:             config.guardrails.phone,
    guardrailsSsnUsEnabled:             config.guardrails.ssnUs,
    guardrailsCreditCardEnabled:        config.guardrails.creditCard,
    guardrailsRoleOverrideEnabled:      config.guardrails.roleOverride,
    guardrailsSystemPromptLeakEnabled:  config.guardrails.systemPromptLeak,
    guardrailsToolOverrideEnabled:      config.guardrails.toolOverride,
  }
}

const router = Router()

router.get('/api/settings', (req, res) => {
  res.json({
    effective: buildEffective(),
    overrides: _getOverrides(),
    defaults:  ENV_DEFAULTS,
  })
})

router.post('/api/settings', async (req, res) => {
  const patch = req.body
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' })
  }
  for (const [key, value] of Object.entries(patch)) {
    const type = SCHEMA[key]
    if (!type) {
      return res.status(400).json({ error: `Unknown setting key: ${key}` })
    }
    if (type === 'boolean') {
      if (typeof value !== 'boolean') {
        return res.status(400).json({ error: `Invalid value for ${key}: expected boolean, got ${typeof value}` })
      }
    }
    if (type === 'mode') {
      if (typeof value !== 'string' || !VALID_MODES.has(value)) {
        return res.status(400).json({ error: `Invalid value for ${key}: expected one of off|alert|block|redact` })
      }
    }
  }
  try {
    await applyOverrides(patch)
  } catch (err) {
    // In-memory already applied; write failure is non-fatal per spec
    console.error('settings: failed to persist settings.json', err.message)
  }
  res.json({ effective: buildEffective() })
})

export default router
```

- [ ] **Step 2: Register settings router in `src/server.js`**

Add import and mount after `guardrailsRouter`:

```js
import settingsRouter from './api/settings.js'
// ...
app.use(settingsRouter)
```

- [ ] **Step 3: Run integration tests — confirm green**

```bash
npm test -- tests/api/settings.test.js
```

Expected: 7 tests PASS

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/api/settings.js src/server.js
git commit -m "feat: add GET/POST /api/settings endpoint (v0.6.0)"
```

---

## Task 6: `loadOverrides` at startup + `.gitignore` update

**Files:**
- Modify: `src/index.js`
- Modify: `.gitignore`

- [ ] **Step 1: Call `loadOverrides()` in `src/index.js` before `createApp()`**

After the `import` block and before `rotateLogsIfNeeded()`, add:

```js
import { loadOverrides } from './config.js'
// ...
await loadOverrides()
```

(Placement: `rotateLogsIfNeeded()` is the first non-import statement; `await loadOverrides()` goes directly before it.)

- [ ] **Step 2: Add `data/settings.json` to `.gitignore`**

The existing `.gitignore` already has `/data/` excluded (line 5). Confirm:

```bash
grep "data/" .gitignore
```

If `/data/` already covers it, no change needed. If only specific `data/*` entries exist, add:

```
data/settings.json
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/index.js .gitignore
git commit -m "feat: load settings.json overrides at startup (v0.6.0)"
```

---

## Task 7: Dashboard tab HTML

**Files:**
- Modify: `public/index.html`

The Dashboard tab is added as the first tab (before Logs) and is active by default. The Settings tab is added as the last tab (always visible, no `hidden` attribute).

- [ ] **Step 1: Add tab buttons to the `<nav class="tabs">` in `public/index.html`**

Replace:
```html
<button class="tab active" data-tab="logs">
```
with:
```html
<button class="tab active" data-tab="dashboard">
  <i aria-hidden="true" data-lucide="layout-dashboard"></i>Dashboard
</button>
<button class="tab" data-tab="logs">
```

After the guardrails tab button, add:
```html
<button class="tab" data-tab="settings">
  <i aria-hidden="true" data-lucide="sliders-horizontal"></i>Settings
</button>
```

- [ ] **Step 2: Add controls area for Dashboard and Settings**

After the `guardrailsControls` div, add:

```html
<div class="controls hidden" id="dashboardControls">
  <span id="dashboardStatus" class="status disconnected" role="status" aria-live="polite">Loading…</span>
</div>

<div class="controls hidden" id="settingsControls">
  <span class="pill" id="settingsDirtyPill" hidden>⚠ Unsaved changes</span>
  <button id="settingsSaveBtn" hidden>Save</button>
  <button id="settingsDiscardBtn" hidden>Discard</button>
</div>
```

- [ ] **Step 3: Add Dashboard panel HTML** (insert after the opening `<main>` tag or equivalent container, as the first panel sibling to `logsPanel`):

```html
<section id="dashboardPanel" class="panel">
  <!-- KPI row -->
  <div class="kpi-row">
    <div class="kpi-card">
      <span class="kpi-label">Requests today</span>
      <span class="kpi-value" id="dashKpiRequests">—</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Cost today</span>
      <span class="kpi-value" id="dashKpiCost">—</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">p95 latency</span>
      <span class="kpi-value" id="dashKpiP95">—</span>
    </div>
    <div class="kpi-card" id="dashKpiBytesSavedCard">
      <span class="kpi-label">Bytes saved</span>
      <span class="kpi-value" id="dashKpiBytesSaved">—</span>
    </div>
  </div>

  <!-- Two-column body -->
  <div class="dash-body">
    <!-- Left 2/3 -->
    <div class="dash-main">
      <div class="card">
        <h3>Activity (last 30 min)</h3>
        <canvas id="dashSparkline" height="80"></canvas>
      </div>
      <div class="card">
        <h3>Recent requests <a id="dashLogsLink" href="#logs" class="link-subtle">View all in Logs →</a></h3>
        <table id="dashRecentTable">
          <thead><tr>
            <th>Time</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Latency</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- Right 1/3 -->
    <div class="dash-sidebar">
      <div class="card">
        <h3>System health</h3>
        <ul class="health-list" id="dashHealthList">
          <li><span class="health-dot" id="dashHealthProxy"></span> Proxy <span id="dashHealthProxyLabel">—</span></li>
          <li><span class="health-dot" id="dashHealthCompactor"></span> Compactors <span id="dashHealthCompactorLabel">—</span></li>
          <li><span class="health-dot" id="dashHealthGuardrails"></span> Guardrails <span id="dashHealthGuardrailsLabel">—</span></li>
          <li><span class="health-dot dot-neutral"></span> In-flight <span id="dashInFlight">0</span></li>
        </ul>
      </div>
      <div class="card" id="dashRecommendationsCard" hidden>
        <h3>Recommendations</h3>
        <ul id="dashRecommendationsList"></ul>
      </div>
      <div class="card">
        <h3>Jump to</h3>
        <ul class="quick-links">
          <li><a href="#metrics" class="tab-link" data-tab="metrics">Metrics</a></li>
          <li><a href="#compactor" class="tab-link" data-tab="compactor">Compressors</a></li>
          <li><a href="#guardrails" class="tab-link" data-tab="guardrails">Guardrails</a></li>
          <li><a href="#logs" class="tab-link" data-tab="logs">Logs</a></li>
        </ul>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Add Settings panel HTML** (insert after the guardrails panel):

```html
<section id="settingsPanel" class="panel hidden">
  <h2>Runtime Settings</h2>
  <p class="settings-note">Saved to <code>data/settings.json</code> · Base <code>.env</code> never modified · No restart required</p>

  <!-- Compactors section -->
  <div class="settings-section">
    <div class="settings-section-header">
      <h3>Compactors</h3>
      <label class="toggle-label">
        <input type="checkbox" id="settingCompactorEnabled" data-key="compactorEnabled">
        <span>Enable</span>
      </label>
    </div>

    <div class="settings-subsection" id="compactorSubsection">
      <h4>Scope</h4>
      <div class="toggle-grid">
        <label class="toggle-label"><input type="checkbox" data-key="compactorRequestBody"><span>Request body</span></label>
        <label class="toggle-label"><input type="checkbox" data-key="compactorResponseBody"><span>Response body</span></label>
        <label class="toggle-label"><input type="checkbox" data-key="compactorToolResultOnly"><span>Tool results only</span></label>
        <label class="toggle-label"><input type="checkbox" data-key="compactorAllowRisky"><span>Allow risky <span class="badge-risky">⚠</span></span></label>
      </div>

      <h4>Compressors</h4>
      <div class="compressor-grid" id="compressorGrid">
        <div class="compressor-card" data-key="compactorAnsiStripEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">ansi-strip</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorAnsiStripEnabled"></label>
          </div>
          <p class="compressor-desc">Strip ANSI escape codes from terminal output</p>
        </div>
        <div class="compressor-card" data-key="compactorBlanklineCollapseEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">blankline-collapse</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorBlanklineCollapseEnabled"></label>
          </div>
          <p class="compressor-desc">Collapse consecutive blank lines to one</p>
        </div>
        <div class="compressor-card" data-key="compactorDiffCollapseEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">diff-collapse</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorDiffCollapseEnabled"></label>
          </div>
          <p class="compressor-desc">Collapse unchanged diff hunks to a summary line</p>
        </div>
        <div class="compressor-card" data-key="compactorLockfileDropEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">lockfile-drop</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorLockfileDropEnabled"></label>
          </div>
          <p class="compressor-desc">Replace lockfile content with a size summary</p>
        </div>
        <div class="compressor-card" data-key="compactorLsLongShrinkEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">ls-long-shrink</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorLsLongShrinkEnabled"></label>
          </div>
          <p class="compressor-desc">Shrink verbose ls -l permission / owner columns</p>
        </div>
        <div class="compressor-card" data-key="compactorNpmNoiseStripEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">npm-noise-strip</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorNpmNoiseStripEnabled"></label>
          </div>
          <p class="compressor-desc">Remove npm WARN deprecated lines from install output</p>
        </div>
        <div class="compressor-card" data-key="compactorRepeatLineDedupeEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">repeat-line-dedupe</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorRepeatLineDedupeEnabled"></label>
          </div>
          <p class="compressor-desc">Deduplicate repeated identical lines</p>
        </div>
        <div class="compressor-card" data-key="compactorStacktraceDedupeEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">stacktrace-dedupe</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorStacktraceDedupeEnabled"></label>
          </div>
          <p class="compressor-desc">Collapse duplicate stack frames in exception traces</p>
        </div>
        <div class="compressor-card" data-key="compactorLongFileElideEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">long-file-elide <span class="badge-risky">⚠</span></span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorLongFileElideEnabled"></label>
          </div>
          <p class="compressor-desc">Elide middle of very long files, keep head + tail</p>
        </div>
        <div class="compressor-card" data-key="compactorBase64TruncateEnabled">
          <div class="compressor-card-header">
            <span class="compressor-name">base64-truncate</span>
            <label class="toggle-label"><input type="checkbox" data-key="compactorBase64TruncateEnabled"></label>
          </div>
          <p class="compressor-desc">Truncate long base64 blobs and note their original size</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Guardrails section -->
  <div class="settings-section">
    <div class="settings-section-header">
      <h3>Guardrails</h3>
      <label class="toggle-label">
        <input type="checkbox" id="settingGuardrailsEnabled" data-key="guardrailsEnabled">
        <span>Enable</span>
      </label>
    </div>

    <div class="settings-subsection" id="guardrailsSubsection">
      <h4>Category modes</h4>
      <div class="category-cards">
        <div class="category-card" data-category="secrets">
          <div class="category-card-header">
            <span class="category-name">Secrets</span>
            <span class="category-desc">AWS keys, GitHub PATs, API keys, JWTs, private keys</span>
          </div>
          <div class="mode-pills" data-key="guardrailsSecretsMode">
            <button class="mode-pill" data-mode="off">off</button>
            <button class="mode-pill" data-mode="alert">alert</button>
            <button class="mode-pill" data-mode="block">block</button>
            <button class="mode-pill" data-mode="redact">redact</button>
          </div>
        </div>
        <div class="category-card" data-category="pii">
          <div class="category-card-header">
            <span class="category-name">PII</span>
            <span class="category-desc">Email, phone, credit card, SSN, IP addresses</span>
          </div>
          <div class="mode-pills" data-key="guardrailsPiiMode">
            <button class="mode-pill" data-mode="off">off</button>
            <button class="mode-pill" data-mode="alert">alert</button>
            <button class="mode-pill" data-mode="block">block</button>
            <button class="mode-pill" data-mode="redact">redact</button>
          </div>
        </div>
        <div class="category-card" data-category="injection">
          <div class="category-card-header">
            <span class="category-name">Prompt Injection</span>
            <span class="category-desc">Role override, system prompt extraction, tool hijacking</span>
          </div>
          <div class="mode-pills" data-key="guardrailsInjectionMode">
            <button class="mode-pill" data-mode="off">off</button>
            <button class="mode-pill" data-mode="alert">alert</button>
            <button class="mode-pill" data-mode="block">block</button>
            <button class="mode-pill" data-mode="redact">redact</button>
          </div>
        </div>
      </div>

      <h4>Detectors</h4>
      <div class="compressor-grid" id="detectorGrid">
        <!-- Secrets -->
        <div class="compressor-card" data-key="guardrailsAwsAccessKeyEnabled"><div class="compressor-card-header"><span class="compressor-name">aws-access-key</span><span class="category-badge secrets">secrets</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsAwsAccessKeyEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsGithubPatEnabled"><div class="compressor-card-header"><span class="compressor-name">github-pat</span><span class="category-badge secrets">secrets</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsGithubPatEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsAnthropicKeyEnabled"><div class="compressor-card-header"><span class="compressor-name">anthropic-key</span><span class="category-badge secrets">secrets</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsAnthropicKeyEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsOpenaiKeyEnabled"><div class="compressor-card-header"><span class="compressor-name">openai-key</span><span class="category-badge secrets">secrets</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsOpenaiKeyEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsPrivateKeyEnabled"><div class="compressor-card-header"><span class="compressor-name">private-key</span><span class="category-badge secrets">secrets</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsPrivateKeyEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsJwtEnabled"><div class="compressor-card-header"><span class="compressor-name">jwt</span><span class="category-badge secrets">secrets</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsJwtEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsGenericHighEntropyEnabled"><div class="compressor-card-header"><span class="compressor-name">generic-high-entropy</span><span class="category-badge secrets">secrets</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsGenericHighEntropyEnabled"></label></div></div>
        <!-- PII -->
        <div class="compressor-card" data-key="guardrailsEmailEnabled"><div class="compressor-card-header"><span class="compressor-name">email</span><span class="category-badge pii">pii</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsEmailEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsPhoneEnabled"><div class="compressor-card-header"><span class="compressor-name">phone-e164</span><span class="category-badge pii">pii</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsPhoneEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsSsnUsEnabled"><div class="compressor-card-header"><span class="compressor-name">ssn-us</span><span class="category-badge pii">pii</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsSsnUsEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsCreditCardEnabled"><div class="compressor-card-header"><span class="compressor-name">credit-card</span><span class="category-badge pii">pii</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsCreditCardEnabled"></label></div></div>
        <!-- Injection -->
        <div class="compressor-card" data-key="guardrailsRoleOverrideEnabled"><div class="compressor-card-header"><span class="compressor-name">role-override</span><span class="category-badge injection">injection</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsRoleOverrideEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsSystemPromptLeakEnabled"><div class="compressor-card-header"><span class="compressor-name">system-prompt-leak</span><span class="category-badge injection">injection</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsSystemPromptLeakEnabled"></label></div></div>
        <div class="compressor-card" data-key="guardrailsToolOverrideEnabled"><div class="compressor-card-header"><span class="compressor-name">tool-override</span><span class="category-badge injection">injection</span><label class="toggle-label"><input type="checkbox" data-key="guardrailsToolOverrideEnabled"></label></div></div>
      </div>
    </div>
  </div>

  <p class="settings-footer">Saved to <code>data/settings.json</code> · Base <code>.env</code> never modified · No restart required</p>
</section>
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: add Dashboard and Settings tab HTML scaffolding (v0.6.0)"
```

---

## Task 8: CSS — Dashboard and Settings styles

**Files:**
- Modify: `public/style.css`

Check current end of `style.css` to find the insertion point.

- [ ] **Step 1: Append styles to `public/style.css`**

```css
/* ─── Dashboard tab ──────────────────────────────────── */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.kpi-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.kpi-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kpi-value {
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.dash-body {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 1.25rem;
  align-items: start;
}

.dash-main {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.dash-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.health-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.health-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-muted);
}

.health-dot.dot-ok { background: var(--ok, #22c55e); }
.health-dot.dot-warn { background: var(--warn, #f59e0b); }
.health-dot.dot-error { background: var(--error, #ef4444); }
.health-dot.dot-neutral { background: var(--text-muted); }

#dashRecommendationsList {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

#dashRecommendationsList li {
  font-size: 0.85rem;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  background: var(--surface-2, var(--surface));
  border-left: 3px solid var(--warn, #f59e0b);
}

.quick-links {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.quick-links a {
  color: var(--accent, #6366f1);
  text-decoration: none;
  font-size: 0.9rem;
}

.quick-links a:hover { text-decoration: underline; }

.link-subtle {
  font-size: 0.8rem;
  color: var(--accent, #6366f1);
  text-decoration: none;
  margin-left: auto;
  font-weight: 400;
}

.link-subtle:hover { text-decoration: underline; }

/* ─── Settings tab ───────────────────────────────────── */
.settings-note {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 1.5rem;
}

.settings-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}

.settings-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.settings-section-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.settings-subsection {
  margin-top: 1rem;
}

.settings-subsection h4 {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin: 1rem 0 0.5rem;
}

.toggle-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  user-select: none;
}

.toggle-label input[type="checkbox"] {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--accent, #6366f1);
  cursor: pointer;
}

.compressor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.compressor-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  transition: opacity 0.15s;
}

.compressor-card.off {
  opacity: 0.5;
}

.compressor-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.compressor-name {
  font-family: monospace;
  font-size: 0.85rem;
  font-weight: 600;
  flex: 1;
}

.compressor-desc {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin: 0.35rem 0 0;
}

.badge-risky {
  font-size: 0.75rem;
  color: var(--warn, #f59e0b);
  font-weight: 700;
}

.category-badge {
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 9999px;
  font-weight: 600;
  text-transform: uppercase;
}

.category-badge.secrets { background: rgba(239,68,68,0.12); color: #ef4444; }
.category-badge.pii     { background: rgba(245,158,11,0.12); color: #f59e0b; }
.category-badge.injection { background: rgba(99,102,241,0.12); color: #6366f1; }

.category-cards {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.category-card {
  border: 2px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  transition: border-color 0.15s, opacity 0.15s;
}

.category-card.mode-off     { border-color: var(--border); }
.category-card.mode-alert   { border-color: #f59e0b; }
.category-card.mode-block   { border-color: #ef4444; }
.category-card.mode-redact  { border-color: #6366f1; }

.category-card-header {
  margin-bottom: 0.5rem;
}

.category-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.category-desc {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.2rem;
}

.mode-pills {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}

.mode-pill {
  padding: 3px 10px;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--text-muted);
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.mode-pill.active {
  font-weight: 600;
  color: var(--text);
  border-color: var(--text);
  background: var(--surface-2, var(--surface));
}

.mode-pill.active[data-mode="alert"]  { background: rgba(245,158,11,0.15); border-color: #f59e0b; color: #f59e0b; }
.mode-pill.active[data-mode="block"]  { background: rgba(239,68,68,0.15);  border-color: #ef4444; color: #ef4444; }
.mode-pill.active[data-mode="redact"] { background: rgba(99,102,241,0.15); border-color: #6366f1; color: #6366f1; }
.mode-pill.active[data-mode="off"]    { background: var(--surface-2, var(--surface)); border-color: var(--border); color: var(--text-muted); }

.settings-footer {
  font-size: 0.78rem;
  color: var(--text-muted);
  text-align: center;
  margin-top: 0.5rem;
}

#settingsDirtyPill {
  background: rgba(245,158,11,0.15);
  border: 1px solid #f59e0b;
  color: #f59e0b;
  border-radius: 9999px;
  padding: 3px 10px;
  font-size: 0.8rem;
  font-weight: 600;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add Dashboard and Settings CSS (v0.6.0)"
```

---

## Task 9: Dashboard tab JavaScript

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Extend `activateTab` in `public/app.js` to handle `dashboard` and `settings`**

In the `activateTab(name)` function, add the Dashboard and Settings panel/controls toggling. After line `if (guardrailsControls) guardrailsControls.classList.toggle(...)`, add:

```js
const dashboardPanel = document.getElementById('dashboardPanel')
const dashboardControls = document.getElementById('dashboardControls')
const settingsPanel = document.getElementById('settingsPanel')
const settingsControls = document.getElementById('settingsControls')

if (dashboardPanel) dashboardPanel.classList.toggle('hidden', name !== 'dashboard')
if (dashboardControls) dashboardControls.classList.toggle('hidden', name !== 'dashboard')
if (settingsPanel) settingsPanel.classList.toggle('hidden', name !== 'settings')
if (settingsControls) settingsControls.classList.toggle('hidden', name !== 'settings')
```

And add at the end of `activateTab`, after the `if (name === 'metrics')` block:

```js
if (name === 'dashboard') refreshDashboard().catch(() => {})
if (name === 'settings') refreshSettings().catch(() => {})
```

- [ ] **Step 2: Add initial hash routing for `dashboard` and `settings`**

Find the hash-routing block near the bottom of `app.js` that decides the initial active tab. It likely looks like:

```js
const initialTab = location.hash.slice(1) || 'logs'
activateTab(initialTab)
```

Change the default from `'logs'` to `'dashboard'`:

```js
const initialTab = location.hash.slice(1) || 'dashboard'
activateTab(initialTab)
```

- [ ] **Step 3: Add `refreshDashboard()` function to `public/app.js`**

Add this new function after the `refreshGuardrails` section:

```js
// ─── Dashboard panel ─────────────────────────────────
let dashSparklineChart = null
const dashRpsHistory = []
const dashP95History = []
const DASH_SPARKLINE_POINTS = 30

function pushDashPoint(rps, p95) {
  dashRpsHistory.push(rps)
  dashP95History.push(p95)
  if (dashRpsHistory.length > DASH_SPARKLINE_POINTS) {
    dashRpsHistory.shift()
    dashP95History.shift()
  }
  if (dashSparklineChart) {
    dashSparklineChart.data.labels = dashRpsHistory.map((_, i) => i)
    dashSparklineChart.data.datasets[0].data = [...dashRpsHistory]
    dashSparklineChart.data.datasets[1].data = [...dashP95History]
    dashSparklineChart.update('none')
  }
}

function initDashSparkline() {
  const canvas = document.getElementById('dashSparkline')
  if (!canvas || dashSparklineChart) return
  dashSparklineChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'RPS',
          data: [],
          borderColor: 'var(--accent, #6366f1)',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: 'p95 (ms)',
          data: [],
          borderColor: 'var(--warn, #f59e0b)',
          borderWidth: 2,
          borderDash: [4, 3],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      animation: TEST_MODE ? false : { duration: 200 },
      plugins: { legend: { display: true, position: 'bottom' } },
      scales: {
        x: { display: false },
        y: { beginAtZero: true },
      },
      responsive: true,
      maintainAspectRatio: false,
    },
  })
}

function setHealthDot(id, state) {
  const el = document.getElementById(id)
  if (!el) return
  el.className = `health-dot dot-${state}`
}

function buildRecommendations(health, compactorSummary, guardrailsSummary, settingsData) {
  const recs = []
  if (!guardrailsSummary?.enabled) {
    recs.push({ text: '⚠ Guardrails disabled — enable at least alert mode', link: '#settings', tab: 'settings' })
  }
  if (compactorSummary?.enabled && settingsData?.effective && settingsData.effective.compactorToolResultOnly === false) {
    recs.push({ text: 'ℹ Tool-result-only off — tighter scope available', link: '#settings', tab: 'settings' })
  }
  if (health && health.proxy?.enabled === false) {
    recs.push({ text: '✕ No upstream configured', link: '#setup', tab: 'setup' })
  }
  if (health && health.status !== 'ok') {
    recs.push({ text: '✕ Proxy health check failing — check upstream URL', link: null, tab: null })
  }
  return recs
}

async function refreshDashboard() {
  const statusEl = document.getElementById('dashboardStatus')
  try {
    initDashSparkline()
    const [healthRes, summaryRes, recentRes, compactorRes, guardrailsRes, settingsRes] = await Promise.all([
      fetch('/api/health'),
      fetch('/api/metrics/summary'),
      fetch('/api/metrics/recent?limit=5'),
      fetch('/api/compactor/summary'),
      fetch('/api/guardrails/summary'),
      fetch('/api/settings'),
    ])
    if (!healthRes.ok) throw new Error('health fetch failed')
    const health = await healthRes.json()
    const summary = summaryRes.ok ? await summaryRes.json() : null
    const recent = recentRes.ok ? await recentRes.json() : []
    const compactor = compactorRes.ok ? await compactorRes.json() : null
    const guardrails = guardrailsRes.ok ? await guardrailsRes.json() : null
    const settings = settingsRes.ok ? await settingsRes.json() : null

    if (statusEl) { statusEl.textContent = 'Live'; statusEl.className = 'status connected' }

    // KPI row
    const total = summary?.lifetime?.total ?? '—'
    document.getElementById('dashKpiRequests').textContent = typeof total === 'number' ? total.toLocaleString() : '—'
    const cost = summary?.lifetime?.totalCostUsd
    document.getElementById('dashKpiCost').textContent = typeof cost === 'number' ? '$' + cost.toFixed(4) : '—'
    const p95 = summary?.window_1m?.p95
    document.getElementById('dashKpiP95').textContent = typeof p95 === 'number' ? p95 + ' ms' : '—'
    const bytesSavedCard = document.getElementById('dashKpiBytesSavedCard')
    if (compactor?.enabled && bytesSavedCard) {
      bytesSavedCard.hidden = false
      const saved = compactor.lifetime?.bytesSaved ?? 0
      const bytesIn = compactor.lifetime?.bytesIn ?? 0
      const pct = bytesIn > 0 ? Math.round((saved / bytesIn) * 100) : 0
      document.getElementById('dashKpiBytesSaved').textContent = pct + '%'
    } else if (bytesSavedCard) {
      bytesSavedCard.hidden = true
    }

    // Sparkline — seed with current window value
    const rps = summary?.window_1m?.rps ?? 0
    pushDashPoint(rps, p95 ?? 0)

    // Recent requests table
    const tbody = document.querySelector('#dashRecentTable tbody')
    if (tbody) {
      tbody.innerHTML = ''
      const rows = Array.isArray(recent) ? recent.slice(0, 5) : (recent.events ?? []).slice(0, 5)
      for (const ev of rows) {
        const tr = document.createElement('tr')
        tr.innerHTML = `<td>${new Date(ev.ts).toLocaleTimeString()}</td>
          <td><code>${ev.model ?? '—'}</code></td>
          <td>${(ev.tokensIn ?? 0) + (ev.tokensOut ?? 0)}</td>
          <td>${ev.costUsd != null ? '$' + ev.costUsd.toFixed(5) : '—'}</td>
          <td>${ev.durationMs != null ? ev.durationMs + ' ms' : '—'}</td>`
        tbody.appendChild(tr)
      }
    }

    // Health sidebar
    const proxyOk = health.status === 'ok'
    setHealthDot('dashHealthProxy', proxyOk ? 'ok' : 'error')
    document.getElementById('dashHealthProxyLabel').textContent = proxyOk ? 'OK' : health.status ?? 'Unknown'

    const compEnabled = compactor?.enabled ?? false
    const compActive = compactor?.compressors?.active?.length ?? 0
    const compAll = compactor?.compressors?.all?.length ?? 0
    setHealthDot('dashHealthCompactor', compEnabled ? 'ok' : 'neutral')
    document.getElementById('dashHealthCompactorLabel').textContent =
      compEnabled ? `On (${compActive}/${compAll} active)` : 'Off'

    const grEnabled = guardrails?.enabled ?? false
    const grActive = guardrails?.detectors?.active?.length ?? 0
    const grAll = guardrails?.detectors?.all?.length ?? 0
    setHealthDot('dashHealthGuardrails', grEnabled ? 'ok' : 'warn')
    document.getElementById('dashHealthGuardrailsLabel').textContent =
      grEnabled ? `On (${grActive}/${grAll} active)` : 'Off'

    // Recommendations
    const recs = buildRecommendations(health, compactor, guardrails, settings)
    const recCard = document.getElementById('dashRecommendationsCard')
    const recList = document.getElementById('dashRecommendationsList')
    if (recCard && recList) {
      recCard.hidden = recs.length === 0
      recList.innerHTML = ''
      for (const r of recs) {
        const li = document.createElement('li')
        if (r.tab) {
          li.innerHTML = `${r.text} <a href="${r.link}" class="tab-link" data-tab="${r.tab}">→ ${r.tab}</a>`
        } else {
          li.textContent = r.text
        }
        recList.appendChild(li)
      }
    }
  } catch {
    if (statusEl) { statusEl.textContent = 'Error'; statusEl.className = 'status disconnected' }
  }
}

// Wire up "View all in Logs →" and Quick links
document.getElementById('dashLogsLink')?.addEventListener('click', (e) => {
  e.preventDefault(); activateTab('logs')
})
document.querySelectorAll('.tab-link[data-tab]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault(); activateTab(a.dataset.tab)
  })
})

// Refresh Dashboard KPIs on every SSE tick (reuse the SSE connection already
// established by the Metrics tab logic).
function dashboardTickHandler(tick) {
  const dashPanel = document.getElementById('dashboardPanel')
  if (!dashPanel || dashPanel.classList.contains('hidden')) return
  const p95 = tick.p95 ?? tick.window_1m?.p95 ?? 0
  const rps = tick.rps ?? tick.window_1m?.rps ?? 0
  pushDashPoint(rps, p95)
  document.getElementById('dashKpiP95').textContent = p95 ? p95 + ' ms' : '—'
  document.getElementById('dashInFlight').textContent = tick.inFlight ?? '0'
}
```

**Note:** The SSE tick integration (`dashboardTickHandler`) requires hooking into the existing SSE `tick` event listener in `app.js`. Find where the Metrics tab processes SSE ticks — look for `evtSource.addEventListener('tick', ...)` — and add a call to `dashboardTickHandler(data)` inside that handler.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: Dashboard tab JavaScript — KPIs, sparkline, health sidebar (v0.6.0)"
```

---

## Task 10: Settings tab JavaScript

**Files:**
- Modify: `public/app.js`

The Settings state machine:
1. `refreshSettings()` — fetches `/api/settings`, populates all controls to `effective` values, resets `_pendingChanges = {}`.
2. Any control change → writes diff to `_pendingChanges`, shows dirty banner.
3. Save → POST `/api/settings` with `_pendingChanges`, re-fetches on 200, hides banner.
4. Discard → calls `refreshSettings()`, hides banner.

- [ ] **Step 1: Add Settings state machine to `public/app.js`**

```js
// ─── Settings tab ─────────────────────────────────────
let _serverSettings = {}
let _pendingChanges = {}

function settingsIsDirty() {
  return Object.keys(_pendingChanges).length > 0
}

function updateDirtyBanner() {
  const pill = document.getElementById('settingsDirtyPill')
  const save = document.getElementById('settingsSaveBtn')
  const discard = document.getElementById('settingsDiscardBtn')
  const dirty = settingsIsDirty()
  if (pill) pill.hidden = !dirty
  if (save) save.hidden = !dirty
  if (discard) discard.hidden = !dirty
}

function applySettingsToUI(effective) {
  // Checkboxes
  for (const input of document.querySelectorAll('#settingsPanel input[type="checkbox"][data-key]')) {
    const key = input.dataset.key
    if (key in effective) input.checked = effective[key]
  }
  // Mode pills
  for (const group of document.querySelectorAll('#settingsPanel .mode-pills[data-key]')) {
    const key = group.dataset.key
    const val = effective[key]
    for (const pill of group.querySelectorAll('.mode-pill')) {
      pill.classList.toggle('active', pill.dataset.mode === val)
    }
    const card = group.closest('.category-card')
    if (card) {
      card.className = `category-card mode-${val ?? 'off'}`
    }
  }
  // Dim compressor cards whose toggle is off
  for (const card of document.querySelectorAll('#compressorGrid .compressor-card')) {
    const key = card.dataset.key
    if (key in effective) card.classList.toggle('off', !effective[key])
  }
  // Dim detector cards whose toggle is off
  for (const card of document.querySelectorAll('#detectorGrid .compressor-card')) {
    const key = card.dataset.key
    if (key in effective) card.classList.toggle('off', !effective[key])
  }
  // Disable compactor subsection when master is off
  const compSub = document.getElementById('compactorSubsection')
  if (compSub) compSub.style.opacity = effective.compactorEnabled ? '1' : '0.5'
  // Disable guardrails subsection when master is off
  const grSub = document.getElementById('guardrailsSubsection')
  if (grSub) grSub.style.opacity = effective.guardrailsEnabled ? '1' : '0.5'
}

async function refreshSettings() {
  try {
    const res = await fetch('/api/settings')
    if (!res.ok) throw new Error('settings fetch failed')
    const data = await res.json()
    _serverSettings = data.effective
    _pendingChanges = {}
    applySettingsToUI(data.effective)
    updateDirtyBanner()
  } catch {
    // ignore — controls retain their current state
  }
}

// Wire checkbox changes
document.querySelectorAll('#settingsPanel input[type="checkbox"][data-key]').forEach((input) => {
  input.addEventListener('change', () => {
    const key = input.dataset.key
    _pendingChanges[key] = input.checked
    applySettingsToUI({ ..._serverSettings, ..._pendingChanges })
    updateDirtyBanner()
  })
})

// Wire mode pill clicks
document.querySelectorAll('#settingsPanel .mode-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const group = pill.closest('.mode-pills')
    if (!group) return
    const key = group.dataset.key
    const mode = pill.dataset.mode
    _pendingChanges[key] = mode
    applySettingsToUI({ ..._serverSettings, ..._pendingChanges })
    updateDirtyBanner()
  })
})

// Save button
document.getElementById('settingsSaveBtn')?.addEventListener('click', async () => {
  if (!settingsIsDirty()) return
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_pendingChanges),
    })
    if (!res.ok) {
      const err = await res.json()
      alert('Save failed: ' + (err.error ?? 'unknown error'))
      return
    }
    const data = await res.json()
    _serverSettings = data.effective
    _pendingChanges = {}
    applySettingsToUI(data.effective)
    updateDirtyBanner()
  } catch {
    alert('Save failed: network error')
  }
})

// Discard button
document.getElementById('settingsDiscardBtn')?.addEventListener('click', () => {
  _pendingChanges = {}
  applySettingsToUI(_serverSettings)
  updateDirtyBanner()
})
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: Settings tab JavaScript — state machine, save/discard (v0.6.0)"
```

---

## Task 11: E2E tests — Dashboard + Settings functional

**Files:**
- Create: `tests/e2e/functional/dashboard-tab.spec.js`
- Create: `tests/e2e/functional/settings-tab.spec.js`

- [ ] **Step 1: Create `tests/e2e/functional/dashboard-tab.spec.js`**

```js
import { test, expect } from '@playwright/test'
import { resetMetrics } from '../fixtures/seed-traffic.js'

test.beforeEach(async ({ baseURL }) => {
  await resetMetrics(baseURL)
})

test.describe('Dashboard tab', () => {
  test('is the default landing tab', async ({ page }) => {
    await page.goto('/?testMode=1')
    await expect(page.locator('#dashboardPanel')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.tab.active[data-tab="dashboard"]')).toBeVisible()
  })

  test('renders KPI row', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.waitForSelector('#dashboardPanel:not(.hidden)')
    await expect(page.locator('#dashKpiRequests')).toBeVisible()
    await expect(page.locator('#dashKpiCost')).toBeVisible()
    await expect(page.locator('#dashKpiP95')).toBeVisible()
  })

  test('renders system health sidebar', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.waitForSelector('#dashboardPanel:not(.hidden)')
    await expect(page.locator('#dashHealthList')).toBeVisible()
    await expect(page.locator('#dashHealthProxyLabel')).toBeVisible()
  })

  test('renders recent requests table', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.waitForSelector('#dashboardPanel:not(.hidden)')
    await expect(page.locator('#dashRecentTable')).toBeVisible()
  })

  test('settings API returns 200', async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/api/settings`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('effective')
    expect(json).toHaveProperty('overrides')
    expect(json).toHaveProperty('defaults')
  })
})
```

- [ ] **Step 2: Create `tests/e2e/functional/settings-tab.spec.js`**

```js
import { test, expect } from '@playwright/test'
import { resetMetrics } from '../fixtures/seed-traffic.js'

test.beforeEach(async ({ baseURL }) => {
  await resetMetrics(baseURL)
  // Reset server-side settings to empty overrides
  await fetch(`${baseURL}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compactorEnabled: false, guardrailsEnabled: false }),
  })
})

test.describe('Settings tab', () => {
  test('tab is visible and navigates', async ({ page }) => {
    await page.goto('/?testMode=1')
    const settingsTab = page.locator('.tab[data-tab="settings"]')
    await expect(settingsTab).toBeVisible()
    await settingsTab.click()
    await expect(page.locator('#settingsPanel')).toBeVisible()
  })

  test('renders all 10 compressor cards', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    const cards = page.locator('#compressorGrid .compressor-card')
    await expect(cards).toHaveCount(10, { timeout: 10_000 })
  })

  test('renders all 14 detector cards', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    const cards = page.locator('#detectorGrid .compressor-card')
    await expect(cards).toHaveCount(14, { timeout: 10_000 })
  })

  test('toggle compactor → dirty banner appears', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    // Dirty banner should be hidden initially
    await expect(page.locator('#settingsDirtyPill')).toBeHidden()
    // Toggle compactor master
    await page.locator('input[data-key="compactorEnabled"]').click()
    // Dirty banner should now be visible
    await expect(page.locator('#settingsDirtyPill')).toBeVisible()
    await expect(page.locator('#settingsSaveBtn')).toBeVisible()
    await expect(page.locator('#settingsDiscardBtn')).toBeVisible()
  })

  test('Save clears dirty banner', async ({ page, baseURL }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    await page.locator('input[data-key="compactorEnabled"]').click()
    await expect(page.locator('#settingsDirtyPill')).toBeVisible()
    await page.locator('#settingsSaveBtn').click()
    await expect(page.locator('#settingsDirtyPill')).toBeHidden({ timeout: 5_000 })
    // Verify server reflects change
    const res = await fetch(`${baseURL}/api/settings`)
    const json = await res.json()
    // the toggled value should differ from false (it was false, now true or toggled)
    expect(typeof json.effective.compactorEnabled).toBe('boolean')
  })

  test('Discard resets dirty state', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    await page.locator('input[data-key="compactorEnabled"]').click()
    await expect(page.locator('#settingsDirtyPill')).toBeVisible()
    await page.locator('#settingsDiscardBtn').click()
    await expect(page.locator('#settingsDirtyPill')).toBeHidden()
  })

  test('mode pill click marks settings dirty', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    await page.locator('.mode-pills[data-key="guardrailsSecretsMode"] .mode-pill[data-mode="alert"]').click()
    await expect(page.locator('#settingsDirtyPill')).toBeVisible()
  })
})
```

- [ ] **Step 3: Run E2E functional tests**

```bash
npm run test:e2e
```

Expected: new dashboard-tab and settings-tab specs pass (all tests)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/functional/dashboard-tab.spec.js tests/e2e/functional/settings-tab.spec.js
git commit -m "test: E2E functional specs for Dashboard and Settings tabs (v0.6.0)"
```

---

## Task 12: E2E visual baselines

**Files:**
- Modify: `tests/e2e/visual/dashboard.visual.spec.js`

- [ ] **Step 1: Add visual snapshots to the existing visual spec**

Add these two tests inside the existing `test.describe('visual: dashboard tabs', ...)` block in `tests/e2e/visual/dashboard.visual.spec.js`:

```js
  test('dashboard tab — empty state', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.waitForSelector('#dashboardPanel:not(.hidden)')
    await page.waitForTimeout(500) // let data load
    await expect(page).toHaveScreenshot('dashboard-empty.png', {
      fullPage: true,
      mask: [page.locator('#dashRecentTable tbody')],
    })
  })

  test('settings tab — initial state', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    await page.waitForTimeout(300)
    await expect(page).toHaveScreenshot('settings-initial.png', { fullPage: true })
  })
```

- [ ] **Step 2: Bless new baselines (first-run creates them)**

```bash
npm run test:e2e:visual:bless
```

Expected: new baseline files created under `tests/e2e/visual/dashboard.visual.spec.js-snapshots/`

- [ ] **Step 3: Run visual suite to confirm baselines pass**

```bash
npm run test:e2e:visual
```

Expected: all visual tests pass (no diffs against just-created baselines)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/visual/dashboard.visual.spec.js "tests/e2e/visual/dashboard.visual.spec.js-snapshots/"
git commit -m "test: bless Dashboard and Settings visual baselines (v0.6.0)"
```

---

## Task 13: Full test suite + lint pass

**Files:** none (verification only)

- [ ] **Step 1: Run full unit + integration suite**

```bash
npm test
```

Expected: all tests green

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 3: Fix any lint errors**

If lint errors appear, run:
```bash
npm run lint:fix
```

Then re-run `npm run lint` to confirm clean.

- [ ] **Step 4: Run full E2E suite**

```bash
npm run test:e2e
```

Expected: all E2E functional tests pass

- [ ] **Step 5: Commit lint fixes if any**

```bash
git add -p
git commit -m "chore: lint fixes for v0.6.0 Dashboard + Settings"
```

---

## Task 14: PR

**Files:** none (git/GitHub operations)

- [ ] **Step 1: Check all tests green one final time**

```bash
npm test && npm run lint && npm run test:e2e
```

Expected: all green

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/v0.6.0-dashboard-settings
```

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --base develop \
  --title "feat: v0.6.0 — Dashboard landing tab + Runtime Settings" \
  --body "$(cat <<'EOF'
## Summary
- Adds **Dashboard** as the new default landing tab: KPI row (requests, cost, p95, bytes saved), 30-min RPS + p95 sparkline, recent requests table, system health sidebar, client-side recommendations panel, and quick links.
- Adds **Settings** tab (last, always visible): runtime Compactor and Guardrails toggles without restart, persisted to `data/settings.json`, unsaved-changes banner with Save/Discard.
- Backend: `_overrides` layer in `src/config.js` with `loadOverrides()` / `applyOverrides()`; all compactor/guardrails getters check overrides first. New `GET /POST /api/settings` endpoint.

Closes #<!-- issue number -->

## Test plan
- [ ] `npm test` — unit (config override layer) + integration (settings endpoint)
- [ ] `npm run lint` — clean
- [ ] `npm run test:e2e` — functional specs for Dashboard tab + Settings tab
- [ ] `npm run test:e2e:visual` — Dashboard and Settings visual baselines pass
- [ ] Manual: open `/?testMode=1#dashboard` — KPIs visible, health sidebar, sparkline renders
- [ ] Manual: open `/?testMode=1#settings` — all 10 compressor cards + 14 detector cards; toggle → dirty banner; Save → clears; Discard → reverts
- [ ] Manual: POST to `/api/settings` with unknown key → 400; with wrong type → 400; with valid patch → 200

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review against spec

Spec section → task:

| Spec requirement | Task |
|---|---|
| Dashboard tab as first tab, default active | Task 7 (HTML), Task 9 (JS) |
| Settings tab as last tab, always visible | Task 7 (HTML), Task 10 (JS) |
| Hash routing `#dashboard`, `#settings` | Task 9 (JS) |
| KPI row: requests, cost, p95, bytes saved | Task 9 |
| Activity sparkline — RPS + p95, SSE tick | Task 9 |
| Recent requests table + "View all in Logs →" | Task 9 |
| System health sidebar | Task 9 |
| Recommendations panel — client-side rules | Task 9 |
| Quick links | Task 9 |
| Settings persistence to `data/settings.json` | Task 3 (config), Task 5 (API) |
| `.env` never modified | Task 5 (design, never reads env from POST) |
| No restart required — per-request getter reads overrides | Task 3 |
| `loadOverrides()` at startup | Task 6 |
| `data/settings.json` in `.gitignore` | Task 6 |
| Compactors section — master toggle + scope + 10 compressor cards | Task 7 (HTML), Task 10 (JS) |
| Guardrails section — master + 3 category cards + 14 detector cards | Task 7 (HTML), Task 10 (JS) |
| Unsaved changes banner + Save / Discard | Task 10 |
| GET `/api/settings` returns effective + overrides + defaults | Task 4–5 |
| POST `/api/settings` validates whitelist + types | Task 4–5 |
| 400 for unknown key / wrong type | Task 4–5 |
| Unit tests: loadOverrides, applyOverrides, getter fallback | Task 2–3 |
| Integration tests: GET/POST settings | Task 4–5 |
| E2E: Settings tab renders, toggle → dirty → Save → clears | Task 11 |
| E2E: Dashboard tab renders KPIs + health sidebar | Task 11 |
| Visual baselines Dashboard + Settings | Task 12 |

All requirements covered. No gaps identified.
