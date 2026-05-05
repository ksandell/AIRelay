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

  // Metrics
  maxMetricEvents: int('MAX_METRIC_EVENTS', 10_000),
  metricsTickMs: int('METRICS_TICK_MS', 1000),

  // Shutdown
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 30_000),
}
