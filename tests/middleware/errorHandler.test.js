import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'

async function buildApp(err) {
  const { errorHandler } = await import('../../src/middleware/errorHandler.js')
  const app = express()
  app.get('/boom', (_req, _res, next) => next(err))
  app.use((error, req, res, next) => errorHandler(error, req, res, next))
  return app
}

describe('errorHandler', () => {
  it('returns 500 and generic message for unhandled errors', async () => {
    const app = await buildApp(new Error('secret internal detail'))
    const res = await request(app).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
    expect(res.body.error).not.toContain('secret')
  })

  it('returns err.status for client errors', async () => {
    const err = new Error('Not found')
    err.status = 404
    const app = await buildApp(err)
    const res = await request(app).get('/boom')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Not found')
  })

  it('uses err.statusCode as fallback', async () => {
    const err = new Error('Forbidden')
    err.statusCode = 403
    const app = await buildApp(err)
    const res = await request(app).get('/boom')
    expect(res.status).toBe(403)
  })

  it('does not expose internal error message on 500', async () => {
    const err = new Error('with id')
    const { errorHandler } = await import('../../src/middleware/errorHandler.js')
    const app = express()
    app.get('/boom', (req, _res, next) => {
      req.requestId = 'test-id-123'
      next(err)
    })
    app.use((error, req, res, next) => errorHandler(error, req, res, next))
    const res = await request(app).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
