import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

vi.mock('../../src/cache/client.js', () => ({
  isConnected: vi.fn(() => true),
  getClient: vi.fn(),
}))

vi.mock('../../src/cache/exact.js', () => ({
  exactGet: vi.fn(async () => null),
  exactSet: vi.fn(async () => {}),
}))

vi.mock('../../src/cache/spend.js', () => ({
  checkSpendLimit: vi.fn(async () => null),
}))

vi.mock('../../src/cache/metrics.js', () => ({
  recordCacheEvent: vi.fn(),
}))

vi.mock('../../src/metrics/collector.js', () => ({
  record: vi.fn(),
}))

vi.mock('../../src/config.js', () => ({
  config: {
    cacheEnabled: true,
    cacheDedupEnabled: true,
    cacheExactMatchEnabled: true,
    cacheSpendEnabled: false,
    cacheMaxResponseBytes: 5_242_880,
  },
}))

// Keep the real in-flight Map (so dedupSize() means something) but capture the
// promise the middleware stores — the sha256 is internal to the middleware and
// dedup.js exposes no iterator, which is the right shape for production code.
let inflight = null
vi.mock('../../src/cache/dedup.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    dedupSet: (key, promise) => {
      inflight = promise
      return actual.dedupSet(key, promise)
    },
  }
})

import { exactGet, exactSet } from '../../src/cache/exact.js'
import { createCacheMiddleware } from '../../src/cache/middleware.js'
import { dedupSize, _resetDedup } from '../../src/cache/dedup.js'

const CAP = 8_388_608

/** Request stub: a real Readable, so "already consumed" behaves as in production. */
function makeReq(body, { contentLength = 'auto' } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const req = Readable.from([buf])
  req.method = 'POST'
  req.originalUrl = '/proxy/v1/messages'
  const declared = contentLength === 'auto' ? buf.length : contentLength
  req.headers = {
    'content-type': 'application/json',
    ...(contentLength === null ? {} : { 'content-length': String(declared) }),
  }
  return req
}

/** Response stub mimicking the header + event surface the middleware wraps. */
function makeRes() {
  const res = new EventEmitter()
  const headers = {}
  res.statusCode = 200
  res.set = (k, v) => {
    headers[k.toLowerCase()] = v
    return res
  }
  res.setHeader = res.set
  res.getHeader = (k) => headers[k.toLowerCase()]
  res.writeHead = (code) => {
    res.statusCode = code
    return res
  }
  res.write = () => true
  res.end = () => res
  return res
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  exactGet.mockResolvedValue(null)
  exactSet.mockResolvedValue(undefined)
  inflight = null
  _resetDedup()
})

describe('body buffering (F3) — never consume what we cannot hand back', () => {
  it('sets the replay buffer when the body is not valid JSON', async () => {
    const raw = '{"model":"claude-opus-5","messages":[' // truncated by the client
    const req = makeReq(raw)
    const next = vi.fn()

    await createCacheMiddleware()(req, makeRes(), next)

    expect(next).toHaveBeenCalledOnce()
    expect(req._cacheBodyBuffer?.toString()).toBe(raw)
  })

  it('leaves the stream untouched when Content-Length is absent', async () => {
    const req = makeReq('{"a":1}', { contentLength: null })
    const next = vi.fn()

    await createCacheMiddleware()(req, makeRes(), next)

    expect(next).toHaveBeenCalledOnce()
    expect(req._cacheBodyBuffer).toBeUndefined()
    expect(req.readableEnded).toBe(false)
  })

  it('leaves the stream untouched when Content-Length exceeds the cap', async () => {
    const req = makeReq('{"a":1}', { contentLength: CAP + 1 })
    const next = vi.fn()

    await createCacheMiddleware()(req, makeRes(), next)

    expect(next).toHaveBeenCalledOnce()
    expect(req._cacheBodyBuffer).toBeUndefined()
    expect(req.readableEnded).toBe(false)
  })
})

describe('stream requests bypass the cache entirely', () => {
  it('never checks or populates the exact-match cache for stream:true, even with a matching entry cached', async () => {
    // A non-streaming request with identical content already produced a
    // cache-worthy entry. If the stream:true request below reached exactGet,
    // it would get this back — and get served a single JSON object instead
    // of the SSE stream it asked for.
    exactGet.mockResolvedValue({
      body: '{"cached":true}',
      statusCode: 200,
      contentType: 'application/json',
      cachedAt: Date.now(),
    })

    const req = makeReq('{"model":"m","stream":true,"messages":[{"role":"user","content":"hi"}]}')
    const res = makeRes()
    const next = vi.fn()

    await createCacheMiddleware()(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(exactGet).not.toHaveBeenCalled()
    expect(res.getHeader('x-cache')).toBeUndefined()
    expect(dedupSize()).toBe(0)
  })
})

describe('dedup lifecycle', () => {
  it('releases waiters without waiting on the cache write (F1)', async () => {
    // A stalled-but-connected Dragonfly: the SET never settles, never throws.
    exactSet.mockImplementation(() => new Promise(() => {}))

    const req = makeReq('{"model":"claude-opus-5"}')
    const res = makeRes()
    await createCacheMiddleware()(req, res, vi.fn())
    expect(dedupSize()).toBe(1)

    res.setHeader('content-type', 'application/json')
    res.write('{"ok":')
    res.end('true}')

    expect(await withTimeout(inflight, 200)).toMatchObject({
      body: '{"ok":true}',
      statusCode: 200,
    })
    expect(dedupSize()).toBe(0)
  })

  it('releases waiters as soon as the response is known uncacheable (F4)', async () => {
    // Request itself is a normal JSON POST — it's the *response* that turns
    // out to be SSE (some upstreams stream by default regardless of the
    // request body), which is what the tee's disableTee path detects. A
    // request that declares stream:true up front is covered separately by
    // the "stream requests bypass the cache entirely" tests below.
    const req = makeReq('{"model":"claude-opus-5"}')
    const res = makeRes()
    await createCacheMiddleware()(req, res, vi.fn())
    expect(dedupSize()).toBe(1)

    // Upstream turns out to be SSE — the tee gives up on the first chunk.
    res.setHeader('content-type', 'text/event-stream')
    res.write('data: {"type":"ping"}\n\n')

    // Freed here, long before the stream ends.
    expect(await withTimeout(inflight, 200)).toBeNull()
    expect(dedupSize()).toBe(0)

    res.end()
  })

  it('resolves null and clears the entry when the connection drops', async () => {
    const req = makeReq('{"model":"claude-opus-5"}')
    const res = makeRes()
    await createCacheMiddleware()(req, res, vi.fn())

    res.emit('close')

    expect(await withTimeout(inflight, 200)).toBeNull()
    expect(dedupSize()).toBe(0)
  })
})
