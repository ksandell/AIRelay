import httpProxy from 'http-proxy'
import { config } from '../config.js'
import { pickAgent } from './agent.js'
import { record, incInFlight, decInFlight } from '../metrics/collector.js'
import { loadProvider } from '../providers/registry.js'

// Provider singleton — constructed once at module load. Null when token tracking
// is disabled, which short-circuits all per-request buffering for zero overhead.
const provider = config.proxyTokenTracking
  ? loadProvider(config.proxyProvider, config.pricingConfigPath)
  : null

const proxy = httpProxy.createProxyServer({
  target: config.upstreamUrl,
  // Rewrite Host header to the upstream's host. Required for any upstream that
  // validates the Host header (most managed AI APIs do — e.g. api.anthropic.com,
  // api.openai.com, generativelanguage.googleapis.com return 4xx without this).
  // Body bytes still pass through unchanged — only Host is touched.
  // NOTE: this breaks SigV4-signed providers (e.g. AWS Bedrock) because the
  // signature is bound to the original Host header. See docs/proxy-metrics-plan.md
  // §"Provider compatibility" for details.
  changeOrigin: true,
  xfwd: config.proxyTrustForwarded,
  agent: pickAgent(config.upstreamUrl),
  secure: false,
  ws: false,
  selfHandleResponse: false,
})

// Count outbound bytes via a passive listener — no body is buffered, the chunks
// flow straight through to the client. Same idea inbound on `req`.
// When token tracking is enabled, an additional passive listener tees chunks
// into a per-request array for post-response extraction.
proxy.on('proxyRes', (proxyRes, req) => {
  const m = req._metrics
  if (!m) return
  m.status = proxyRes.statusCode
  proxyRes.on('data', (chunk) => {
    m.bytesOut += chunk.length
  })
  if (provider && proxyRes.statusCode < 400) {
    m.chunks = []
    m.teeBytes = 0
    const cap = config.proxyTokenTeeMaxBytes
    proxyRes.on('data', (chunk) => {
      if (m.teeAborted) return
      m.teeBytes += chunk.length
      if (m.teeBytes > cap) {
        m.chunks = null
        m.teeAborted = true
        return
      }
      m.chunks.push(chunk)
    })
  }
})

proxy.on('error', (err, req, res) => {
  const m = req?._metrics
  if (m) {
    m.error = err.code || err.message
    m.status = m.status || 502
  }
  if (res && !res.headersSent) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'bad gateway', code: err.code ?? null }))
  } else if (res && res.writable) {
    try {
      res.end()
    } catch {
      // ignore close errors
    }
  }
})

function baseEvent(m) {
  return {
    ts: m.ts,
    method: m.method,
    path: m.path,
    status: m.status || 0,
    durationMs: Date.now() - m.start,
    bytesIn: m.bytesIn,
    bytesOut: m.bytesOut,
    upstream: config.upstreamUrl,
    error: m.error ?? null,
    provider: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    costUsd: null,
    toolCalls: null,
    toolBytesIn: null,
    toolBytesOut: null,
  }
}

function finalize(m) {
  if (!m || m.recorded) return
  m.recorded = true
  const event = baseEvent(m)

  if (provider && m.chunks && m.chunks.length > 0) {
    const chunks = m.chunks
    const reqChunks = m.reqChunks
    m.chunks = null // release ref before microtask queue settles
    m.reqChunks = null
    queueMicrotask(() => {
      try {
        const body = Buffer.concat(chunks)
        const reqBody = reqChunks ? Buffer.concat(reqChunks) : null
        const tokens = provider.extractTokens(body)
        if (tokens) {
          event.provider = provider.name
          event.model = tokens.model ?? null
          event.inputTokens = tokens.inputTokens ?? null
          event.outputTokens = tokens.outputTokens ?? null
          event.cacheReadTokens = tokens.cacheReadTokens ?? null
          event.cacheWriteTokens = tokens.cacheWriteTokens ?? null
          event.totalTokens = tokens.totalTokens ?? null
          try {
            event.costUsd = provider.calculateCost(tokens)
          } catch {
            event.costUsd = null
          }
        } else {
          event.provider = provider.name
        }
        try {
          const tools = provider.extractToolCalls(reqBody, body)
          if (tools) {
            event.toolCalls = tools.toolCalls ?? null
            event.toolBytesIn = tools.toolBytesIn ?? null
            event.toolBytesOut = tools.toolBytesOut ?? null
          }
        } catch {
          // ignore tool extraction errors
        }
      } catch {
        // Provider errors must never crash the proxy. Record the base event.
      } finally {
        record(event)
      }
    })
  } else {
    record(event)
  }
  decInFlight()
}

export function createProxyHandler() {
  if (!config.upstreamUrl) {
    // Misconfig guard — a 503 is more honest than silently 404ing.
    return (req, res) => {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'proxy disabled — UPSTREAM_URL not set' }))
    }
  }

  return (req, res) => {
    const m = {
      ts: new Date().toISOString(),
      start: Date.now(),
      method: req.method,
      // originalUrl preserves the full incoming path (req.url is stripped by Express
      // when mounted under PROXY_PATH_PREFIX).
      path: req.originalUrl,
      status: 0,
      bytesIn: 0,
      bytesOut: 0,
      error: null,
      recorded: false,
      chunks: null,
    }
    req._metrics = m
    incInFlight()

    req.on('data', (chunk) => {
      m.bytesIn += chunk.length
      if (provider && !m.reqTeeAborted) {
        if (!m.reqChunks) {
          m.reqChunks = []
          m.reqTeeBytes = 0
        }
        m.reqTeeBytes += chunk.length
        if (m.reqTeeBytes > config.proxyTokenTeeMaxBytes) {
          m.reqChunks = null
          m.reqTeeAborted = true
        } else {
          m.reqChunks.push(chunk)
        }
      }
    })
    req.on('aborted', () => {
      m.error = m.error || 'client_aborted'
    })

    // 'finish' fires when the response body has been flushed to the kernel —
    // this is the right moment for duration. 'close' is a backstop in case the
    // client disconnects before completion. The `recorded` flag prevents double-counting.
    res.on('finish', () => finalize(m))
    res.on('close', () => finalize(m))

    proxy.web(req, res, {}, (err) => {
      // Fallback for the err callback variant (rare — error event usually fires first).
      if (err && !m.recorded) {
        m.error = err.code || err.message
        m.status = m.status || 502
        finalize(m)
        if (!res.headersSent) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'bad gateway', code: err.code ?? null }))
        }
      }
    })
  }
}

// Test-only: tear down the singleton between vitest runs so file handles close.
export function _closeProxy() {
  try {
    proxy.close()
  } catch {
    // ignore close errors
  }
}
