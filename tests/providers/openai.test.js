import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OpenAIProvider } from '../../src/providers/openai.js'
import { loadPricing } from '../../src/providers/pricing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fix = (f) => readFileSync(join(__dirname, 'fixtures', f))

describe('OpenAIProvider', () => {
  const p = new OpenAIProvider(loadPricing('openai'))

  it('name is "openai"', () => expect(p.name).toBe('openai'))

  it('extracts tokens from sync response', () => {
    expect(p.extractTokens(fix('openai-sync.json'))).toMatchObject({
      model: 'gpt-4o',
      inputTokens: 25,
      outputTokens: 10,
      totalTokens: 35,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    })
  })

  it('extracts tokens from streaming response', () => {
    expect(p.extractTokens(fix('openai-streaming.txt'))).toMatchObject({
      model: 'gpt-4o',
      inputTokens: 25,
      outputTokens: 10,
      totalTokens: 35,
    })
  })

  it('returns null for unparseable buffer', () => {
    expect(p.extractTokens(Buffer.from('not json'))).toBeNull()
  })

  it('calculates cost for known model (1M tokens each)', () => {
    // gpt-4o: $2.50/MTok input + $10/MTok output = $12.50
    expect(
      p.calculateCost({ model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(12.5, 4)
  })

  it('calculateCost returns null for unknown model', () => {
    expect(
      p.calculateCost({ model: 'gpt-99-ultra', inputTokens: 100, outputTokens: 50 }),
    ).toBeNull()
  })

  it('returns null when no chunk contains usage', () => {
    const noUsage = Buffer.from(
      'data: {"model":"gpt-4o","choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n',
    )
    expect(p.extractTokens(noUsage)).toBeNull()
  })
})
