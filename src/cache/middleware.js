import { config } from '../config.js'
import { isConnected } from './client.js'
import { hashBody } from './normalize.js'
import { exactGet, exactSet } from './exact.js'
import { dedupGet, dedupSet, dedupDelete } from './dedup.js'
import { checkSpendLimit } from './spend.js'
import { recordCacheEvent } from './metrics.js'

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total <= cap) chunks.push(chunk)
    })
    req.on('end', () => resolve(total > cap ? null : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function createCacheMiddleware() {
  return async (req, res, next) => {
    if (!config.cacheEnabled || !isConnected()) return next()
    if (req.method !== 'POST') return next()
    if (!(req.headers['content-type'] ?? '').includes('application/json')) return next()

    // Bypass via X-Cache: no-store
    const cacheHeader = (req.headers['x-cache'] ?? '').toString().toLowerCase()
    if (cacheHeader === 'no-store') return next()

    // Buffer body — stored on req so Compactor/Guardrails can use it too
    const buf = await readBody(req, 8_388_608 /* 8 MiB hard cap */).catch(() => null)
    if (!buf) return next() // oversize or read error — pass through

    req._cacheBodyBuffer = buf

    let parsed
    try {
      parsed = JSON.parse(buf.toString('utf8'))
    } catch {
      return next()
    }

    // 1. Spend gate
    if (config.cacheSpendEnabled) {
      const exceeded = await checkSpendLimit(req)
      if (exceeded) {
        res.set('X-Spend-Limit-Exceeded', exceeded)
        recordCacheEvent({ ts: new Date().toISOString(), type: 'SPEND-REJECT' })
        return res.status(429).json({ error: `Spend limit exceeded: ${exceeded}` })
      }
    }

    const sha256 = hashBody(parsed)

    // 2. Dedup — if same sha256 is in-flight, wait for its result
    if (config.cacheDedupEnabled) {
      const inflight = dedupGet(sha256)
      if (inflight) {
        const cached = await inflight.catch(() => null)
        if (cached) {
          res.set('X-Cache', 'DEDUP')
          res.set('Content-Type', cached.contentType ?? 'application/json')
          recordCacheEvent({
            ts: new Date().toISOString(),
            type: 'DEDUP',
            keyPrefix: sha256.slice(0, 8),
          })
          return res.status(cached.statusCode ?? 200).send(cached.body)
        }
      }
    }

    // 3. Exact-match cache lookup
    if (config.cacheExactMatchEnabled) {
      const hit = await exactGet(sha256)
      if (hit) {
        const ageS = Math.floor((Date.now() - (hit.cachedAt ?? Date.now())) / 1000)
        res.set('X-Cache', 'HIT')
        res.set('X-Cache-Age', String(ageS))
        res.set('X-Cache-Key', sha256.slice(0, 8))
        res.set('Content-Type', hit.contentType ?? 'application/json')
        recordCacheEvent({
          ts: new Date().toISOString(),
          type: 'HIT',
          keyPrefix: sha256.slice(0, 8),
          keyAgeS: ageS,
          bytes: (hit.body ?? '').length,
        })
        return res.status(hit.statusCode ?? 200).send(hit.body)
      }
    }

    // 4. Cache miss — set up dedup promise + tee response into Redis
    res.set('X-Cache', 'MISS')
    recordCacheEvent({ ts: new Date().toISOString(), type: 'MISS', keyPrefix: sha256.slice(0, 8) })

    let resolveDedup
    let settled = false
    const dedupPromise = new Promise((resolve) => {
      resolveDedup = resolve
    })
    if (config.cacheDedupEnabled) dedupSet(sha256, dedupPromise)

    // Guard against a dedup leak: if the connection is destroyed (idle
    // watchdog, client abort) the wrapped res.end never runs, so the in-flight
    // promise would stay pending and the Map entry would leak. Resolve null +
    // delete on close if nothing settled it first.
    res.on('close', () => {
      if (settled) return
      settled = true
      resolveDedup?.(null)
      dedupDelete(sha256)
    })

    // Intercept res.write + res.end to capture upstream response.
    // Buffering is bounded: we stop accumulating once the response is known to
    // be uncacheable (event-stream) or exceeds the tee cap, so a large or
    // streaming response can never grow the heap unbounded.
    const origWrite = res.write.bind(res)
    const origEnd = res.end.bind(res)
    const origWriteHead = res.writeHead.bind(res)
    const TEE_CAP = config.cacheMaxResponseBytes
    let chunks = []
    let bufBytes = 0
    let teeDisabled = false
    let statusCode = 200
    let contentType = 'application/json'

    const isCacheableContentType = () =>
      !String(res.getHeader('content-type') ?? '').includes('text/event-stream')

    const accumulate = (chunk) => {
      if (teeDisabled || !chunk) return
      // Decide once we have headers: never buffer a streaming response.
      if (!isCacheableContentType()) {
        teeDisabled = true
        chunks = []
        return
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bufBytes += buf.length
      if (bufBytes > TEE_CAP) {
        teeDisabled = true
        chunks = []
        return
      }
      chunks.push(buf)
    }

    res.writeHead = function (code, ...args) {
      statusCode = code
      return origWriteHead(code, ...args)
    }
    res.write = function (chunk, ...args) {
      accumulate(chunk)
      return origWrite(chunk, ...args)
    }
    res.end = function (chunk, ...args) {
      accumulate(chunk)
      contentType = res.getHeader('content-type') ?? 'application/json'

      const isSuccess = statusCode >= 200 && statusCode < 300
      const alreadySettled = settled
      settled = true

      if (!alreadySettled && isSuccess && !teeDisabled && chunks.length > 0) {
        const body = Buffer.concat(chunks).toString('utf8')
        const entry = { body, statusCode, contentType }
        queueMicrotask(async () => {
          await exactSet(sha256, entry).catch(() => {})
          resolveDedup?.(entry)
          dedupDelete(sha256)
        })
      } else if (!alreadySettled) {
        resolveDedup?.(null)
        dedupDelete(sha256)
      }

      return origEnd(chunk, ...args)
    }

    next()
  }
}
