import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'

let upstream
let proxyServer
let proxyPort
let lastUpstreamBody = ''

function call(path, headers = {}, body = '{}') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'POST',
        path,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, data }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      lastUpstreamBody = b
      if (req.url.endsWith('/slow')) return setTimeout(() => res.end('{"ok":true}'), 700)
      if (req.url.endsWith('/drip')) {
        // sends a byte every 200 ms for 1 s — total > idle limit, never idle
        res.writeHead(200)
        const t = setInterval(() => res.write(' '), 200)
        return setTimeout(() => {
          clearInterval(t)
          res.end('{}')
        }, 1000)
      }
      res.end('{"ok":true}')
    })
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstream.address().port}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.PROXY_PROVIDER = 'mistral'
  process.env.PROXY_MAP_SEED = 'true'
  process.env.NODE_ENV = 'test'
  process.env.PROXY_REQUEST_IDLE_TIMEOUT_MS = '400'
  process.env.PROXY_REQUEST_MAX_TIMEOUT_MS = '5000'
  const { createApp } = await import('../../src/server.js')
  proxyServer = http.createServer(createApp())
  proxyServer.listen(0)
  await once(proxyServer, 'listening')
  proxyPort = proxyServer.address().port
})

afterAll(async () => {
  proxyServer.closeAllConnections?.()
  upstream.closeAllConnections?.()
  await new Promise((r) => proxyServer.close(r))
  await new Promise((r) => upstream.close(r))
})

describe('idle timeout', () => {
  it('answers 504 JSON (not an empty reply) when upstream stays silent', async () => {
    const r = await call('/proxy/slow')
    expect(r.status).toBe(504)
    expect(JSON.parse(r.data).code).toBe('upstream_timeout')
  })

  it('client X-AIRelay-Timeout-Ms raises the limit', async () => {
    const r = await call('/proxy/slow', { 'x-airelay-timeout-ms': '3000' })
    expect(r.status).toBe(200)
  })

  it('X-Stainless-Timeout (seconds) is honoured', async () => {
    const r = await call('/proxy/slow', { 'x-stainless-timeout': '3' })
    expect(r.status).toBe(200)
  })

  it('streamed data resets the timer', async () => {
    const r = await call('/proxy/drip')
    expect(r.status).toBe(200)
  })
})

describe('resolveTimeoutMs clamp', () => {
  it('clamps to max, floors at 1 s, ignores junk', async () => {
    const { resolveTimeoutMs } = await import('../../src/proxy/timeout.js')
    expect(resolveTimeoutMs({ 'x-airelay-timeout-ms': '999999999' })).toBe(5000)
    expect(resolveTimeoutMs({ 'x-airelay-timeout-ms': '5' })).toBe(1000)
    expect(resolveTimeoutMs({ 'x-airelay-timeout-ms': 'abc' })).toBe(400)
    expect(resolveTimeoutMs({ 'x-airelay-timeout-ms': '0' })).toBe(400)
    expect(resolveTimeoutMs({})).toBe(400)
  })
})

describe('mistral seed mapping (#194)', () => {
  it('renames seed to random_seed', async () => {
    await call('/proxy/v1/chat/completions', {}, '{"model":"m","seed":42}')
    expect(JSON.parse(lastUpstreamBody)).toEqual({ model: 'm', random_seed: 42 })
  })

  it('leaves bodies without seed untouched', async () => {
    const body = '{"model":"m",  "x":1}'
    await call('/proxy/v1/chat/completions', {}, body)
    expect(lastUpstreamBody).toBe(body)
  })

  it('keeps an explicit random_seed and drops seed', async () => {
    await call('/proxy/v1/chat/completions', {}, '{"seed":1,"random_seed":9}')
    expect(JSON.parse(lastUpstreamBody)).toEqual({ random_seed: 9 })
  })
})
