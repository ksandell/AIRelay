import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'

let upstream
let upstreamPort
let proxyServer
let proxyPort
let lastUpstream

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let body = Buffer.alloc(0)
    req.on('data', (c) => {
      body = Buffer.concat([body, c])
    })
    req.on('end', () => {
      lastUpstream = {
        method: req.method,
        url: req.url,
        bodyLen: body.length,
        body: body.toString('utf8'),
        // Compactor must strip its own header before forwarding
        compactorHeader: req.headers['x-compactor'] ?? null,
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  upstreamPort = upstream.address().port

  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.NODE_ENV = 'test'
  process.env.MAX_METRIC_EVENTS = '1000'
  process.env.PROXY_PROVIDER = 'anthropic'
  process.env.COMPACTOR_ENABLED = 'true'
  process.env.PROXY_TOKEN_TRACKING = 'false'

  const { createApp } = await import('../../src/server.js')
  const app = createApp()
  proxyServer = app.listen(0)
  await once(proxyServer, 'listening')
  proxyPort = proxyServer.address().port
})

afterAll(async () => {
  await new Promise((r) => proxyServer.close(r))
  await new Promise((r) => upstream.close(r))
})

beforeEach(async () => {
  lastUpstream = null
  const { _reset } = await import('../../src/metrics/collector.js')
  _reset()
  const { _resetCompactorMetrics } = await import('../../src/compactor/metrics.js')
  _resetCompactorMetrics()
})

function post(path, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'POST',
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function bloatedBody() {
  const ESC = String.fromCharCode(27)
  return {
    model: 'claude-x',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content:
              `${ESC}[31merror${ESC}[0m\n` +
              'a\n\n\n\n\n\nb\n' +
              'npm WARN deprecated foo@1\n'.repeat(20) +
              'real output\n',
          },
        ],
      },
    ],
  }
}

describe('Compactor E2E', () => {
  it('mutates body when no opt-out header is sent', async () => {
    const res = await post('/proxy/v1/messages', bloatedBody())
    expect(res.status).toBe(200)
    expect(lastUpstream).not.toBeNull()
    expect(lastUpstream.body).toContain('[compactor:')
    expect(lastUpstream.body).not.toContain('npm WARN deprecated')
    expect(res.headers['x-compactor-applied']).toBeDefined()
  })

  it('respects X-Compactor: off (byte-identical passthrough)', async () => {
    const body = bloatedBody()
    const originalJson = JSON.stringify(body)
    const res = await post('/proxy/v1/messages', body, { 'X-Compactor': 'off' })
    expect(res.status).toBe(200)
    expect(lastUpstream.body).toBe(originalJson)
    expect(lastUpstream.body).not.toContain('[compactor:')
  })

  it('bypasses streaming requests with a banner header', async () => {
    const body = { ...bloatedBody(), stream: true }
    const res = await post('/proxy/v1/messages', body)
    expect(res.status).toBe(200)
    expect(res.headers['x-compactor-applied']).toBe('bypass-streaming')
    expect(lastUpstream.body).toContain('npm WARN deprecated')
  })

  it('records lifetime metrics when compression runs', async () => {
    await post('/proxy/v1/messages', bloatedBody())
    const { lifetimeSnapshot } = await import('../../src/compactor/metrics.js')
    const snap = lifetimeSnapshot()
    expect(snap.requestsCompressed).toBeGreaterThan(0)
    expect(snap.bytesSaved).toBeGreaterThan(0)
    expect(Object.keys(snap.byCompressor).length).toBeGreaterThan(0)
  })

  it('exposes /api/compactor/summary', async () => {
    await post('/proxy/v1/messages', bloatedBody())
    const sumRes = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: proxyPort, path: '/api/compactor/summary' },
        (r) => {
          const chunks = []
          r.on('data', (c) => chunks.push(c))
          r.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
        },
      )
      req.end()
    })
    expect(sumRes.enabled).toBe(true)
    expect(sumRes.compressors.all.length).toBe(10)
    expect(sumRes.windows['1m']).toBeDefined()
    expect(sumRes.lifetime.requestsCompressed).toBeGreaterThan(0)
  })
})
