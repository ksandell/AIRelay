import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir
let app

beforeEach(async () => {
  vi.resetModules()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airelay-settings-'))

  const { loadOverrides } = await import('../../src/config.js')
  await loadOverrides(path.join(tmpDir, 'settings.json'))

  const { createApp } = await import('../../src/server.js')
  app = createApp()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.resetModules()
})

describe('GET /api/settings', () => {
  it('returns 200 with effective, overrides, defaults', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('effective')
    expect(res.body).toHaveProperty('overrides')
    expect(res.body).toHaveProperty('defaults')
  })

  it('effective.compactorEnabled matches config value', async () => {
    const res = await request(app).get('/api/settings')
    expect(typeof res.body.effective.compactorEnabled).toBe('boolean')
  })
})

describe('POST /api/settings', () => {
  it('returns 200 with new effective config on valid patch', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ compactorEnabled: true })
    expect(res.status).toBe(200)
    expect(res.body.effective.compactorEnabled).toBe(true)
  })

  it('persists: subsequent GET reflects posted value', async () => {
    await request(app).post('/api/settings').send({ guardrailsEnabled: true })
    const res = await request(app).get('/api/settings')
    expect(res.body.effective.guardrailsEnabled).toBe(true)
    expect(res.body.overrides.guardrailsEnabled).toBe(true)
  })

  it('returns 400 for unknown key', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ nonExistentKey: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown setting key/i)
  })

  it('returns 400 for wrong value type — boolean field gets string', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ compactorEnabled: 'yes' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid value/i)
  })

  it('returns 400 for bad guardrails mode value', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ guardrailsSecretsMode: 'banana' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid value/i)
  })

  it('returns 200 for valid guardrails mode', async () => {
    const res = await request(app)
      .post('/api/settings')
      .send({ guardrailsSecretsMode: 'alert' })
    expect(res.status).toBe(200)
    expect(res.body.effective.guardrailsSecretsMode).toBe('alert')
  })
})
