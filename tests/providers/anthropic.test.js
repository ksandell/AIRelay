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

  describe('extractToolCalls', () => {
    it('counts tool_use in sync response', () => {
      const resp = Buffer.from(
        JSON.stringify({
          content: [
            { type: 'text', text: 'let me check' },
            { type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Oslo' } },
          ],
        }),
      )
      const out = p.extractToolCalls(null, resp)
      expect(out).toMatchObject({ toolCalls: 1, toolBytesIn: 0 })
      expect(out.toolBytesOut).toBeGreaterThan(0)
    })

    it('counts tool_result blocks in request', () => {
      const req = Buffer.from(
        JSON.stringify({
          messages: [
            {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 't1', content: '72F' }],
            },
          ],
        }),
      )
      const out = p.extractToolCalls(req, null)
      expect(out).toMatchObject({ toolCalls: 1 })
      expect(out.toolBytesIn).toBeGreaterThan(0)
    })

    it('returns null when neither side has tools', () => {
      const out = p.extractToolCalls(
        Buffer.from('{"messages":[{"role":"user","content":"hi"}]}'),
        Buffer.from('{"content":[{"type":"text","text":"hello"}]}'),
      )
      expect(out).toBeNull()
    })
  })
})
