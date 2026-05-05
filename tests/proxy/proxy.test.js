import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'

// Use a real upstream + a real proxy server, both ephemeral, to verify
// passthrough behavior end-to-end without buffering.

let upstream
let upstreamPort
let proxyServer
let proxyPort

beforeAll(async () => {
  // 1. Start upstream that echoes method/headers/body
  upstream = http.createServer((req, res) => {
    let body = Buffer.alloc(0)
    req.on('data', (c) => {
      body = Buffer.concat([body, c])
    })
    req.on('end', () => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('X-Upstream-Method', req.method)
      res.setHeader('X-Upstream-Path', req.url)
      res.setHeader('X-Upstream-Body-Len', String(body.length))
      res.setHeader('X-Upstream-Host', req.headers.host || '')
      res.end(body)
    })
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  upstreamPort = upstream.address().port

  // 2. Configure env BEFORE importing the proxy module (config is captured at import).
  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.NODE_ENV = 'test'
  process.env.MAX_METRIC_EVENTS = '1000'

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
  const { _reset } = await import('../../src/metrics/collector.js')
  _reset()
})

function request({ method = 'GET', path = '/proxy/', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, method, path, headers },
      (res) => {
        let buf = Buffer.alloc(0)
        res.on('data', (c) => {
          buf = Buffer.concat([buf, c])
        })
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }))
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

describe('proxy passthrough', () => {
  it('forwards GET to upstream with prefix stripped', async () => {
    const r = await request({ path: '/proxy/hello' })
    expect(r.status).toBe(200)
    expect(r.headers['x-upstream-path']).toBe('/hello')
    expect(r.headers['x-upstream-method']).toBe('GET')
  })

  it('returns the upstream body byte-for-byte', async () => {
    const payload = Buffer.from('the-quick-brown-fox-🦊'.repeat(100), 'utf8')
    const r = await request({
      method: 'POST',
      path: '/proxy/echo',
      body: payload,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length },
    })
    expect(r.status).toBe(200)
    expect(r.body.equals(payload)).toBe(true)
    expect(r.headers['x-upstream-body-len']).toBe(String(payload.length))
  })

  it('records a metric event for each proxied request', async () => {
    await request({ path: '/proxy/a' })
    await request({ path: '/proxy/b' })
    const { recent } = await import('../../src/metrics/collector.js')
    const events = recent(10)
    expect(events.length).toBe(2)
    expect(events[0].method).toBe('GET')
    expect(events[0].status).toBe(200)
    expect(events[0].path.startsWith('/proxy/')).toBe(true)
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rewrites Host header to upstream (changeOrigin)', async () => {
    const r = await request({ path: '/proxy/host-check' })
    expect(r.status).toBe(200)
    expect(r.headers['x-upstream-host']).toBe(`127.0.0.1:${upstreamPort}`)
  })

  it('handles concurrent requests without losing events', async () => {
    const N = 50
    await Promise.all(Array.from({ length: N }, (_, i) => request({ path: `/proxy/c${i}` })))
    const { recent } = await import('../../src/metrics/collector.js')
    const events = recent(N + 10)
    expect(events.length).toBe(N)
  })
})
