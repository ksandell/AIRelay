import { config } from '../config.js'
import { selectCompactor } from './providers/index.js'
import { recordCompactorEvent, recordCompressorFire } from './metrics.js'

const HEADER = 'x-compactor'
const APPLIED_HEADER = 'X-Compactor-Applied'

function shouldRun(req) {
  if (!config.compactorEnabled) return false
  const h = (req.headers[HEADER] ?? '').toString().toLowerCase()
  if (h === 'off' || h === 'bypass' || h === 'false') return false
  return true
}

function readBody(req, cap) {
  // Cache middleware may have already buffered the body.
  if (req._cacheBodyBuffer) {
    const buf = req._cacheBodyBuffer
    if (buf.length > cap) return Promise.resolve({ overflowed: true, buf: null })
    return Promise.resolve({ overflowed: false, buf })
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let overflowed = false
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > cap) {
        overflowed = true
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (overflowed) return resolve({ overflowed: true, buf: null })
      resolve({ overflowed: false, buf: Buffer.concat(chunks) })
    })
    req.on('error', reject)
  })
}

const nowIso = () => new Date().toISOString()

function emitBypass(reason, bytesIn = 0) {
  recordCompactorEvent({
    ts: nowIso(),
    requestId: null,
    scope: 'request',
    filtersFired: [],
    bytesIn,
    bytesOut: bytesIn,
    bytesSaved: 0,
    estimatedTokensSaved: 0,
    durationMicros: 0,
    bypassReason: reason,
  })
}

/**
 * Express middleware mounted under the proxy prefix, BEFORE the proxy handler.
 *
 * Activation: COMPACTOR_ENABLED=true and the request does not opt out via
 * `X-Compactor: off`.
 *
 * On activation: buffer the body, parse as JSON, walk the provider-specific
 * message shape, run the compressor pipeline on each text segment, then
 * stash the (possibly mutated) body on req._compactorBody for the proxy
 * handler to forward via http-proxy's `buffer` option.
 *
 * Bypasses (and falls through with original stream intact) when:
 *   - method != POST/PUT/PATCH
 *   - Content-Type is not application/json
 *   - body exceeds COMPACTOR_MAX_REQ_BYTES
 *   - body has `"stream": true`
 *   - selected provider is unsupported
 *   - parse error
 */
function attach(req, fields) {
  req._compactorEvent = { ...(req._compactorEvent ?? {}), ...fields }
}

export function createCompactorMiddleware() {
  return async (req, res, next) => {
    const headerVal = (req.headers[HEADER] ?? '').toString().toLowerCase()
    const bypassedByHeader = headerVal === 'off' || headerVal === 'bypass' || headerVal === 'false'
    if (bypassedByHeader) attach(req, { compactorBypass: true, compactorActive: false })
    if (!shouldRun(req)) return next()
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return next()

    const contentType = (req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.includes('application/json')) {
      emitBypass('non-json')
      return next()
    }

    const t0 = process.hrtime.bigint()
    let read
    try {
      read = await readBody(req, config.compactorMaxReqBytes)
    } catch {
      emitBypass('read-error')
      return next()
    }

    if (read.overflowed) {
      emitBypass('oversize')
      res.statusCode = 413
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          error: 'compactor buffer cap exceeded; send X-Compactor: off to bypass',
          cap: config.compactorMaxReqBytes,
        }),
      )
      return
    }

    const original = read.buf
    let parsed
    try {
      parsed = JSON.parse(original.toString('utf8'))
    } catch {
      emitBypass('parse-error', original.length)
      req._compactorBody = original
      return next()
    }

    if (parsed && parsed.stream === true) {
      emitBypass('streaming', original.length)
      res.setHeader(APPLIED_HEADER, 'bypass-streaming')
      req._compactorBody = original
      return next()
    }

    if (!config.compactorRequestBody) {
      req._compactorBody = original
      return next()
    }

    const { kind, compact } = selectCompactor(config.proxyProvider)
    if (kind === 'passthrough') {
      emitBypass('unsupported-provider', original.length)
      req._compactorBody = original
      return next()
    }

    const result = compact(parsed)
    const t1 = process.hrtime.bigint()
    const durationMicros = Number((t1 - t0) / 1000n)

    if (result.fires.length === 0) {
      attach(req, {
        compactorActive: true,
        compactorBypass: false,
        compactorSavedBytes: 0,
        compactorCompressors: null,
      })
      recordCompactorEvent({
        ts: nowIso(),
        requestId: null,
        scope: 'request',
        filtersFired: [],
        bytesIn: original.length,
        bytesOut: original.length,
        bytesSaved: 0,
        estimatedTokensSaved: 0,
        durationMicros,
        bypassReason: 'no-fires',
      })
      req._compactorBody = original
      return next()
    }

    const repacked = Buffer.from(JSON.stringify(result.body), 'utf8')
    const uniqueFilters = new Set()
    for (const f of result.fires) {
      recordCompressorFire(f)
      uniqueFilters.add(f.name)
    }
    const bytesSaved = original.length - repacked.length
    attach(req, {
      compactorActive: true,
      compactorBypass: false,
      compactorSavedBytes: Math.max(0, bytesSaved),
      compactorCompressors: [...uniqueFilters].join(','),
    })
    recordCompactorEvent({
      ts: nowIso(),
      requestId: null,
      scope: 'request',
      filtersFired: [...uniqueFilters],
      bytesIn: original.length,
      bytesOut: repacked.length,
      bytesSaved: Math.max(0, bytesSaved),
      estimatedTokensSaved: Math.max(0, Math.floor(bytesSaved / 4)),
      durationMicros,
      bypassReason: null,
    })
    res.setHeader(APPLIED_HEADER, [...uniqueFilters].join(','))
    req._compactorBody = repacked
    req.headers['content-length'] = String(repacked.length)
    return next()
  }
}
