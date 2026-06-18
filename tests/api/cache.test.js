import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'

let app

beforeEach(async () => {
  vi.resetModules()
  const { loadOverrides } = await import('../../src/config.js')
  await loadOverrides('/nonexistent/settings.json')
  const { createApp } = await import('../../src/server.js')
  app = createApp()
})

afterEach(() => {
  vi.resetModules()
})

describe('GET /api/cache/summary', () => {
  it('returns 200 with expected shape', async () => {
    const res = await request(app).get('/api/cache/summary')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      enabled: false,
      connected: false,
      exactMatch: { enabled: expect.any(Boolean) },
      dedup: { enabled: expect.any(Boolean) },
      spend: { enabled: expect.any(Boolean) },
      fanout: { enabled: expect.any(Boolean) },
      window_1m: expect.any(Object),
      lifetime: expect.any(Object),
    })
  })

  it('lifetime has hitRate field', async () => {
    const res = await request(app).get('/api/cache/summary')
    expect(typeof res.body.lifetime.hitRate).toBe('number')
  })
})

describe('GET /api/cache/recent', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/cache/recent')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('POST /api/settings — cache keys', () => {
  it('accepts cacheEnabled boolean', async () => {
    const res = await request(app).post('/api/settings').send({ cacheEnabled: true })
    expect(res.status).toBe(200)
    expect(res.body.effective.cacheEnabled).toBe(true)
  })

  it('accepts cacheExactTtlSeconds integer', async () => {
    const res = await request(app).post('/api/settings').send({ cacheExactTtlSeconds: 7200 })
    expect(res.status).toBe(200)
    expect(res.body.effective.cacheExactTtlSeconds).toBe(7200)
  })

  it('rejects cacheExactTtlSeconds float', async () => {
    const res = await request(app).post('/api/settings').send({ cacheExactTtlSeconds: 1.5 })
    expect(res.status).toBe(400)
  })

  it('accepts cacheSpendDailyLimitUsd number', async () => {
    const res = await request(app).post('/api/settings').send({ cacheSpendDailyLimitUsd: 5.0 })
    expect(res.status).toBe(200)
  })

  it('accepts null for cacheSpendDailyLimitUsd', async () => {
    const res = await request(app).post('/api/settings').send({ cacheSpendDailyLimitUsd: null })
    expect(res.status).toBe(200)
  })
})
