import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'

let upstreamA, upstreamB, portA, portB
let proxyServer, proxyPort
let lastHitA, lastHitB

beforeAll(async () => {
  upstreamA = http.createServer((req, res) => {
    lastHitA = { url: req.url, method: req.method }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ which: 'A', url: req.url }))
  })
  upstreamA.listen(0)
  await once(upstreamA, 'listening')
  portA = upstreamA.address().port

  upstreamB = http.createServer((req, res) => {
    lastHitB = { url: req.url, method: req.method }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ which: 'B', url: req.url }))
  })
  upstreamB.listen(0)
  await once(upstreamB, 'listening')
  portB = upstreamB.address().port

  process.env.NODE_ENV = 'test'
  process.env.PROXY_TOKEN_TRACKING = 'false'
  process.env.COMPACTOR_ENABLED = 'false'
  process.env.GUARDRAILS_ENABLED = 'false'
  delete process.env.UPSTREAM_URL
  delete process.env.ROUTES_CONFIG_PATH
  process.env.PROXY_ROUTES = JSON.stringify({
    routes: [
      { prefix: '/proxy/a', upstream: `http://127.0.0.1:${portA}`, provider: 'generic' },
      { prefix: '/proxy/b', upstream: `http://127.0.0.1:${portB}`, provider: 'generic' },
    ],
  })

  const { _resetRoutes } = await import('../../src/routes/registry.js')
  _resetRoutes()
  const { createApp } = await import('../../src/server.js')
  const app = createApp()
  proxyServer = app.listen(0)
  await once(proxyServer, 'listening')
  proxyPort = proxyServer.address().port
})

afterAll(async () => {
  await new Promise((r) => proxyServer.close(r))
  await new Promise((r) => upstreamA.close(r))
  await new Promise((r) => upstreamB.close(r))
})

beforeEach(() => {
  lastHitA = null
  lastHitB = null
})

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

describe('multi-upstream routing', () => {
  it('routes /proxy/a/* to upstream A', async () => {
    const res = await get('/proxy/a/v1/messages')
    expect(res.status).toBe(200)
    expect(lastHitA).not.toBeNull()
    expect(lastHitB).toBeNull()
    const body = JSON.parse(res.body)
    expect(body.which).toBe('A')
  })

  it('routes /proxy/b/* to upstream B', async () => {
    const res = await get('/proxy/b/v1/messages')
    expect(res.status).toBe(200)
    expect(lastHitB).not.toBeNull()
    expect(lastHitA).toBeNull()
    const body = JSON.parse(res.body)
    expect(body.which).toBe('B')
  })

  it('exposes the route prefix on /api/metrics/recent', async () => {
    await get('/proxy/a/x')
    await get('/proxy/b/y')
    const sumRes = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: proxyPort, path: '/api/metrics/recent?limit=10' },
        (r) => {
          const chunks = []
          r.on('data', (c) => chunks.push(c))
          r.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
        },
      )
      req.end()
    })
    const routes = new Set(sumRes.map((e) => e.route))
    expect(routes.has('/proxy/a')).toBe(true)
    expect(routes.has('/proxy/b')).toBe(true)
  })
})
