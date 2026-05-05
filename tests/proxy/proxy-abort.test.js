import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'

let upstream
let proxyServer
let proxyPort

beforeAll(async () => {
  // Upstream that hangs forever — simulates hung upstream for idle watchdog test.
  upstream = http.createServer((_req, _res) => {
    // intentionally never responds
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  const upstreamPort = upstream.address().port

  // Set config via env BEFORE importing the proxy module.
  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.NODE_ENV = 'test'
  process.env.MAX_METRIC_EVENTS = '1000'
  process.env.PROXY_REQUEST_IDLE_TIMEOUT_MS = '300' // 300 ms for fast tests

  const { createApp } = await import('../../src/server.js')
  const app = createApp()
  proxyServer = http.createServer(app)
  proxyServer.listen(0)
  await once(proxyServer, 'listening')
  proxyPort = proxyServer.address().port
})

afterAll(async () => {
  // closeAllConnections() forcibly destroys open sockets so .close() resolves promptly.
  if (proxyServer.closeAllConnections) proxyServer.closeAllConnections()
  if (upstream.closeAllConnections) upstream.closeAllConnections()
  await new Promise((r) => proxyServer.close(r))
  await new Promise((r) => upstream.close(r))
})

beforeEach(async () => {
  const { _reset } = await import('../../src/metrics/collector.js')
  _reset()
})

describe('idle watchdog (H1)', () => {
  it('records upstream_timeout after watchdog fires', async () => {
    // The watchdog destroys both req and res when the upstream hangs,
    // so the client receives a socket hang-up (not a 504 HTTP response).
    // We catch the error and verify the metric event was recorded.
    await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: proxyPort, method: 'POST', path: '/proxy/chat' },
        (res) => {
          res.resume()
          res.on('end', resolve)
          res.on('close', resolve)
        },
      )
      req.on('error', resolve) // socket hang up is expected
      req.end()
    })

    // Allow microtask + finalize to run
    await new Promise((r) => setTimeout(r, 50))

    const { recent } = await import('../../src/metrics/collector.js')
    const events = recent(10)
    const last = events[events.length - 1]
    expect(last?.error).toBe('upstream_timeout')
  }, 5000)
})

describe('client abort (smoke)', () => {
  it('does not crash when client closes socket before body is sent', async () => {
    const socket = net.createConnection({ host: '127.0.0.1', port: proxyPort })
    await once(socket, 'connect')

    socket.write(
      'POST /proxy/stream HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\n',
    )
    // Destroy before sending body — simulates client abort.
    await new Promise((r) => setTimeout(r, 30))
    socket.destroy()

    // Wait for server to process the disconnect
    await new Promise((r) => setTimeout(r, 200))

    // No crash = test passes
    expect(true).toBe(true)
  }, 3000)
})
