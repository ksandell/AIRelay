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
  compactorEnabled: process.env.COMPACTOR_ENABLED === 'true',
  compactorRequestBody: process.env.COMPACTOR_REQUEST_BODY !== 'false',
  compactorResponseBody: process.env.COMPACTOR_RESPONSE_BODY === 'true',
  compactorToolResultOnly: process.env.COMPACTOR_TOOL_RESULT_ONLY !== 'false',
  compactorAllowRisky: process.env.COMPACTOR_ALLOW_RISKY === 'true',
  compactorMaxReqBytes: int('COMPACTOR_MAX_REQ_BYTES', 4_194_304),
  compactorLongFileThreshold: int('COMPACTOR_LONG_FILE_THRESHOLD', 400),
  compactor: {
    ansiStrip: process.env.COMPACTOR_ANSI_STRIP_ENABLED !== 'false',
    blanklineCollapse: process.env.COMPACTOR_BLANKLINE_COLLAPSE_ENABLED !== 'false',
    diffCollapse: process.env.COMPACTOR_DIFF_COLLAPSE_ENABLED !== 'false',
    lockfileDrop: process.env.COMPACTOR_LOCKFILE_DROP_ENABLED !== 'false',
    lsLongShrink: process.env.COMPACTOR_LS_LONG_SHRINK_ENABLED !== 'false',
    npmNoiseStrip: process.env.COMPACTOR_NPM_NOISE_STRIP_ENABLED !== 'false',
    repeatLineDedupe: process.env.COMPACTOR_REPEAT_LINE_DEDUPE_ENABLED !== 'false',
    stacktraceDedupe: process.env.COMPACTOR_STACKTRACE_DEDUPE_ENABLED !== 'false',
    longFileElide: process.env.COMPACTOR_LONG_FILE_ELIDE_ENABLED !== 'false',
    base64Truncate: process.env.COMPACTOR_BASE64_TRUNCATE_ENABLED !== 'false',
  },

  // Guardrails (v0.4.0) — opt-in prompt safety: secrets, PII, prompt-injection
  // detection. Default off: preserves the "bytes never modified" invariant.
  // When enabled, each category runs in one of four modes:
  //   off    — detector not run
  //   alert  — detect + record, forward unchanged (no mutation)
  //   block  — detect + reject with 4xx (no mutation, no forward)
  //   redact — detect + replace match with <redacted:NAME>, forward modified
  // See docs/GUARDRAILS.md.
  guardrailsEnabled: process.env.GUARDRAILS_ENABLED === 'true',
  guardrailsMaxReqBytes: int('GUARDRAILS_MAX_REQ_BYTES', 4_194_304),
  guardrailsSecretsMode: mode('GUARDRAILS_SECRETS_MODE', 'off'),
  guardrailsPiiMode: mode('GUARDRAILS_PII_MODE', 'off'),
  guardrailsInjectionMode: mode('GUARDRAILS_INJECTION_MODE', 'off'),
  guardrailsCustomPatternsFile: process.env.GUARDRAILS_CUSTOM_PATTERNS_FILE ?? null,
  guardrails: {
    awsAccessKey: process.env.GUARDRAILS_AWS_ACCESS_KEY_ENABLED !== 'false',
    githubPat: process.env.GUARDRAILS_GITHUB_PAT_ENABLED !== 'false',
    anthropicKey: process.env.GUARDRAILS_ANTHROPIC_KEY_ENABLED !== 'false',
    openaiKey: process.env.GUARDRAILS_OPENAI_KEY_ENABLED !== 'false',
    privateKey: process.env.GUARDRAILS_PRIVATE_KEY_ENABLED !== 'false',
    jwt: process.env.GUARDRAILS_JWT_ENABLED !== 'false',
    genericHighEntropy: process.env.GUARDRAILS_GENERIC_HIGH_ENTROPY_ENABLED === 'true',
    email: process.env.GUARDRAILS_EMAIL_ENABLED !== 'false',
    phone: process.env.GUARDRAILS_PHONE_ENABLED !== 'false',
    ssnUs: process.env.GUARDRAILS_SSN_ENABLED === 'true',
    creditCard: process.env.GUARDRAILS_CREDIT_CARD_ENABLED !== 'false',
    roleOverride: process.env.GUARDRAILS_ROLE_OVERRIDE_ENABLED !== 'false',
    systemPromptLeak: process.env.GUARDRAILS_SYSTEM_PROMPT_LEAK_ENABLED !== 'false',
    toolOverride: process.env.GUARDRAILS_TOOL_OVERRIDE_ENABLED !== 'false',
  },

  // Shutdown
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 30_000),
}
