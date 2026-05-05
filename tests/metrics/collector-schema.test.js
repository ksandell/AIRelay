import { describe, it, expect, beforeEach } from 'vitest'
import { record, recent, iterRecent, _reset } from '../../src/metrics/collector.js'

function makeBaseEvent(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 42,
    bytesIn: 100,
    bytesOut: 500,
    upstream: 'https://api.anthropic.com',
    error: null,
    ...overrides,
  }
}

function makeTokenEvent(overrides = {}) {
  return makeBaseEvent({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    inputTokens: 1200,
    outputTokens: 350,
    cacheReadTokens: 800,
    cacheWriteTokens: 200,
    totalTokens: 2550,
    costUsd: 0.01275,
    ...overrides,
  })
}

describe('collector v0.2.0 schema (token & cost fields)', () => {
  beforeEach(() => _reset())

  it('preserves all 8 new nullable fields through record() -> recent()', () => {
    const ev = makeTokenEvent()
    record(ev)
    const [out] = recent(10)
    expect(out).toBe(ev) // identity — stored by reference
    expect(out.provider).toBe('anthropic')
    expect(out.model).toBe('claude-sonnet-4-5')
    expect(out.inputTokens).toBe(1200)
    expect(out.outputTokens).toBe(350)
    expect(out.cacheReadTokens).toBe(800)
    expect(out.cacheWriteTokens).toBe(200)
    expect(out.totalTokens).toBe(2550)
    expect(out.costUsd).toBeCloseTo(0.01275)
  })

  it('iterRecent yields events including new fields', () => {
    const ev = makeTokenEvent({ ts: new Date(Date.now() - 1000).toISOString() })
    record(ev)
    const got = [...iterRecent(60)]
    expect(got).toHaveLength(1)
    expect(got[0]).toBe(ev)
    expect(got[0].provider).toBe('anthropic')
    expect(got[0].costUsd).toBeCloseTo(0.01275)
  })

  it('accepts events with explicit null token/cost fields', () => {
    const ev = makeBaseEvent({
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      costUsd: null,
    })
    record(ev)
    const [out] = recent(1)
    expect(out.provider).toBeNull()
    expect(out.totalTokens).toBeNull()
    expect(out.costUsd).toBeNull()
  })

  it('backward compat: events without token/cost fields still work', () => {
    const ev = makeBaseEvent()
    record(ev)
    const [out] = recent(1)
    expect(out).toBe(ev)
    expect(out.provider).toBeUndefined()
    expect(out.costUsd).toBeUndefined()
    expect(out.status).toBe(200)
  })

  it('mixed events (with and without token data) coexist in ring buffer', () => {
    record(makeBaseEvent({ path: '/no-tokens' }))
    record(makeTokenEvent({ path: '/with-tokens' }))
    const out = recent(10)
    expect(out).toHaveLength(2)
    expect(out[0].path).toBe('/no-tokens')
    expect(out[0].provider).toBeUndefined()
    expect(out[1].path).toBe('/with-tokens')
    expect(out[1].provider).toBe('anthropic')
    expect(out[1].totalTokens).toBe(2550)
  })
})
