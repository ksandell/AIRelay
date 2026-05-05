import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'

// Each describe block sets env + resets modules so the proxy singleton picks up
// fresh config (provider singleton is captured at module load).

const ANTHROPIC_BODY = JSON.stringify({
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{ type: 'text', text: 'hi' }],
  usage: {
    input_tokens: 42,
    output_tokens: 17,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 3,
  },
})

function makeUpstream(handler) {
  const server = http.createServer(handler)
  server.listen(0)
  return server
}

function request({ port, method = 'POST', path = '/proxy/v1/messages', body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {},
      },
      (res) => {
        let buf = Buffer.alloc(0)
        res.on('data', (c) => {
          buf = Buffer.concat([buf, c])
        })
        res.on('end', () => resolve({ status: res.statusCode, body: buf }))
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function waitForEvent(recent, predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = recent(50)
    const match = events.find(predicate)
    if (match) return match
    await new Promise((r) => setTimeout(r, 10))
  }
  return null
}

describe('proxy token tracking — enabled with anthropic provider', () => {
  let upstream, proxyServer, proxyPort

  beforeAll(async () => {
    upstream = makeUpstream((req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(ANTHROPIC_BODY)
    })
    await once(upstream, 'listening')
    const upPort = upstream.address().port

    vi.resetModules()
    process.env.UPSTREAM_URL = `http://127.0.0.1:${upPort}`
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.NODE_ENV = 'test'
    process.env.MAX_METRIC_EVENTS = '1000'
    process.env.PROXY_TOKEN_TRACKING = 'true'
    process.env.PROXY_PROVIDER = 'anthropic'

    const { createApp } = await import('../../src/server.js')
    const app = createApp()
    proxyServer = app.listen(0)
    await once(proxyServer, 'listening')
    proxyPort = proxyServer.address().port

    const { _reset } = await import('../../src/metrics/collector.js')
    _reset()
  })

  afterAll(async () => {
    await new Promise((r) => proxyServer.close(r))
    await new Promise((r) => upstream.close(r))
  })

  it('extracts tokens, model, and cost into the recorded metric event', async () => {
    const r = await request({ port: proxyPort, body: '{"model":"claude-sonnet-4-5"}' })
    expect(r.status).toBe(200)

    const { recent } = await import('../../src/metrics/collector.js')
    const ev = await waitForEvent(recent, (e) => e.model === 'claude-sonnet-4-5')
    expect(ev).not.toBeNull()
    expect(ev.provider).toBe('anthropic')
    expect(ev.inputTokens).toBe(42)
    expect(ev.outputTokens).toBe(17)
    expect(ev.cacheReadTokens).toBe(5)
    expect(ev.cacheWriteTokens).toBe(3)
    expect(ev.totalTokens).toBe(59)
    // costUsd may be null if pricing config has no entry for this model — that's fine.
    expect(ev.costUsd === null || typeof ev.costUsd === 'number').toBe(true)
  })

  it('returns the upstream body byte-for-byte to the client', async () => {
    const r = await request({ port: proxyPort, body: '{}' })
    expect(r.status).toBe(200)
    expect(r.body.toString('utf8')).toBe(ANTHROPIC_BODY)
  })
})

describe('proxy token tracking — disabled', () => {
  let upstream, proxyServer, proxyPort

  beforeAll(async () => {
    upstream = makeUpstream((req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(ANTHROPIC_BODY)
    })
    await once(upstream, 'listening')
    const upPort = upstream.address().port

    vi.resetModules()
    process.env.UPSTREAM_URL = `http://127.0.0.1:${upPort}`
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.NODE_ENV = 'test'
    process.env.MAX_METRIC_EVENTS = '1000'
    process.env.PROXY_TOKEN_TRACKING = 'false'
    process.env.PROXY_PROVIDER = 'anthropic'

    const { createApp } = await import('../../src/server.js')
    const app = createApp()
    proxyServer = app.listen(0)
    await once(proxyServer, 'listening')
    proxyPort = proxyServer.address().port

    const { _reset } = await import('../../src/metrics/collector.js')
    _reset()
  })

  afterAll(async () => {
    await new Promise((r) => proxyServer.close(r))
    await new Promise((r) => upstream.close(r))
    delete process.env.PROXY_TOKEN_TRACKING
  })

  it('records events with null token fields and no chunks collected', async () => {
    const r = await request({ port: proxyPort, body: '{}' })
    expect(r.status).toBe(200)
    expect(r.body.toString('utf8')).toBe(ANTHROPIC_BODY)

    const { recent } = await import('../../src/metrics/collector.js')
    // synchronous record path — no microtask delay needed
    const events = recent(10)
    expect(events.length).toBeGreaterThan(0)
    const ev = events[events.length - 1]
    expect(ev.provider).toBeNull()
    expect(ev.model).toBeNull()
    expect(ev.inputTokens).toBeNull()
    expect(ev.outputTokens).toBeNull()
    expect(ev.totalTokens).toBeNull()
    expect(ev.costUsd).toBeNull()
  })
})

describe('proxy token tracking — 4xx response skips extraction', () => {
  let upstream, proxyServer, proxyPort

  beforeAll(async () => {
    upstream = makeUpstream((req, res) => {
      res.statusCode = 429
      res.setHeader('Content-Type', 'application/json')
      res.end('{"error":"rate_limited"}')
    })
    await once(upstream, 'listening')
    const upPort = upstream.address().port

    vi.resetModules()
    process.env.UPSTREAM_URL = `http://127.0.0.1:${upPort}`
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.NODE_ENV = 'test'
    process.env.MAX_METRIC_EVENTS = '1000'
    process.env.PROXY_TOKEN_TRACKING = 'true'
    process.env.PROXY_PROVIDER = 'anthropic'

    const { createApp } = await import('../../src/server.js')
    const app = createApp()
    proxyServer = app.listen(0)
    await once(proxyServer, 'listening')
    proxyPort = proxyServer.address().port

    const { _reset } = await import('../../src/metrics/collector.js')
    _reset()

    // Spy on extractTokens — must NOT be called for 4xx.
    const { loadProvider } = await import('../../src/providers/registry.js')
    const provider = loadProvider('anthropic', null)
    provider.extractTokens = vi.fn(() => {
      throw new Error('should not be called for 4xx')
    })
  })

  afterAll(async () => {
    await new Promise((r) => proxyServer.close(r))
    await new Promise((r) => upstream.close(r))
  })

  it('does not attempt extraction on 4xx; records base event with model:null', async () => {
    const r = await request({ port: proxyPort, body: '{}' })
    expect(r.status).toBe(429)

    const { recent } = await import('../../src/metrics/collector.js')
    const ev = await waitForEvent(recent, (e) => e.status === 429)
    expect(ev).not.toBeNull()
    expect(ev.model).toBeNull()
    expect(ev.inputTokens).toBeNull()
    expect(ev.outputTokens).toBeNull()
    expect(ev.totalTokens).toBeNull()
    expect(ev.costUsd).toBeNull()
    expect(ev.bytesOut).toBeGreaterThan(0)
  })
})

describe('proxy token tracking — body exceeding tee cap', () => {
  let upstream, proxyServer, proxyPort
  const BIG = 'x'.repeat(200_000)

  beforeAll(async () => {
    upstream = makeUpstream((req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ filler: BIG, usage: { input_tokens: 1, output_tokens: 1 } }))
    })
    await once(upstream, 'listening')
    const upPort = upstream.address().port

    vi.resetModules()
    process.env.UPSTREAM_URL = `http://127.0.0.1:${upPort}`
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.NODE_ENV = 'test'
    process.env.MAX_METRIC_EVENTS = '1000'
    process.env.PROXY_TOKEN_TRACKING = 'true'
    process.env.PROXY_PROVIDER = 'anthropic'
    // Force a tiny cap so the response trivially exceeds it.
    process.env.PROXY_TOKEN_TEE_MAX_BYTES = '1024'

    const { createApp } = await import('../../src/server.js')
    const app = createApp()
    proxyServer = app.listen(0)
    await once(proxyServer, 'listening')
    proxyPort = proxyServer.address().port

    const { _reset } = await import('../../src/metrics/collector.js')
    _reset()
  })

  afterAll(async () => {
    await new Promise((r) => proxyServer.close(r))
    await new Promise((r) => upstream.close(r))
    delete process.env.PROXY_TOKEN_TEE_MAX_BYTES
  })

  it('skips extraction when body exceeds cap; records base event with model:null', async () => {
    const r = await request({ port: proxyPort, body: '{}' })
    expect(r.status).toBe(200)
    // Client still receives full body byte-for-byte.
    expect(r.body.length).toBeGreaterThan(200_000)

    const { recent } = await import('../../src/metrics/collector.js')
    const ev = await waitForEvent(recent, (e) => e.status === 200 && e.bytesOut > 100_000)
    expect(ev).not.toBeNull()
    expect(ev.model).toBeNull()
    expect(ev.inputTokens).toBeNull()
    expect(ev.outputTokens).toBeNull()
    expect(ev.totalTokens).toBeNull()
    expect(ev.costUsd).toBeNull()
  })
})

describe('proxy token tracking — provider failure isolation', () => {
  let upstream, proxyServer, proxyPort

  beforeAll(async () => {
    upstream = makeUpstream((req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end('{"not":"valid-anthropic-shape"}')
    })
    await once(upstream, 'listening')
    const upPort = upstream.address().port

    vi.resetModules()
    process.env.UPSTREAM_URL = `http://127.0.0.1:${upPort}`
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.NODE_ENV = 'test'
    process.env.MAX_METRIC_EVENTS = '1000'
    process.env.PROXY_TOKEN_TRACKING = 'true'
    process.env.PROXY_PROVIDER = 'anthropic'

    const { createApp } = await import('../../src/server.js')
    const app = createApp()
    proxyServer = app.listen(0)
    await once(proxyServer, 'listening')
    proxyPort = proxyServer.address().port

    // Monkey-patch provider to throw — verifies try/catch around extraction.
    const { loadProvider } = await import('../../src/providers/registry.js')
    const provider = loadProvider('anthropic', null)
    provider.extractTokens = () => {
      throw new Error('boom')
    }

    const { _reset } = await import('../../src/metrics/collector.js')
    _reset()
  })

  afterAll(async () => {
    await new Promise((r) => proxyServer.close(r))
    await new Promise((r) => upstream.close(r))
  })

  it('records the base event without crashing or affecting the client response', async () => {
    const r = await request({ port: proxyPort, body: '{}' })
    expect(r.status).toBe(200)
    expect(r.body.toString('utf8')).toBe('{"not":"valid-anthropic-shape"}')

    const { recent } = await import('../../src/metrics/collector.js')
    const ev = await waitForEvent(recent, (e) => e.status === 200)
    expect(ev).not.toBeNull()
    expect(ev.model).toBeNull()
    expect(ev.inputTokens).toBeNull()
    expect(ev.costUsd).toBeNull()
    // base fields populated
    expect(ev.bytesOut).toBeGreaterThan(0)
    expect(ev.durationMs).toBeGreaterThanOrEqual(0)
  })
})
