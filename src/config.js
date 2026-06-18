import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_SETTINGS_PATH = path.resolve('./data/settings.json')

let _overrides = {}
let _settingsPath = DEFAULT_SETTINGS_PATH

export function _getOverrides() { return _overrides }

export async function loadOverrides(filePath = DEFAULT_SETTINGS_PATH) {
  _settingsPath = filePath
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    _overrides = JSON.parse(raw)
  } catch {
    _overrides = {}
  }
}

export async function applyOverrides(patch) {
  _overrides = { ..._overrides, ...patch }
  try {
    await fs.writeFile(_settingsPath, JSON.stringify(_overrides, null, 2))
  } catch (err) {
    console.error('applyOverrides: failed to persist settings.json', err.message)
  }
}

if (process.env.NODE_ENV !== 'production') {
  const { default: dotenv } = await import('dotenv')
  dotenv.config()
}

function int(name, fallback) {
  const val = process.env[name]
  if (!val) return fallback
  const n = parseInt(val, 10)
  if (isNaN(n)) throw new Error(`Env var ${name} must be an integer, got: ${val}`)
  return n
}

const GUARDRAILS_MODES = new Set(['off', 'alert', 'block', 'redact'])
function mode(name, fallback) {
  const val = (process.env[name] ?? fallback).toLowerCase()
  if (!GUARDRAILS_MODES.has(val)) {
    throw new Error(`Env var ${name} must be one of off|alert|block|redact, got: ${val}`)
  }
  return val
}

export const config = {
  // Server
  port: int('PORT', 3000),
  bindHost: process.env.BIND_HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null,

  // API rate limiting — caps requests per IP to the dashboard/API routes
  // (/health, /api/*). The proxy hot path is never rate-limited.
  apiRateLimitWindowMs: int('API_RATE_LIMIT_WINDOW_MS', 60_000),
  apiRateLimitMax: int('API_RATE_LIMIT_MAX', 600),

  // Logging
  logDir: process.env.LOG_DIR ?? './data/logs',
  logRetentionDays: int('LOG_RETENTION_DAYS', 7),
  maxLogSizeMb: int('MAX_LOG_SIZE_MB', 50),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  logSink: process.env.LOG_SINK ?? 'file', // 'file' | 'stdout' | 'noop'

  cronSchedule: process.env.CRON_SCHEDULE ?? '0 0 * * *',
  enableCompression: process.env.ENABLE_COMPRESSION === 'true',

  // SSE
  sseHeartbeatMs: int('SSE_HEARTBEAT_MS', 30_000),
  maxSseClients: int('MAX_SSE_CLIENTS', 50),
  sseEventRate: int('SSE_EVENT_RATE', 50),

  // Proxy
  upstreamUrl: process.env.UPSTREAM_URL ?? '',
  proxyPathPrefix: process.env.PROXY_PATH_PREFIX ?? '/proxy',
  proxyTrustForwarded: process.env.PROXY_TRUST_FORWARDED === 'true',
  // Skip TLS cert verification on the upstream connection. Default false —
  // real AI providers have valid certs. Opt in only for self-signed dev upstreams.
  proxyInsecureTls: process.env.PROXY_INSECURE_TLS === 'true',

  // Multi-upstream routes (v0.4.0). Either set `ROUTES_CONFIG_PATH` to a JSON
  // file with `{ "routes": [{ prefix, upstream, provider, trustForwarded? }] }`,
  // or set `PROXY_ROUTES` to inline JSON for the same shape (env wins). When
  // both are unset the proxy synthesizes a single route from UPSTREAM_URL +
  // PROXY_PATH_PREFIX + PROXY_PROVIDER for backwards compatibility.
  // See docs/ROUTING.md and CONFIGURATION.md for the schema.
  routesConfigPath: process.env.ROUTES_CONFIG_PATH ?? null,

  // Persistence (v0.4.0). When set, every proxied request event is also
  // written to a SQLite database for time-range queries beyond the in-memory
  // ring buffer. Default null = no persistence (v0.3.0 behavior).
  metricsDbPath: process.env.METRICS_DB_PATH ?? null,
  metricsRetentionDays: int('METRICS_RETENTION_DAYS', 30),
  metricsWriteBatchSize: int('METRICS_WRITE_BATCH_SIZE', 100),
  metricsWriteBatchMs: int('METRICS_WRITE_BATCH_MS', 1000),

  // Token & Cost Tracking (v0.2.0)
  proxyProvider: process.env.PROXY_PROVIDER ?? 'generic',
  proxyTokenTracking: process.env.PROXY_TOKEN_TRACKING !== 'false',
  pricingConfigPath: process.env.PRICING_CONFIG_PATH ?? null,
  proxyTokenTeeMaxBytes: int('PROXY_TOKEN_TEE_MAX_BYTES', 2_097_152),

  // Azure OpenAI: auto-append `?api-version=...` when PROXY_PROVIDER=azure and
  // the request omits it. Empty string disables auto-append.
  azureOpenaiApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',

  // Per-request idle timeout: destroy hung upstream + client after N ms (H1).
  // 0 = disabled (v0.1 behaviour). Default 120 s.
  proxyRequestIdleTimeoutMs: int('PROXY_REQUEST_IDLE_TIMEOUT_MS', 120_000),

  maxBodyParseMb: +(process.env.PROXY_MAX_BODY_PARSE_MB || 10),
  maxApiResultRows: +(process.env.MAX_API_RESULT_ROWS || 5000),
  maxLogReadMb: +(process.env.LOG_READ_MAX_MB || 10),

  // Metrics
  maxMetricEvents: int('MAX_METRIC_EVENTS', 10_000),
  metricsTickMs: int('METRICS_TICK_MS', 1000),

  // Compactor (v0.3.0) — opt-in prompt/response compression.
  // Default off: preserves the "bytes never modified" invariant for non-opted-in
  // traffic. When enabled, mutates request/response bodies through a pipeline of
  // deterministic compressors. See docs/COMPACTOR.md.
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

  // Guardrails (v0.4.0) — opt-in prompt safety: secrets, PII, prompt-injection
  // detection. Default off: preserves the "bytes never modified" invariant.
  // When enabled, each category runs in one of four modes:
  //   off    — detector not run
  //   alert  — detect + record, forward unchanged (no mutation)
  //   block  — detect + reject with 4xx (no mutation, no forward)
  //   redact — detect + replace match with <redacted:NAME>, forward modified
  // See docs/GUARDRAILS.md.
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

  // Shutdown
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 30_000),
}
