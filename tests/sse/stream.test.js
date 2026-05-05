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

describe('SSE stream: addClient + clientCount', () => {
  let addClient, clientCount, closeAll

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 3
    config.sseHeartbeatMs = 60000
    ;({ addClient, clientCount, closeAll } = await import('../../src/sse/stream.js'))
  })

  afterEach(() => {
    closeAll()
  })

  it('tracks added client', () => {
    addClient(mockRes())
    expect(clientCount()).toBe(1)
  })

  it('removes client on close event', () => {
    const r = mockRes()
    addClient(r)
    expect(clientCount()).toBe(1)
    r._triggerClose()
    expect(clientCount()).toBe(0)
  })

  it('evicts oldest client when cap reached', () => {
    const clients = Array.from({ length: 4 }, mockRes)
    for (const c of clients) addClient(c)
    expect(clientCount()).toBe(3)
    const firstWriteArg = clients[0].write.mock.calls[0]?.[0] ?? ''
    expect(firstWriteArg).toContain('evicted')
    expect(clients[0].end).toHaveBeenCalled()
  })
})

describe('SSE stream: broadcast', () => {
  let addClient, broadcast, closeAll

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 10
    config.sseHeartbeatMs = 60000
    ;({ addClient, broadcast, closeAll } = await import('../../src/sse/stream.js'))
  })

  afterEach(() => {
    closeAll()
  })

  it('sends JSON data to all clients', () => {
    const r1 = mockRes()
    const r2 = mockRes()
    addClient(r1)
    addClient(r2)
    broadcast({ type: 'log', msg: 'hello' })
    expect(r1._writes).toHaveLength(1)
    expect(r1._writes[0]).toContain('"hello"')
    expect(r2._writes).toHaveLength(1)
  })

  it('handles write error gracefully (no throw)', () => {
    const r = mockRes()
    r.write.mockImplementation(() => {
      throw new Error('stream closed')
    })
    addClient(r)
    expect(() => broadcast({ x: 1 })).not.toThrow()
  })

  it('sends no data when no clients', () => {
    expect(() => broadcast({ x: 1 })).not.toThrow()
  })
})

describe('SSE stream: broadcastRetry', () => {
  let addClient, broadcastRetry, closeAll

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 10
    config.sseHeartbeatMs = 60000
    ;({ addClient, broadcastRetry, closeAll } = await import('../../src/sse/stream.js'))
  })

  afterEach(() => {
    closeAll()
  })

  it('sends retry frame with default ms', () => {
    const r = mockRes()
    addClient(r)
    broadcastRetry()
    expect(r._writes[0]).toContain('retry: 5000')
  })

  it('sends retry frame with custom ms', () => {
    const r = mockRes()
    addClient(r)
    broadcastRetry(1000)
    expect(r._writes[0]).toContain('retry: 1000')
  })
})

describe('SSE stream: closeAll', () => {
  let addClient, clientCount, closeAll

  beforeEach(async () => {
    vi.resetModules()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 10
    config.sseHeartbeatMs = 60000
    ;({ addClient, clientCount, closeAll } = await import('../../src/sse/stream.js'))
  })

  it('ends all clients and clears set', () => {
    const r1 = mockRes()
    const r2 = mockRes()
    addClient(r1)
    addClient(r2)
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
    addClient(r)
    expect(() => closeAll()).not.toThrow()
    expect(clientCount()).toBe(0)
  })
})

describe('SSE stream: startHeartbeat', () => {
  let addClient, startHeartbeat, closeAll

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const { config } = await import('../../src/config.js')
    config.maxSseClients = 10
    config.sseHeartbeatMs = 1000
    ;({ addClient, startHeartbeat, closeAll } = await import('../../src/sse/stream.js'))
  })

  afterEach(() => {
    closeAll()
    vi.useRealTimers()
  })

  it('sends heartbeat comment on interval', () => {
    const r = mockRes()
    addClient(r)
    const timer = startHeartbeat()
    vi.advanceTimersByTime(1000)
    clearInterval(timer)
    expect(r._writes.some((w) => w.includes(': heartbeat'))).toBe(true)
  })

  it('returns an interval handle that can be cleared', () => {
    const timer = startHeartbeat()
    expect(timer).toBeDefined()
    clearInterval(timer)
  })
})
