import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/cache/client.js', () => ({
  getClient: vi.fn(),
  isConnected: vi.fn(),
}))

vi.mock('../../src/config.js', () => ({
  config: {
    cacheSpendEnabled: true,
    cacheSpendDailyLimitUsd: 1.0,
    cacheSpendMonthlyLimitUsd: 10.0,
  },
}))

import { getClient, isConnected } from '../../src/cache/client.js'
import { checkSpendLimit, incrementSpend, extractApiKey } from '../../src/cache/spend.js'

const mockClient = { get: vi.fn(), incrbyfloat: vi.fn(), expire: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  isConnected.mockReturnValue(true)
  getClient.mockReturnValue(mockClient)
  mockClient.incrbyfloat.mockResolvedValue('0.5')
  mockClient.expire.mockResolvedValue(1)
})

describe('extractApiKey', () => {
  it('prefers Authorization header', () => {
    const req = { headers: { authorization: 'Bearer sk-123', 'x-api-key': 'old' } }
    expect(extractApiKey(req)).toBe('Bearer sk-123')
  })

  it('falls back to x-api-key', () => {
    const req = { headers: { 'x-api-key': 'sk-456' } }
    expect(extractApiKey(req)).toBe('sk-456')
  })

  it('returns null when no key', () => {
    expect(extractApiKey({ headers: {} })).toBeNull()
  })
})

describe('checkSpendLimit', () => {
  it('returns null when not connected', async () => {
    isConnected.mockReturnValue(false)
    const req = { headers: { authorization: 'Bearer sk-test' } }
    expect(await checkSpendLimit(req)).toBeNull()
  })

  it('returns null when under limits', async () => {
    mockClient.get.mockResolvedValue('0.5')
    const req = { headers: { authorization: 'Bearer sk-test' } }
    expect(await checkSpendLimit(req)).toBeNull()
  })

  it('returns "daily" when daily counter >= limit', async () => {
    mockClient.get.mockResolvedValueOnce('1.0').mockResolvedValueOnce('5.0')
    const req = { headers: { authorization: 'Bearer sk-test' } }
    expect(await checkSpendLimit(req)).toBe('daily')
  })

  it('returns null on Redis error (fail-open)', async () => {
    mockClient.get.mockRejectedValue(new Error('ECONNRESET'))
    const req = { headers: {} }
    expect(await checkSpendLimit(req)).toBeNull()
  })
})

describe('incrementSpend', () => {
  it('calls incrbyfloat on both keys', async () => {
    const req = { headers: { authorization: 'Bearer sk-test' } }
    await incrementSpend(req, 0.001)
    expect(mockClient.incrbyfloat).toHaveBeenCalledTimes(2)
  })

  it('no-ops when costUsd is zero', async () => {
    const req = { headers: {} }
    await incrementSpend(req, 0)
    expect(mockClient.incrbyfloat).not.toHaveBeenCalled()
  })
})
