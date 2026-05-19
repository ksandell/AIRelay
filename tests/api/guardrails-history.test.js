import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let upstream, upstreamPort, proxyServer, proxyPort, dbPath, store

const WINDOWS = ['5m', '1h', '3h', '6h', '12h', '24h', '7d']
const WINDOW_SECONDS = {
  '5m': 5 * 60,
  '1h': 3600,
  '3h': 3 * 3600,
  '6h': 6 * 3600,
  '12h': 12 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
}

beforeAll(async () => {
  upstream = http.createServer((_, res) => {
    res.statusCode = 200
    res.end('{}')
  })
  upstream.listen(0)
  await once(upstream, 'listening')
  upstreamPort = upstream.address().port

  dbPath = path.join(os.tmpdir(), `airelay-guardrails-hist-${Date.now()}.db`)
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
  const day = 86_400_000
  const ages = [
    1 * minute,
    3 * minute,
    30 * minute,
    2 * 3600_000,
    5 * 3600_000,
    10 * 3600_000,
    20 * 3600_000,
    3 * day,
  ]
  let i = 0
  for (const ageMs of ages) {
    const action = i % 2 === 0 ? 'redact' : 'block'
    store.enqueue({
      ts: new Date(now - ageMs).toISOString(),
      method: 'POST',
      path: '/v1/messages',
      status: action === 'block' ? 422 : 200,
      durationMs: 5,
      bytesIn: 800,
      bytesOut: action === 'block' ? 0 : 700,
      upstream: 'http://upstream.test',
      route: '/proxy',
      error: action === 'block' ? 'guardrails_blocked' : null,
      guardrailsAction: action,
      guardrailsHits: 2,
      guardrailsDetectors: 'aws-key',
    })
    i++
  }
  // A clean / allow row that should not appear in history.
  store.enqueue({
    ts: new Date(now - minute).toISOString(),
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 5,
    bytesIn: 100,
    bytesOut: 100,
    upstream: 'http://upstream.test',
    route: '/proxy',
    error: null,
    guardrailsAction: 'allow',
    guardrailsHits: 0,
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

function rangeQS(windowKey) {
  const sec = WINDOW_SECONDS[windowKey]
  const to = new Date()
  const from = new Date(to.getTime() - sec * 1000)
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
}

describe('GET /api/guardrails/history', () => {
  it('excludes guardrailsAction=allow rows', async () => {
    const res = await get(`/api/guardrails/history?${rangeQS('7d')}`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.count).toBe(8)
    for (const ev of body.events) {
      expect(ev.guardrailsAction === 'allow').toBe(false)
    }
  })

  const expectedCounts = {
    '5m': 2,
    '1h': 3,
    '3h': 4,
    '6h': 5,
    '12h': 6,
    '24h': 7,
    '7d': 8,
  }
  for (const w of WINDOWS) {
    it(`returns ${expectedCounts[w]} events for window=${w}`, async () => {
      const res = await get(`/api/guardrails/history?${rangeQS(w)}`)
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.count).toBe(expectedCounts[w])
    })
  }
})

describe('GET /api/guardrails/rollups', () => {
  it('returns hourly buckets including block counts', async () => {
    const res = await get(`/api/guardrails/rollups?period=hour&${rangeQS('24h')}`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.period).toBe('hour')
    const totalBlocks = body.buckets.reduce((a, b) => a + b.guardrailsBlocks, 0)
    expect(totalBlocks).toBeGreaterThan(0)
  })

  it('rejects invalid period', async () => {
    const res = await get('/api/guardrails/rollups?period=fortnight')
    expect(res.status).toBe(400)
  })
})
