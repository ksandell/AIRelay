import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'

// Spin a captured upstream that records the path it received, run the proxy
// with PROXY_PROVIDER=azure, and assert the api-version query param landed.
// The rewrite lives in src/proxy/proxy.js as a `req.url` mutation inside the
// proxy handler — before http-proxy serialises the ClientRequest path.

function makeRecordingUpstream() {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        id: 'chatcmpl-az',
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 5, completion_tokens: 3 },
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
    )
  })
  server.listen(0)
  return { server, seen }
}

function request({ port, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/proxy/openai/deployments/gpt-4o-mini/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': buf.length,
          ...headers,
        },
      },
      (res) => {
        let b = Buffer.alloc(0)
        res.on('data', (c) => {
          b = Buffer.concat([b, c])
        })
        res.on('end', () => resolve({ status: res.statusCode, body: b }))
      },
    )
    req.on('error', reject)
    req.write(buf)
    req.end()
  })
}

describe('azure adapter — proxy auto-appends api-version', () => {
  let upstream, seen, proxyServer, proxyPort

  beforeAll(async () => {
    const u = makeRecordingUpstream()
    upstream = u.server
    seen = u.seen
    await once(upstream, 'listening')
    const upPort = upstream.address().port

    vi.resetModules()
    process.env.UPSTREAM_URL = `http://127.0.0.1:${upPort}`
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.NODE_ENV = 'test'
    process.env.PROXY_TOKEN_TRACKING = 'true'
    process.env.PROXY_PROVIDER = 'azure'
    process.env.AZURE_OPENAI_API_VERSION = '2024-10-21'

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

  it('appends api-version when the request omits it', async () => {
    seen.length = 0
    const r = await request({ port: proxyPort, body: '{"model":"gpt-4o-mini"}' })
    expect(r.status).toBe(200)
    expect(seen.length).toBe(1)
    expect(seen[0].url).toContain('api-version=2024-10-21')
  })

  it('preserves a caller-supplied api-version (does not double-append)', async () => {
    seen.length = 0
    // Send the request to the proxy with api-version=2025-01-01 already set.
    const path = '/proxy/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01'
    const buf = Buffer.from('{"model":"gpt-4o-mini"}')
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'POST',
          path,
          headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length },
        },
        (res) => {
          res.on('data', () => {})
          res.on('end', resolve)
        },
      )
      req.on('error', reject)
      req.write(buf)
      req.end()
    })
    expect(seen.length).toBe(1)
    expect(seen[0].url).toContain('api-version=2025-01-01')
    expect(seen[0].url).not.toContain('api-version=2024-10-21')
    // single occurrence
    expect(seen[0].url.match(/api-version=/g)?.length).toBe(1)
  })

  it('forwards the caller-supplied api-key header to the upstream untouched', async () => {
    seen.length = 0
    await request({
      port: proxyPort,
      body: '{"model":"gpt-4o-mini"}',
      headers: { 'api-key': 'sekret-123' },
    })
    expect(seen[0].headers['api-key']).toBe('sekret-123')
  })
})

describe('azure adapter — hook is no-op when provider is not "azure"', () => {
  let upstream, seen, proxyServer, proxyPort

  beforeAll(async () => {
    const u = makeRecordingUpstream()
    upstream = u.server
    seen = u.seen
    await once(upstream, 'listening')
    const upPort = upstream.address().port

    vi.resetModules()
    process.env.UPSTREAM_URL = `http://127.0.0.1:${upPort}`
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.NODE_ENV = 'test'
    process.env.PROXY_TOKEN_TRACKING = 'true'
    process.env.PROXY_PROVIDER = 'openai'
    process.env.AZURE_OPENAI_API_VERSION = '2024-10-21'

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

  it('does not append api-version when PROXY_PROVIDER is "openai"', async () => {
    seen.length = 0
    await request({ port: proxyPort, body: '{"model":"gpt-4o-mini"}' })
    expect(seen.length).toBe(1)
    expect(seen[0].url).not.toContain('api-version=')
  })
})
