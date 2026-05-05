import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir
let app

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-opt-api-'))
  const { config } = await import('../../src/config.js')
  config.logDir = tmpDir

  fs.writeFileSync(
    path.join(tmpDir, 'app.log'),
    '{"ts":"2026-04-29T00:00:00.000Z","level":"info","msg":"test"}\n',
  )

  const { createApp } = await import('../../src/server.js')
  app = createApp()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.uptime).toBe('number')
    expect(typeof res.body.nextRotation).toBe('string')
  })
})

describe('GET /api/logs', () => {
  it('returns array of log entries', async () => {
    const res = await request(app).get('/api/logs')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].msg).toBe('test')
  })
})

describe('GET /api/logs/available', () => {
  it('returns active and rotated info', async () => {
    const res = await request(app).get('/api/logs/available')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('active')
    expect(Array.isArray(res.body.rotated)).toBe(true)
  })
})

describe('GET /api/logs/history', () => {
  it('returns 400 without date param', async () => {
    const res = await request(app).get('/api/logs/history')
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent date', async () => {
    const res = await request(app).get('/api/logs/history?date=2000-01-01')
    expect(res.status).toBe(404)
  })

  it('returns entries for existing rotated log', async () => {
    const date = '2026-04-28'
    fs.writeFileSync(
      path.join(tmpDir, `app-${date}.log`),
      '{"ts":"2026-04-28T00:00:00.000Z","level":"info","msg":"rotated"}\n',
    )
    const res = await request(app).get(`/api/logs/history?date=${date}`)
    expect(res.status).toBe(200)
    expect(res.body[0].msg).toBe('rotated')
  })
})
