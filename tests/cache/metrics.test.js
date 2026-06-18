import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordCacheEvent,
  lifetimeSnapshot,
  window1mSnapshot,
  iterRecent,
  _resetCacheMetrics,
} from '../../src/cache/metrics.js'

beforeEach(() => _resetCacheMetrics())

describe('recordCacheEvent + lifetimeSnapshot', () => {
  it('counts exact hits', () => {
    recordCacheEvent({ ts: new Date().toISOString(), type: 'HIT', bytes: 512 })
    const s = lifetimeSnapshot()
    expect(s.exactHits).toBe(1)
    expect(s.exactMisses).toBe(0)
    expect(s.bytesFromCache).toBe(512)
  })

  it('counts exact misses', () => {
    recordCacheEvent({ ts: new Date().toISOString(), type: 'MISS' })
    expect(lifetimeSnapshot().exactMisses).toBe(1)
  })

  it('counts dedup coalesced', () => {
    recordCacheEvent({ ts: new Date().toISOString(), type: 'DEDUP' })
    expect(lifetimeSnapshot().dedupCoalesced).toBe(1)
  })

  it('counts spend rejected', () => {
    recordCacheEvent({ ts: new Date().toISOString(), type: 'SPEND-REJECT' })
    expect(lifetimeSnapshot().spendRejected).toBe(1)
  })

  it('calculates hitRate correctly', () => {
    recordCacheEvent({ ts: new Date().toISOString(), type: 'HIT', bytes: 0 })
    recordCacheEvent({ ts: new Date().toISOString(), type: 'HIT', bytes: 0 })
    recordCacheEvent({ ts: new Date().toISOString(), type: 'MISS' })
    const s = lifetimeSnapshot()
    expect(s.hitRate).toBeCloseTo(2 / 3)
  })

  it('hitRate is 0 with no events', () => {
    expect(lifetimeSnapshot().hitRate).toBe(0)
  })
})

describe('window1mSnapshot', () => {
  it('reflects recent events', () => {
    recordCacheEvent({ ts: new Date().toISOString(), type: 'HIT', bytes: 100 })
    expect(window1mSnapshot().exactHits).toBe(1)
  })
})

describe('iterRecent', () => {
  it('yields last N events in reverse order', () => {
    recordCacheEvent({ ts: new Date().toISOString(), type: 'HIT', bytes: 1 })
    recordCacheEvent({ ts: new Date().toISOString(), type: 'MISS' })
    const events = [...iterRecent(5)]
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('MISS') // most recent first
  })
})
