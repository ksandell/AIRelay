import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/cache/client.js', () => ({
  getClient: vi.fn(),
  isConnected: vi.fn(),
}))

vi.mock('../../src/config.js', () => ({
  config: {
    cacheExactMatchEnabled: true,
    cacheExactTtlSeconds: 3600,
  },
}))

import { getClient, isConnected } from '../../src/cache/client.js'
import { exactGet, exactSet } from '../../src/cache/exact.js'

const mockClient = {
  get: vi.fn(),
  set: vi.fn(),
  dbsize: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  isConnected.mockReturnValue(true)
  getClient.mockReturnValue(mockClient)
})

describe('exactGet', () => {
  it('returns null when not connected', async () => {
    isConnected.mockReturnValue(false)
    expect(await exactGet('abc')).toBeNull()
  })

  it('returns null on cache miss', async () => {
    mockClient.get.mockResolvedValue(null)
    expect(await exactGet('abc')).toBeNull()
  })

  it('returns parsed object on hit', async () => {
    const stored = { body: '{"text":"hello"}', statusCode: 200, contentType: 'application/json', cachedAt: 1000 }
    mockClient.get.mockResolvedValue(JSON.stringify(stored))
    const result = await exactGet('abc')
    expect(result).toMatchObject({ body: '{"text":"hello"}', statusCode: 200 })
  })

  it('returns null on Redis error', async () => {
    mockClient.get.mockRejectedValue(new Error('ECONNRESET'))
    expect(await exactGet('abc')).toBeNull()
  })
})

describe('exactSet', () => {
  it('calls client.set with EX TTL', async () => {
    mockClient.set.mockResolvedValue('OK')
    await exactSet('abc', { body: 'data', statusCode: 200, contentType: 'application/json' })
    expect(mockClient.set).toHaveBeenCalledWith(
      'airelay:exact:abc',
      expect.any(String),
      'EX',
      3600,
    )
  })

  it('no-ops when not connected', async () => {
    isConnected.mockReturnValue(false)
    await exactSet('abc', { body: 'data', statusCode: 200, contentType: 'application/json' })
    expect(mockClient.set).not.toHaveBeenCalled()
  })

  it('swallows Redis errors', async () => {
    mockClient.set.mockRejectedValue(new Error('ECONNRESET'))
    await expect(exactSet('abc', { body: 'data', statusCode: 200, contentType: 'application/json' })).resolves.not.toThrow()
  })
})
