import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'

// AI providers stream responses heavily (Anthropic SSE, OpenAI SSE, etc.).
// The proxy MUST forward chunks as they arrive — no buffering of the whole
// response, no waiting for upstream end-of-body. This test verifies that
// behavior with a synthetic SSE-style upstream.

let upstream
let upstreamPort
let proxyServer
let proxyPort

beforeAll(async () => {
  // Upstream that emits N chunks with measurable spacing.
  upstream = http.createServer((req, res) => {
    if (req.url === '/stream') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      // No Content-Length — chunked transfer encoding kicks in.
      let i = 0
      const tick = () => {
        if (i < 5) {
          res.write(`data: chunk-${i}\n\n`)
          i++
          setTimeout(tick, 30)
        } else {
          res.end('data: done\n\n')
        }
      }
      tick()
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  upstreamPort = upstream.address().port

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

describe('proxy streaming passthrough', () => {
  it('forwards chunked responses incrementally (no buffering)', async () => {
    const chunks = []
    const arrivals = []
    const start = Date.now()

    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: proxyPort, method: 'GET', path: '/proxy/stream' },
        (res) => {
          res.on('data', (chunk) => {
            chunks.push(chunk)
            arrivals.push(Date.now() - start)
          })
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
          )
        },
      )
      req.on('error', reject)
      req.end()
    })

    expect(result.status).toBe(200)
    // Content-Type preserved — proxy didn't rewrite it.
    expect(result.headers['content-type']).toMatch(/text\/event-stream/)
    // We should see multiple data events arrive at distinct times, not all at once.
    // Upstream emits 5 chunks at ~30ms apart, so arrivals should span ≥60ms.
    expect(arrivals.length).toBeGreaterThanOrEqual(2)
    const span = arrivals[arrivals.length - 1] - arrivals[0]
    expect(span).toBeGreaterThanOrEqual(50)
    // Body integrity — every chunk landed.
    const body = result.body.toString('utf8')
    for (let i = 0; i < 5; i++) {
      expect(body).toContain(`data: chunk-${i}`)
    }
    expect(body).toContain('data: done')
  }, 5000)

  it('forwards transfer-encoding: chunked semantics', async () => {
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: proxyPort, method: 'GET', path: '/proxy/stream' },
        (res) => {
          let buf = Buffer.alloc(0)
          res.on('data', (c) => { buf = Buffer.concat([buf, c]) })
          res.on('end', () => resolve({ headers: res.headers, body: buf }))
        },
      )
      req.on('error', reject)
      req.end()
    })

    // Either transfer-encoding: chunked OR no content-length — both signal
    // that the body length wasn't known up front (i.e. not buffered).
    const te = result.headers['transfer-encoding']
    const cl = result.headers['content-length']
    expect(te === 'chunked' || cl === undefined).toBe(true)
  }, 5000)
})
