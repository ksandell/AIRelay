import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir
let app
let collector

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-opt-mm-'))
  const { config } = await import('../../src/config.js')
  config.logDir = tmpDir

  collector = await import('../../src/metrics/collector.js')
  collector._reset()

  const { createApp } = await import('../../src/server.js')
  app = createApp()
})

afterEach(() => {
  collector._reset()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/metrics/models', () => {
  it('returns [] for empty buffer', async () => {
    const res = await request(app).get('/api/metrics/models')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('groups events by model and sorts by costUsd desc', async () => {
    collector.record({
      ts: new Date().toISOString(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.5,
    })
    collector.record({
      ts: new Date().toISOString(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 2000,
      outputTokens: 1000,
      costUsd: 1.0,
    })
    collector.record({
      ts: new Date().toISOString(),
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.1,
    })

    const res = await request(app).get('/api/metrics/models')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toEqual({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      requests: 2,
      inputTokens: 3000,
      outputTokens: 1500,
      costUsd: 1.5,
    })
    expect(res.body[1].model).toBe('gpt-4o')
    expect(res.body[1].requests).toBe(1)
  })

  it('excludes events with null model', async () => {
    collector.record({
      ts: new Date().toISOString(),
      provider: null,
      model: null,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.1,
    })
    collector.record({
      ts: new Date().toISOString(),
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.2,
    })

    const res = await request(app).get('/api/metrics/models')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].model).toBe('gpt-4o')
  })

  it('treats null tokens and costUsd as 0', async () => {
    collector.record({
      ts: new Date().toISOString(),
      provider: 'anthropic',
      model: 'claude-haiku',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    })
    collector.record({
      ts: new Date().toISOString(),
      provider: 'anthropic',
      model: 'claude-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.05,
    })

    const res = await request(app).get('/api/metrics/models')
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toEqual({
      model: 'claude-haiku',
      provider: 'anthropic',
      requests: 2,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.05,
    })
  })
})
