import httpProxy from 'http-proxy-3'
import { Readable } from 'node:stream'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'
import { URL } from 'node:url'
import { config } from '../config.js'
import { pickAgent } from './agent.js'
import { record, incInFlight, decInFlight } from '../metrics/collector.js'
import { incrementSpend } from '../cache/spend.js'

// Strip well-known secret query-param names before storing in metrics DB.
const SECRET_PARAMS = new Set(['key', 'token', 'api_key', 'apikey', 'access_token', 'secret'])
function redactUrl(rawUrl) {
  try {
    const u = new URL(rawUrl, 'http://x')
    let changed = false
    for (const name of SECRET_PARAMS) {
      if (u.searchParams.has(name)) {
        u.searchParams.set(name, '[REDACTED]')
        changed = true
      }
    }
    if (!changed) return rawUrl
    return u.pathname + (u.search !== '?' ? u.search : '')
  } catch {
    return rawUrl
  }
}

// Off the hot path: decode the (possibly compressed) teed response body
// for token/tool extraction. Mistral & friends ship brotli-compressed JSON
// for non-streaming responses when the client sends Accept-Encoding: br/gzip.
// SSE streams aren't compressed (servers skip compression for text/event-stream),
// so the streaming path doesn't need this. Returns null on decode failure.
function decodeBody(buffer, encoding) {
  if (!encoding) return buffer
  const enc = encoding.toLowerCase().trim()
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return gunzipSync(buffer)
    if (enc === 'br') return brotliDecompressSync(buffer)
    if (enc === 'deflate') return inflateSync(buffer)
  } catch {
    return null
  }
  return buffer
}

// Module-scoped proxy instance. Target is supplied per-request via web()'s
// options bag so the same instance serves every route in the table.
const proxy = httpProxy.createProxyServer({
  // Rewrite Host header to the upstream's host. Required for any upstream that
  // validates the Host header (most managed AI APIs do — e.g. api.anthropic.com,
  // api.openai.com, generativelanguage.googleapis.com return 4xx without this).
  // Body bytes still pass through unchanged — only Host is touched.
  // NOTE: breaks SigV4-signed providers (e.g. AWS Bedrock) because the
  // signature is bound to the original Host header. See docs/proxy-metrics-plan.md
  // §"Provider compatibility" for details.
  changeOrigin: true,
  secure: false,
  ws: false,
  selfHandleResponse: false,
})

// Azure OpenAI requires `?api-version=YYYY-MM-DD` on every request. When the
// upstream SDK omits it we append from config. The check is per-request and
// route-aware (only fires when the matched route's provider is `azure`).
const azureApiVersionParam = config.azureOpenaiApiVersion
  ? encodeURIComponent(config.azureOpenaiApiVersion)
  : null
const apiVersionParamRe = /[?&]api-version=/

// Count outbound bytes via a passive listener — no body is buffered, the chunks
// flow straight through to the client. Same idea inbound on `req`.
// When token tracking is enabled and the route has a provider instance, an
// additional passive listener tees chunks into a per-request array for
// post-response extraction.
proxy.on('proxyRes', (proxyRes, req, res) => {
  const m = req._metrics
  if (!m) return
  m.status = proxyRes.statusCode

  // Backpressure (H3): http-proxy pipes proxyRes → res (selfHandleResponse: false).
  // When the client socket's write buffer fills, res.writableNeedDrain becomes true
  // (the internal pipe's write() returned false). We check this flag after each
  // data chunk and pause proxyRes so upstream stops pushing; resume on drain.
  // Zero sync I/O — only event listener registration on the hot path.
  res.on('drain', () => {
    if (!proxyRes.destroyed && proxyRes.isPaused()) proxyRes.resume()
  })

  proxyRes.on('data', (chunk) => {
    m.bytesOut += chunk.length
    if (res.writableNeedDrain && !proxyRes.isPaused()) {
      proxyRes.pause()
    }
  })

  const provider = req._route?.providerInstance
  if (provider && proxyRes.statusCode < 400) {
    m.chunks = []
    m.teeBytes = 0
    m.respEncoding = proxyRes.headers['content-encoding'] ?? null
    const cap = config.proxyTokenTeeMaxBytes
    proxyRes.on('data', (chunk) => {
      if (m.teeAborted) return
      m.teeBytes += chunk.length
      if (m.teeBytes > cap) {
        m.teeAborted = true
        m.chunks = null
        return
      }
      m.chunks.push(chunk)
    })
  }
})

function classifyError(err) {
  const code = err?.code || ''
  if (code === 'ECONNABORTED' || err?.message?.includes('client abort')) return 'client_abort'
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'upstream_timeout'
  if (code === 'ECONNREFUSED') return 'upstream_refused'
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'upstream_reset'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'upstream_dns'
  if (code.startsWith('ERR_TLS_') || code.startsWith('CERT_')) return 'tls'
  return code || err?.message || 'upstream_error'
}

proxy.on('error', (err, req, res) => {
  const m = req?._metrics
  if (m) {
    m.error = classifyError(err)
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
      /* ignore */
    }
  }
})

function baseEvent(m) {
  const ce = m.compactorEvent ?? null
  const ge = m.guardrailsEvent ?? null
  return {
    ts: m.ts,
    method: m.method,
    path: m.path,
    status: m.status || 0,
    durationMs: Date.now() - m.start,
    bytesIn: m.bytesIn,
    bytesOut: m.bytesOut,
    upstream: m.upstream,
    route: m.routePrefix,
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
    compactorActive: ce?.compactorActive ?? null,
    compactorBypass: ce?.compactorBypass ?? null,
    compactorSavedBytes: ce?.compactorSavedBytes ?? null,
    compactorCompressors: ce?.compactorCompressors ?? null,
    guardrailsAction: ge?.guardrailsAction ?? null,
    guardrailsHits: ge?.guardrailsHits ?? null,
    guardrailsDetectors: ge?.guardrailsDetectors ?? null,
    // Cache outcome for a proxied request is always a MISS (hits/dedup/reject
    // short-circuit in the cache middleware and never reach the proxy). Tagged
    // on m by the cache middleware via req._cacheStatus.
    cacheStatus: m.cacheStatus ?? null,
    cacheKeyPrefix: m.cacheKeyPrefix ?? null,
    cacheAgeS: null,
    bytesFromCache: null,
  }
}

function finalize(m, providerInstance) {
  if (!m || m.recorded) return
  m.recorded = true
  const event = baseEvent(m)

  if (providerInstance && m.chunks && m.chunks.length > 0) {
    const chunks = m.chunks
    const reqChunks = m.reqChunks
    m.chunks = null
    m.reqChunks = null
    const respEncoding = m.respEncoding ?? null
    queueMicrotask(() => {
      try {
        const rawBody = Buffer.concat(chunks)
        const body = decodeBody(rawBody, respEncoding)
        if (!body) {
          // Decode failed — still surface the provider on the event so the
          // dashboard shows the call was handled by e.g. 'mistral', just
          // without token/tool figures.
          event.provider = providerInstance.name
          return
        }
        const reqBody = reqChunks ? Buffer.concat(reqChunks) : null
        const tokens = providerInstance.extractTokens(body)
        if (tokens) {
          event.provider = providerInstance.name
          event.model = tokens.model ?? null
          event.inputTokens = tokens.inputTokens ?? null
          event.outputTokens = tokens.outputTokens ?? null
          event.cacheReadTokens = tokens.cacheReadTokens ?? null
          event.cacheWriteTokens = tokens.cacheWriteTokens ?? null
          event.totalTokens = tokens.totalTokens ?? null
          try {
            event.costUsd = providerInstance.calculateCost(tokens)
          } catch {
            event.costUsd = null
          }
          // Per-key spend accounting (v0.6.0). Only when the spend gate is on
          // and we have both a request reference and a non-zero cost. Fire and
          // forget — Redis errors must never affect the recorded event.
          if (config.cacheSpendEnabled && m.spendReq && event.costUsd) {
            incrementSpend(m.spendReq, event.costUsd).catch(() => {})
          }
        } else {
          event.provider = providerInstance.name
        }
        try {
          const tools = providerInstance.extractToolCalls(reqBody, body)
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

/**
 * Build an Express handler bound to a specific route. Each route gets its own
 * handler closure so the upstream URL, provider, agent, and trustForwarded
 * setting are pre-resolved (no per-request lookup on the hot path).
 */
export function createProxyHandler(route) {
  if (!route) {
    return (req, res) => {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'proxy disabled — no routes configured' }))
    }
  }

  const agent = pickAgent(route.upstream)
  const isAzure = route.provider === 'azure' && azureApiVersionParam !== null

  return (req, res) => {
    req._route = route
    const m = {
      ts: new Date().toISOString(),
      start: Date.now(),
      method: req.method,
      path: redactUrl(req.originalUrl),
      routePrefix: route.prefix,
      upstream: route.upstream,
      status: 0,
      bytesIn: 0,
      bytesOut: 0,
      error: null,
      recorded: false,
      chunks: null,
    }
    req._metrics = m
    incInFlight()

    if (isAzure && !apiVersionParamRe.test(req.url)) {
      const sep = req.url.includes('?') ? '&' : '?'
      req.url = `${req.url}${sep}api-version=${azureApiVersionParam}`
    }

    // Idle watchdog — destroy hung connections after proxyRequestIdleTimeoutMs.
    let idleTimer = null
    if (config.proxyRequestIdleTimeoutMs > 0) {
      idleTimer = setTimeout(() => {
        if (!m.recorded) {
          m.error = 'upstream_timeout'
          m.status = m.status || 504
          finalize(m, route.providerInstance)
        }
        try {
          req.destroy()
        } catch {
          /* ignore */
        }
        try {
          res.destroy()
        } catch {
          /* ignore */
        }
      }, config.proxyRequestIdleTimeoutMs)
      idleTimer.unref()
    }

    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }
    res.on('finish', clearIdle)
    res.on('close', clearIdle)

    req.on('data', (chunk) => {
      m.bytesIn += chunk.length
      if (route.providerInstance && !m.reqTeeAborted) {
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
      m.error = m.error || 'client_abort'
    })

    const captureMw = () => {
      m.compactorEvent = req._compactorEvent ?? null
      m.guardrailsEvent = req._guardrailsEvent ?? null
    }
    res.on('finish', () => {
      captureMw()
      finalize(m, route.providerInstance)
    })
    res.on('close', () => {
      captureMw()
      finalize(m, route.providerInstance)
    })

    // Compactor / Guardrails: if a substitute body was buffered by either
    // middleware, feed it to http-proxy via the `buffer` option so the
    // (possibly mutated) bytes go upstream instead of the already-consumed
    // request stream. Guardrails runs after Compactor and its body supersedes.
    const substituteBody = req._guardrailsBody ?? req._compactorBody ?? req._cacheBodyBuffer
    const proxyOpts = {
      target: route.upstream,
      agent,
      xfwd: route.trustForwarded,
    }
    if (substituteBody) {
      proxyOpts.buffer = Readable.from([substituteBody])
      m.bytesIn = substituteBody.length
      // The request stream was already consumed by a middleware (cache /
      // compactor / guardrails), so the proxy's own req.on('data') tee never
      // fires. Seed the tee from the substitute body (capped) so tool-call
      // extraction still works on cached-eligible / mutated traffic.
      if (
        route.providerInstance &&
        !m.reqChunks &&
        substituteBody.length <= config.proxyTokenTeeMaxBytes
      ) {
        m.reqChunks = [substituteBody]
        m.reqTeeBytes = substituteBody.length
      }
    }
    // Capture the request for per-key spend accounting in finalize().
    if (config.cacheSpendEnabled) m.spendReq = req
    // Carry the cache MISS tag set by the cache middleware onto the event.
    if (req._cacheStatus) {
      m.cacheStatus = req._cacheStatus
      m.cacheKeyPrefix = req._cacheKeyPrefix ?? null
    }

    proxy.web(req, res, proxyOpts, (err) => {
      if (err && !m.recorded) {
        m.error = classifyError(err)
        m.status = m.status || 502
        finalize(m, route.providerInstance)
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
