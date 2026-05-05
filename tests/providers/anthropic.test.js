import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AnthropicProvider } from '../../src/providers/anthropic.js'
import { loadPricing } from '../../src/providers/pricing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fix = (f) => readFileSync(join(__dirname, 'fixtures', f))

describe('AnthropicProvider', () => {
  const p = new AnthropicProvider(loadPricing('anthropic'))

  it('name is "anthropic"', () => expect(p.name).toBe('anthropic'))

  it('extracts tokens from sync response', () => {
    expect(p.extractTokens(fix('anthropic-sync.json'))).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 25,
      outputTokens: 10,
      totalTokens: 35,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('extracts tokens from streaming response', () => {
    expect(p.extractTokens(fix('anthropic-streaming.txt'))).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 25,
      outputTokens: 10,
      totalTokens: 35,
    })
  })

  it('returns null for unparseable buffer', () => {
    expect(p.extractTokens(Buffer.from('not json\nnot sse'))).toBeNull()
  })

  it('calculates cost for known model (1M tokens each)', () => {
    // claude-sonnet-4-6: $3/MTok input + $15/MTok output = $18
    const tokens = {
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    expect(p.calculateCost(tokens)).toBeCloseTo(18.0, 4)
  })

  it('includes cache costs in calculation', () => {
    // cacheRead $0.30/MTok + cacheWrite $3.75/MTok = $4.05
    const tokens = {
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    }
    expect(p.calculateCost(tokens)).toBeCloseTo(4.05, 4)
  })

  it('calculateCost returns null for unknown model', () => {
    expect(
      p.calculateCost({
        model: 'claude-unknown-xyz',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull()
  })

  it('exact math: 25 input + 10 output on claude-sonnet-4-6', () => {
    // (25 * 3 + 10 * 15) / 1_000_000 = $0.000225
    const tokens = {
      model: 'claude-sonnet-4-6',
      inputTokens: 25,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    expect(p.calculateCost(tokens)).toBeCloseTo(0.000225, 8)
  })
})
