import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function mockRes() {
  const writes = []
  const closeCallbacks = []
  return {
    _writes: writes,
    write: vi.fn((data) => {
      writes.push(data)
      return true
    }),
    end: vi.fn(),
    on: vi.fn((event, cb) => {
      if (event === 'close') closeCallbacks.push(cb)
    }),
    _triggerClose() {
      closeCallbacks.forEach((cb) => cb())
    },
  }
}

describe('addMetricsClient + eviction', () => {
  let addMetricsClient, metricsClientCount, closeAllMetricsClients, stopMetricsBroadcaster

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 3
    config.sseEventRate = 100
    config.metricsTickMs = 60000
    ;({ addMetricsClient, metricsClientCount, closeAllMetricsClients, stopMetricsBroadcaster } =
      await import('../../src/metrics/broadcaster.js'))
  })

  afterEach(() => {
    stopMetricsBroadcaster()
    closeAllMetricsClients()
  })

  it('tracks added clients', () => {
    addMetricsClient(mockRes())
    expect(metricsClientCount()).toBe(1)
  })

  it('removes client on close event', () => {
    const r = mockRes()
    addMetricsClient(r)
    expect(metricsClientCount()).toBe(1)
    r._triggerClose()
    expect(metricsClientCount()).toBe(0)
  })

  it('evicts oldest client when cap is reached', () => {
    const clients = Array.from({ length: 4 }, mockRes)
    for (const c of clients) addMetricsClient(c)
    expect(metricsClientCount()).toBe(3)
    const firstWriteArg = clients[0].write.mock.calls[0]?.[0] ?? ''
    expect(firstWriteArg).toContain('evicted')
    expect(clients[0].end).toHaveBeenCalled()
  })
})

describe('startMetricsBroadcaster double-start guard', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns the same stop fn on double-start without leaking', async () => {
    const { config } = await import('../../src/config.js')
    config.metricsTickMs = 60000
    config.sseEventRate = 100
    const { startMetricsBroadcaster, stopMetricsBroadcaster } =
      await import('../../src/metrics/broadcaster.js')

    const stop1 = startMetricsBroadcaster()
    const stop2 = startMetricsBroadcaster()
    expect(stop1).toBe(stop2)
    stopMetricsBroadcaster()
  })
})

describe('stopMetricsBroadcaster', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('can be restarted cleanly after stop', async () => {
    const { config } = await import('../../src/config.js')
    config.metricsTickMs = 60000
    const { startMetricsBroadcaster, stopMetricsBroadcaster } =
      await import('../../src/metrics/broadcaster.js')

    startMetricsBroadcaster()
    stopMetricsBroadcaster()
    const stop = startMetricsBroadcaster()
    expect(typeof stop).toBe('function')
    stopMetricsBroadcaster()
  })
})
