import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let upstream, upstreamPort, proxyServer, proxyPort, dbPath

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  upstreamPort = upstream.address().port

  dbPath = path.join(os.tmpdir(), `airelay-history-${Date.now()}.db`)

  process.env.NODE_ENV = 'test'
  process.env.PROXY_TOKEN_TRACKING = 'false'
  process.env.COMPACTOR_ENABLED = 'false'
  process.env.GUARDRAILS_ENABLED = 'false'
  process.env.METRICS_DB_PATH = dbPath
  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.PROXY_PROVIDER = 'generic'
  delete process.env.PROXY_ROUTES
  delete process.env.ROUTES_CONFIG_PATH

  const { open: openStore } = await import('../../src/metrics/store.js')
  await openStore(dbPath)
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
  await new Promise((r) => upstream.close(r))
  const { close } = await import('../../src/metrics/store.js')
  close()
  for (const ext of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + ext)
    } catch {
      // ignore
    }
  }
})

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

describe('GET /api/metrics/history', () => {
  it('persists proxied requests to SQLite and returns them by range', async () => {
    await get('/proxy/v1/x')
    await get('/proxy/v1/y')
    // Flush is async; force it via the public store API to make the test deterministic.
    const { flushSync } = await import('../../src/metrics/store.js')
    flushSync()

    const res = await get(
      '/api/metrics/history?from=1970-01-01T00:00:00.000Z&to=2099-01-01T00:00:00.000Z',
    )
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.count).toBeGreaterThanOrEqual(2)
    expect(body.events[0].route).toBe('/proxy')
  })

  it('rejects malformed from/to', async () => {
    const res = await get('/api/metrics/history?from=garbage&to=also-garbage')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/metrics/rollups', () => {
  it('returns per-day buckets', async () => {
    await get('/proxy/v1/z')
    const { flushSync } = await import('../../src/metrics/store.js')
    flushSync()
    const res = await get(
      '/api/metrics/rollups?period=day&from=1970-01-01T00:00:00.000Z&to=2099-01-01T00:00:00.000Z',
    )
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.period).toBe('day')
    expect(body.buckets.length).toBeGreaterThan(0)
    expect(body.buckets[0].requests).toBeGreaterThan(0)
  })

  it('rejects invalid period', async () => {
    const res = await get('/api/metrics/rollups?period=fortnight')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/metrics/export.csv', () => {
  it('returns a CSV with the canonical column header', async () => {
    await get('/proxy/v1/csv')
    const { flushSync } = await import('../../src/metrics/store.js')
    flushSync()
    const res = await get(
      '/api/metrics/export.csv?from=1970-01-01T00:00:00.000Z&to=2099-01-01T00:00:00.000Z',
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    const [header, ...rows] = res.body.trim().split('\n')
    expect(header).toContain('ts')
    expect(header).toContain('route')
    expect(header).toContain('costUsd')
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('GET /api/metrics/routes', () => {
  it('lists the active routes', async () => {
    const res = await get('/api/metrics/routes')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].prefix).toBe('/proxy')
  })
})
