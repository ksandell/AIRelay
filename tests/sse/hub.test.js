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

describe('hub: cross-channel eviction', () => {
  let addClient, clientCount, closeAll

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 3
    config.sseHeartbeatMs = 60000
    ;({ addClient, clientCount, closeAll } = await import('../../src/sse/hub.js'))
  })

  afterEach(() => {
    closeAll()
  })

  it('evicts oldest client across channels when cap reached', () => {
    const logsClient = mockRes()
    const m1 = mockRes()
    const m2 = mockRes()
    addClient(logsClient, 'logs')
    addClient(m1, 'metrics')
    addClient(m2, 'metrics')
    // cap=3, all 3 slots full

    const newLogs = mockRes()
    addClient(newLogs, 'logs')
    // oldest (logsClient) should be evicted
    expect(clientCount()).toBe(3)
    expect(logsClient.write.mock.calls[0]?.[0]).toContain('evicted')
    expect(logsClient.end).toHaveBeenCalled()
    // new client is in
    expect(newLogs.end).not.toHaveBeenCalled()
  })

  it('tracks clients across channels in one count', () => {
    addClient(mockRes(), 'logs')
    addClient(mockRes(), 'metrics')
    expect(clientCount()).toBe(2)
  })

  it('removes client on close regardless of channel', () => {
    const r = mockRes()
    addClient(r, 'logs')
    expect(clientCount()).toBe(1)
    r._triggerClose()
    expect(clientCount()).toBe(0)
  })
})

describe('hub: broadcast channel isolation', () => {
  let addClient, broadcast, closeAll

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 10
    config.sseHeartbeatMs = 60000
    ;({ addClient, broadcast, closeAll } = await import('../../src/sse/hub.js'))
  })

  afterEach(() => {
    closeAll()
  })

  it('sends only to clients on the target channel', () => {
    const logs = mockRes()
    const metrics = mockRes()
    addClient(logs, 'logs')
    addClient(metrics, 'metrics')

    broadcast('logs', { msg: 'hello' })
    expect(logs._writes).toHaveLength(1)
    expect(metrics._writes).toHaveLength(0)

    broadcast('metrics', { tick: 1 }, 'tick')
    expect(logs._writes).toHaveLength(1)
    expect(metrics._writes).toHaveLength(1)
    expect(metrics._writes[0]).toContain('event: tick')
  })

  it('includes eventName in SSE frame when provided', () => {
    const r = mockRes()
    addClient(r, 'metrics')
    broadcast('metrics', { x: 1 }, 'request')
    expect(r._writes[0]).toMatch(/^event: request\n/)
  })

  it('omits event: line when no eventName', () => {
    const r = mockRes()
    addClient(r, 'logs')
    broadcast('logs', { x: 1 })
    expect(r._writes[0]).not.toContain('event:')
    expect(r._writes[0]).toContain('data:')
  })
})

describe('hub: single heartbeat', () => {
  let addClient, startHeartbeat, closeAll

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 10
    config.sseHeartbeatMs = 1000
    ;({ addClient, startHeartbeat, closeAll } = await import('../../src/sse/hub.js'))
  })

  afterEach(() => {
    closeAll()
    vi.useRealTimers()
  })

  it('sends heartbeat to all channels on one interval', () => {
    const logs = mockRes()
    const metrics = mockRes()
    addClient(logs, 'logs')
    addClient(metrics, 'metrics')
    const timer = startHeartbeat()
    vi.advanceTimersByTime(1000)
    clearInterval(timer)
    expect(logs._writes.some((w) => w.includes(': heartbeat'))).toBe(true)
    expect(metrics._writes.some((w) => w.includes(': heartbeat'))).toBe(true)
  })

  it('returns clearable interval handle', () => {
    const timer = startHeartbeat()
    expect(timer).toBeDefined()
    clearInterval(timer)
  })
})

describe('hub: closeAll', () => {
  let addClient, clientCount, closeAll

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 10
    config.sseHeartbeatMs = 60000
    ;({ addClient, clientCount, closeAll } = await import('../../src/sse/hub.js'))
  })

  it('ends all clients across channels and clears map', () => {
    const r1 = mockRes()
    const r2 = mockRes()
    addClient(r1, 'logs')
    addClient(r2, 'metrics')
    closeAll()
    expect(r1.end).toHaveBeenCalled()
    expect(r2.end).toHaveBeenCalled()
    expect(clientCount()).toBe(0)
  })

  it('handles end() throw gracefully', () => {
    const r = mockRes()
    r.end.mockImplementation(() => {
      throw new Error('already closed')
    })
    addClient(r, 'logs')
    expect(() => closeAll()).not.toThrow()
    expect(clientCount()).toBe(0)
  })
})
