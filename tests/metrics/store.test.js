import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let store
let dbPath

beforeEach(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `airelay-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  store = await import('../../src/metrics/store.js')
  await store.open(dbPath)
})

afterEach(() => {
  store.close()
  for (const ext of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + ext)
    } catch {
      // ignore
    }
  }
})

function makeEvent(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 123,
    bytesIn: 500,
    bytesOut: 1500,
    upstream: 'https://api.example.com',
    route: '/proxy/x',
    error: null,
    provider: 'mistral',
    model: 'mistral-small',
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: 300,
    costUsd: 0.0015,
    toolCalls: 0,
    toolBytesIn: 0,
    toolBytesOut: 0,
    ...overrides,
  }
}

describe('metrics/store', () => {
  it('enqueues + flushes events to SQLite', () => {
    store.enqueue(makeEvent())
    store.flushSync()
    const out = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
    })
    expect(out).toHaveLength(1)
    expect(out[0].provider).toBe('mistral')
    expect(out[0].route).toBe('/proxy/x')
    expect(out[0].costUsd).toBeCloseTo(0.0015)
  })

  it('preserves null token fields', () => {
    store.enqueue(
      makeEvent({
        provider: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
      }),
    )
    store.flushSync()
    const out = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
    })
    expect(out[0].provider).toBeNull()
    expect(out[0].totalTokens).toBeNull()
  })

  it('filters by route', () => {
    store.enqueue(makeEvent({ route: '/proxy/a' }))
    store.enqueue(makeEvent({ route: '/proxy/b' }))
    store.flushSync()
    const out = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
      route: '/proxy/a',
    })
    expect(out).toHaveLength(1)
    expect(out[0].route).toBe('/proxy/a')
  })

  it('aggregates rollups by day', () => {
    store.enqueue(makeEvent({ ts: '2026-05-19T10:00:00.000Z', totalTokens: 100, costUsd: 0.001 }))
    store.enqueue(makeEvent({ ts: '2026-05-19T15:00:00.000Z', totalTokens: 200, costUsd: 0.002 }))
    store.enqueue(makeEvent({ ts: '2026-05-20T10:00:00.000Z', totalTokens: 50, costUsd: 0.0005 }))
    store.flushSync()
    const out = store.rollups({
      period: 'day',
      from: '2026-05-19T00:00:00.000Z',
      to: '2026-05-21T00:00:00.000Z',
    })
    expect(out).toHaveLength(2)
    expect(out[0].bucket).toBe('2026-05-19')
    expect(out[0].requests).toBe(2)
    expect(out[0].totalTokens).toBe(300)
    expect(out[0].totalCostUsd).toBeCloseTo(0.003)
    expect(out[1].bucket).toBe('2026-05-20')
    expect(out[1].requests).toBe(1)
  })

  it('counts errors in rollups', () => {
    store.enqueue(makeEvent({ ts: '2026-05-19T10:00:00.000Z', status: 200 }))
    store.enqueue(makeEvent({ ts: '2026-05-19T11:00:00.000Z', status: 500 }))
    store.enqueue(
      makeEvent({ ts: '2026-05-19T12:00:00.000Z', status: 200, error: 'upstream_timeout' }),
    )
    store.flushSync()
    const out = store.rollups({
      period: 'day',
      from: '2026-05-19T00:00:00.000Z',
      to: '2026-05-20T00:00:00.000Z',
    })
    expect(out[0].errors).toBe(2)
  })

  it('prunes events older than retentionDays', () => {
    const old = new Date(Date.now() - 100 * 86400_000).toISOString()
    const recent = new Date().toISOString()
    store.enqueue(makeEvent({ ts: old }))
    store.enqueue(makeEvent({ ts: recent }))
    store.flushSync()
    const removed = store.pruneOlderThan(30)
    expect(removed).toBe(1)
    const remaining = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
    })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].ts).toBe(recent)
  })

  it('roundtrips compactor + guardrails fields', () => {
    store.enqueue(
      makeEvent({
        compactorActive: true,
        compactorBypass: false,
        compactorSavedBytes: 1234,
        compactorCompressors: 'pre-summary,dedup',
        guardrailsAction: 'redact',
        guardrailsHits: 3,
        guardrailsDetectors: 'aws-key,pii-email',
      }),
    )
    store.flushSync()
    const out = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
    })
    expect(out[0].compactorActive).toBe(true)
    expect(out[0].compactorBypass).toBe(false)
    expect(out[0].compactorSavedBytes).toBe(1234)
    expect(out[0].compactorCompressors).toBe('pre-summary,dedup')
    expect(out[0].guardrailsAction).toBe('redact')
    expect(out[0].guardrailsHits).toBe(3)
    expect(out[0].guardrailsDetectors).toBe('aws-key,pii-email')
  })

  it('filters by compactorActive=true', () => {
    store.enqueue(makeEvent({ route: '/proxy/a', compactorActive: true }))
    store.enqueue(makeEvent({ route: '/proxy/b', compactorActive: false }))
    store.enqueue(makeEvent({ route: '/proxy/c' })) // null
    store.flushSync()
    const out = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
      compactorActive: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0].route).toBe('/proxy/a')
  })

  it('filters by guardrailsAny (hits or non-allow action)', () => {
    store.enqueue(
      makeEvent({ route: '/proxy/clean', guardrailsAction: 'allow', guardrailsHits: 0 }),
    )
    store.enqueue(makeEvent({ route: '/proxy/hit', guardrailsAction: 'redact', guardrailsHits: 2 }))
    store.enqueue(
      makeEvent({ route: '/proxy/block', guardrailsAction: 'block', guardrailsHits: 1 }),
    )
    store.enqueue(makeEvent({ route: '/proxy/none' }))
    store.flushSync()
    const out = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
      guardrailsAny: true,
    })
    expect(out.map((e) => e.route).sort()).toEqual(['/proxy/block', '/proxy/hit'])
  })

  it('aggregates rollups by minute', () => {
    store.enqueue(makeEvent({ ts: '2026-05-19T10:00:30.000Z' }))
    store.enqueue(makeEvent({ ts: '2026-05-19T10:00:45.000Z' }))
    store.enqueue(makeEvent({ ts: '2026-05-19T10:01:10.000Z' }))
    store.flushSync()
    const out = store.rollups({
      period: 'minute',
      from: '2026-05-19T00:00:00.000Z',
      to: '2026-05-19T23:59:59.000Z',
    })
    expect(out).toHaveLength(2)
    expect(out[0].bucket).toBe('2026-05-19T10:00:00Z')
    expect(out[0].requests).toBe(2)
    expect(out[1].bucket).toBe('2026-05-19T10:01:00Z')
    expect(out[1].requests).toBe(1)
  })

  it('aggregates rollups by 5min', () => {
    store.enqueue(makeEvent({ ts: '2026-05-19T10:00:00.000Z' }))
    store.enqueue(makeEvent({ ts: '2026-05-19T10:04:59.000Z' }))
    store.enqueue(makeEvent({ ts: '2026-05-19T10:05:00.000Z' }))
    store.flushSync()
    const out = store.rollups({
      period: '5min',
      from: '2026-05-19T00:00:00.000Z',
      to: '2026-05-19T23:59:59.000Z',
    })
    expect(out).toHaveLength(2)
    expect(out[0].requests).toBe(2)
    expect(out[1].requests).toBe(1)
  })

  it('aggregates rollups by 15min', () => {
    store.enqueue(makeEvent({ ts: '2026-05-19T10:00:00.000Z' }))
    store.enqueue(makeEvent({ ts: '2026-05-19T10:14:00.000Z' }))
    store.enqueue(makeEvent({ ts: '2026-05-19T10:15:00.000Z' }))
    store.enqueue(makeEvent({ ts: '2026-05-19T10:29:59.000Z' }))
    store.flushSync()
    const out = store.rollups({
      period: '15min',
      from: '2026-05-19T00:00:00.000Z',
      to: '2026-05-19T23:59:59.000Z',
    })
    expect(out).toHaveLength(2)
    expect(out[0].requests).toBe(2)
    expect(out[1].requests).toBe(2)
  })

  it('rollups include compactor + guardrails aggregates', () => {
    store.enqueue(
      makeEvent({
        ts: '2026-05-19T10:00:00.000Z',
        compactorActive: true,
        compactorSavedBytes: 500,
        guardrailsHits: 2,
      }),
    )
    store.enqueue(
      makeEvent({
        ts: '2026-05-19T10:30:00.000Z',
        compactorActive: true,
        compactorSavedBytes: 250,
        guardrailsAction: 'block',
      }),
    )
    store.flushSync()
    const out = store.rollups({
      period: 'day',
      from: '2026-05-19T00:00:00.000Z',
      to: '2026-05-20T00:00:00.000Z',
    })
    expect(out[0].compactorSavedBytes).toBe(750)
    expect(out[0].compactorRequests).toBe(2)
    expect(out[0].guardrailsHitRequests).toBe(1)
    expect(out[0].guardrailsBlocks).toBe(1)
  })

  it('migrate() is idempotent — reopening preserves data', async () => {
    store.enqueue(makeEvent({ route: '/proxy/persist' }))
    store.flushSync()
    store.close()
    const store2 = await import('../../src/metrics/store.js')
    await store2.open(dbPath)
    const out = store2.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
    })
    expect(out).toHaveLength(1)
    expect(out[0].route).toBe('/proxy/persist')
  })

  it('batched inserts via transaction match individual semantics', () => {
    for (let i = 0; i < 50; i++) {
      store.enqueue(makeEvent({ ts: new Date(Date.now() + i).toISOString() }))
    }
    store.flushSync()
    const out = store.queryRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2099-01-01T00:00:00.000Z',
    })
    expect(out).toHaveLength(50)
  })
})
