import { describe, it, expect, beforeEach } from 'vitest'
import { record, _reset } from '../../src/metrics/collector.js'
import { aggregate } from '../../src/metrics/aggregator.js'

function ev(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 10,
    bytesIn: 0,
    bytesOut: 0,
    upstream: 'http://up',
    error: null,
    provider: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    costUsd: null,
    ...overrides,
  }
}

describe('aggregator cost + token rollups', () => {
  beforeEach(() => _reset())

  it('sums costUsd and totalTokens across multiple events', () => {
    record(ev({ model: 'm1', provider: 'p', totalTokens: 100, costUsd: 0.001 }))
    record(ev({ model: 'm1', provider: 'p', totalTokens: 50, costUsd: 0.0025 }))
    record(ev({ model: 'm2', provider: 'q', totalTokens: 200, costUsd: 0.01 }))
    const a = aggregate(60)
    expect(a.totalTokens).toBe(350)
    expect(a.totalCostUsd).toBeCloseTo(0.0135, 6)
  })

  it('treats null/undefined cost and tokens as 0 (no NaN)', () => {
    record(ev({ status: 200 }))
    record(ev({ status: 200, totalTokens: undefined, costUsd: undefined }))
    record(ev({ status: 200, totalTokens: 10, costUsd: 0.005 }))
    const a = aggregate(60)
    expect(Number.isNaN(a.totalCostUsd)).toBe(false)
    expect(Number.isNaN(a.totalTokens)).toBe(false)
    expect(a.totalTokens).toBe(10)
    expect(a.totalCostUsd).toBeCloseTo(0.005, 6)
  })

  it('byModel groups events with correct per-model totals', () => {
    record(
      ev({
        model: 'claude-sonnet',
        provider: 'anthropic',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.003,
      }),
    )
    record(
      ev({
        model: 'claude-sonnet',
        provider: 'anthropic',
        inputTokens: 200,
        outputTokens: 80,
        costUsd: 0.006,
      }),
    )
    record(
      ev({
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 30,
        outputTokens: 10,
        costUsd: 0.001,
      }),
    )
    const a = aggregate(60)
    expect(a.byModel['claude-sonnet']).toEqual({
      provider: 'anthropic',
      requests: 2,
      inputTokens: 300,
      outputTokens: 130,
      costUsd: 0.009,
    })
    expect(a.byModel['gpt-4o']).toEqual({
      provider: 'openai',
      requests: 1,
      inputTokens: 30,
      outputTokens: 10,
      costUsd: 0.001,
    })
  })

  it('excludes model:null events from byModel but counts them in totals', () => {
    record(ev({ model: null, totalTokens: 25, costUsd: 0.002 }))
    record(ev({ model: 'm1', provider: 'p', totalTokens: 10, costUsd: 0.001 }))
    const a = aggregate(60)
    expect(Object.keys(a.byModel)).toEqual(['m1'])
    expect(a.totalTokens).toBe(35)
    expect(a.totalCostUsd).toBeCloseTo(0.003, 6)
  })

  it('tokensPerSec equals totalTokens / seconds', () => {
    record(ev({ model: 'm1', provider: 'p', totalTokens: 600 }))
    const a = aggregate(60)
    expect(a.tokensPerSec).toBeCloseTo(10, 3)
  })

  it('inputTokensPerSec equals totalInputTokens / seconds', () => {
    record(ev({ model: 'm1', provider: 'p', inputTokens: 600 }))
    const a = aggregate(60)
    expect(a.inputTokensPerSec).toBeCloseTo(10, 3)
  })

  it('outputTokensPerSec equals totalOutputTokens / seconds', () => {
    record(ev({ model: 'm1', provider: 'p', outputTokens: 600 }))
    const a = aggregate(60)
    expect(a.outputTokensPerSec).toBeCloseTo(10, 3)
  })

  it('empty buffer yields zeroed cost/token fields', () => {
    const a = aggregate(60)
    expect(a.totalCostUsd).toBe(0)
    expect(a.totalTokens).toBe(0)
    expect(a.tokensPerSec).toBe(0)
    expect(a.byModel).toEqual({})
  })
})
