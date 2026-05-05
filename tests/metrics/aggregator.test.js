import { describe, it, expect, beforeEach } from 'vitest'
import { record, _reset } from '../../src/metrics/collector.js'
import { aggregate } from '../../src/metrics/aggregator.js'

function ev(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    method: 'GET',
    path: '/x',
    status: 200,
    durationMs: 10,
    bytesIn: 0,
    bytesOut: 0,
    upstream: 'http://up',
    error: null,
    ...overrides,
  }
}

describe('aggregator', () => {
  beforeEach(() => _reset())

  it('computes percentiles on a known distribution', () => {
    for (let i = 1; i <= 100; i++) record(ev({ durationMs: i }))
    const a = aggregate(60)
    expect(a.total).toBe(100)
    // floor(0.5*100)=50 → durations[50] = 51 (sorted ascending)
    expect(a.p50).toBe(51)
    expect(a.p95).toBe(96)
    expect(a.p99).toBe(100)
  })

  it('classifies status buckets and error rate', () => {
    record(ev({ status: 200 }))
    record(ev({ status: 201 }))
    record(ev({ status: 301 }))
    record(ev({ status: 404 }))
    record(ev({ status: 500 }))
    record(ev({ status: 502 }))
    const a = aggregate(60)
    expect(a.statusBuckets).toEqual({ '2xx': 2, '3xx': 1, '4xx': 1, '5xx': 2, other: 0 })
    expect(a.errorRate).toBeCloseTo(3 / 6, 4)
  })

  it('counts a transport error (status=0) as an error', () => {
    record(ev({ status: 0, error: 'ECONNREFUSED' }))
    record(ev({ status: 200 }))
    const a = aggregate(60)
    expect(a.errorRate).toBeCloseTo(0.5, 4)
  })

  it('rps reflects window size', () => {
    for (let i = 0; i < 60; i++) record(ev({ durationMs: 5 }))
    const a = aggregate(60)
    expect(a.rps).toBeCloseTo(1, 4)
  })

  it('returns zeros for empty buffer', () => {
    const a = aggregate(60)
    expect(a.total).toBe(0)
    expect(a.p50).toBe(0)
    expect(a.errorRate).toBe(0)
  })

  it('excludes events outside the window', () => {
    const now = Date.now()
    record(ev({ ts: new Date(now - 5_000).toISOString(), durationMs: 1 }))
    record(ev({ ts: new Date(now - 200_000).toISOString(), durationMs: 999 }))
    const a = aggregate(60)
    expect(a.total).toBe(1)
    expect(a.p95).toBe(1)
  })
})
