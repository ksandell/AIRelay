import { describe, it, expect, beforeEach } from 'vitest'
import { record, recent, iterRecent, snapshot, _reset, incInFlight, decInFlight, getInFlight } from '../../src/metrics/collector.js'

function makeEvent(overrides = {}) {
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

describe('collector', () => {
  beforeEach(() => _reset())

  it('records and reads back recent events in chronological order', () => {
    for (let i = 0; i < 5; i++) record(makeEvent({ path: `/p${i}` }))
    const out = recent(10)
    expect(out.map((e) => e.path)).toEqual(['/p0', '/p1', '/p2', '/p3', '/p4'])
  })

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) record(makeEvent({ path: `/p${i}` }))
    const out = recent(3)
    expect(out.map((e) => e.path)).toEqual(['/p7', '/p8', '/p9'])
  })

  it('iterRecent yields newest-first within window', () => {
    const now = Date.now()
    record(makeEvent({ ts: new Date(now - 120_000).toISOString(), path: '/old' }))
    record(makeEvent({ ts: new Date(now - 5_000).toISOString(), path: '/recent1' }))
    record(makeEvent({ ts: new Date(now - 1_000).toISOString(), path: '/recent2' }))
    const got = [...iterRecent(60)].map((e) => e.path)
    expect(got).toEqual(['/recent2', '/recent1'])
  })

  it('tracks in-flight count', () => {
    expect(getInFlight()).toBe(0)
    incInFlight(); incInFlight()
    expect(getInFlight()).toBe(2)
    decInFlight()
    expect(getInFlight()).toBe(1)
    decInFlight(); decInFlight() // should not go negative
    expect(getInFlight()).toBe(0)
  })

  it('snapshot reports count and capacity', () => {
    record(makeEvent())
    record(makeEvent())
    const s = snapshot()
    expect(s.count).toBe(2)
    expect(s.capacity).toBeGreaterThan(0)
  })
})
