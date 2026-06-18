import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let upstream, upstreamPort, proxyServer, proxyPort, dbPath, store

beforeAll(async () => {
  upstream = http.createServer((_, res) => {
    res.statusCode = 200
    res.end('{}')
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  upstreamPort = upstream.address().port

  dbPath = path.join(os.tmpdir(), `airelay-cache-hist-${Date.now()}.db`)
  process.env.NODE_ENV = 'test'
  process.env.PROXY_TOKEN_TRACKING = 'false'
  process.env.METRICS_DB_PATH = dbPath
  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.PROXY_PROVIDER = 'generic'
  delete process.env.PROXY_ROUTES
  delete process.env.ROUTES_CONFIG_PATH

  store = await import('../../src/metrics/store.js')
  await store.open(dbPath)
  const { _resetRoutes } = await import('../../src/routes/registry.js')
  _resetRoutes()
  const { createApp } = await import('../../src/server.js')
  const app = createApp()
  proxyServer = app.listen(0)
  await once(proxyServer, 'listening')
  proxyPort = proxyServer.address().port

  const now = Date.now()
  const minute = 60_000
  // 3 HITs, 2 MISSes, 1 DEDUP — all cache-tagged.
  const seed = [
    { cacheStatus: 'HIT', bytesFromCache: 500 },
    { cacheStatus: 'HIT', bytesFromCache: 400 },
    { cacheStatus: 'HIT', bytesFromCache: 300 },
    { cacheStatus: 'MISS' },
    { cacheStatus: 'MISS' },
    { cacheStatus: 'DEDUP', bytesFromCache: 200 },
  ]
  seed.forEach((s, i) => {
    store.enqueue({
      ts: new Date(now - (i + 1) * minute).toISOString(),
      method: 'POST',
      path: '/v1/messages',
      status: 200,
      durationMs: 5,
      bytesIn: 800,
      bytesOut: s.bytesFromCache ?? 0,
      upstream: null,
      route: '/proxy',
      error: null,
      cacheKeyPrefix: 'abc' + i,
      ...s,
    })
  })
  // A non-cache row that must NOT be returned by /api/cache/history.
  store.enqueue({
    ts: new Date(now - minute).toISOString(),
    method: 'GET',
    path: '/v1/x',
    status: 200,
    durationMs: 10,
    bytesIn: 0,
    bytesOut: 0,
    route: '/proxy',
    error: null,
  })
  store.flushSync()
})

afterAll(async () => {
  await new Promise((r) => proxyServer.close(r))
  await new Promise((r) => upstream.close(r))
  store.close()
  for (const ext of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + ext)
    } catch {
      // ignore
    }
  }
})

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, method: 'GET', path: p },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

const wide = () => {
  const to = new Date()
  const from = new Date(to.getTime() - 86400_000)
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
}

describe('GET /api/cache/history', () => {
  it('returns only cache-tagged rows', async () => {
    const res = await get(`/api/cache/history?${wide()}`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.count).toBe(6)
    for (const ev of body.events) {
      expect(['HIT', 'MISS', 'DEDUP']).toContain(ev.cacheStatus)
    }
  })

  it('filters by status=HIT', async () => {
    const res = await get(`/api/cache/history?status=HIT&${wide()}`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.count).toBe(3)
    for (const ev of body.events) expect(ev.cacheStatus).toBe('HIT')
  })

  it('rejects malformed from/to', async () => {
    const res = await get('/api/cache/history?from=garbage&to=also-garbage')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/cache/rollups', () => {
  it('returns buckets with cache aggregates', async () => {
    const res = await get(`/api/cache/rollups?period=minute&${wide()}`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.period).toBe('minute')
    expect(Array.isArray(body.buckets)).toBe(true)
    const totalHits = body.buckets.reduce((s, b) => s + b.cacheHits, 0)
    expect(totalHits).toBe(3)
  })

  it('rejects invalid period', async () => {
    const res = await get('/api/cache/rollups?period=fortnight')
    expect(res.status).toBe(400)
  })
})
