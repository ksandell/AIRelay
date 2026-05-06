import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'

async function buildApp() {
  const { requestLogger } = await import('../../src/middleware/requestLogger.js')
  const app = express()
  app.use(requestLogger)
  app.get('/hello', (_req, res) => res.json({ ok: true }))
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.get('/api/metrics/summary', (_req, res) => res.json({}))
  app.get('/api/logs/', (_req, res) => res.json([]))
  app.get('/api/logs', (_req, res) => res.json([]))
  return app
}

describe('requestLogger', () => {
  it('sets X-Request-Id header on response', async () => {
    const app = await buildApp()
    const res = await request(app).get('/hello')
    expect(res.headers['x-request-id']).toBeDefined()
    expect(typeof res.headers['x-request-id']).toBe('string')
  })

  it('echoes provided X-Request-Id', async () => {
    const app = await buildApp()
    const res = await request(app).get('/hello').set('x-request-id', 'my-id-42')
    expect(res.headers['x-request-id']).toBe('my-id-42')
  })

  it('does not set X-Request-Id on /health (skip path)', async () => {
    const app = await buildApp()
    const res = await request(app).get('/health')
    expect(res.headers['x-request-id']).toBeUndefined()
  })

  it('does not set X-Request-Id on /api/metrics/ paths', async () => {
    const app = await buildApp()
    const res = await request(app).get('/api/metrics/summary')
    expect(res.headers['x-request-id']).toBeUndefined()
  })

  it('does not set X-Request-Id on /api/logs/ paths (trailing slash)', async () => {
    const app = await buildApp()
    const res = await request(app).get('/api/logs/')
    expect(res.headers['x-request-id']).toBeUndefined()
  })

  // /api/logs (no trailing slash) does NOT match SKIP_PATHS '/api/logs/' prefix
  it('sets X-Request-Id on /api/logs (no trailing slash — not in skip list)', async () => {
    const app = await buildApp()
    const res = await request(app).get('/api/logs')
    expect(res.headers['x-request-id']).toBeDefined()
  })

  it('attaches requestId to req object', async () => {
    let capturedId
    const { requestLogger } = await import('../../src/middleware/requestLogger.js')
    const app = express()
    app.use(requestLogger)
    app.get('/check', (req, res) => {
      capturedId = req.requestId
      res.json({ id: req.requestId })
    })
    await request(app).get('/check')
    expect(capturedId).toBeDefined()
  })
})
