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

  describe('extractToolCalls', () => {
    it('counts tool_calls in sync response', () => {
      const resp = Buffer.from(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 't1',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        }),
      )
      const out = p.extractToolCalls(null, resp)
      expect(out).toMatchObject({ toolCalls: 1, toolBytesIn: 0 })
      expect(out.toolBytesOut).toBeGreaterThan(0)
    })

    it('counts role:tool messages in request', () => {
      const req = Buffer.from(
        JSON.stringify({
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'tool', tool_call_id: 't1', content: '72F' },
          ],
        }),
      )
      const out = p.extractToolCalls(req, null)
      expect(out).toMatchObject({ toolCalls: 1 })
      expect(out.toolBytesIn).toBeGreaterThan(0)
    })

    it('returns null when neither side has tools', () => {
      expect(
        p.extractToolCalls(
          Buffer.from('{"messages":[{"role":"user","content":"hi"}]}'),
          Buffer.from('{"choices":[{"message":{"content":"hi"}}]}'),
        ),
      ).toBeNull()
    })
  })
})

describe('OpenAIProvider — malformed SSE robustness', () => {
  const provider = new OpenAIProvider(loadPricing('openai'))

  it('does not throw on truncated streaming chunk', () => {
    const truncated = Buffer.from(
      'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"hel"}}',
    )
    expect(() => provider.extractTokens(truncated)).not.toThrow()
  })

  it('does not throw on data: [DONE]', () => {
    const done = Buffer.from('data: [DONE]\n\n')
    expect(() => provider.extractTokens(done)).not.toThrow()
  })
})
