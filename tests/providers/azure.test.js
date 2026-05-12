import { describe, it, expect } from 'vitest'
import { AzureOpenAIProvider } from '../../src/providers/azure.js'

describe('AzureOpenAIProvider', () => {
  const pricing = {
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
  }
  const p = new AzureOpenAIProvider(pricing, 'azure')

  it('exposes name "azure"', () => {
    expect(p.name).toBe('azure')
  })

  it('extracts tokens from an OpenAI-shaped sync response', () => {
    const body = Buffer.from(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        choices: [{ message: { role: 'assistant', content: 'hi' } }],
      }),
    )
    const t = p.extractTokens(body)
    expect(t).toEqual({
      model: 'gpt-4o-mini',
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: 18,
    })
  })

  it('extracts tokens from a streaming SSE response with a usage chunk', () => {
    const sse =
      'data: {"id":"x","model":"gpt-4o-mini","choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"id":"x","model":"gpt-4o-mini","usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n'
    const t = p.extractTokens(Buffer.from(sse))
    expect(t.model).toBe('gpt-4o-mini')
    expect(t.inputTokens).toBe(3)
    expect(t.outputTokens).toBe(2)
  })

  it('calculates cost using the azure pricing block', () => {
    const cost = p.calculateCost({ model: 'gpt-4o-mini', inputTokens: 1_000_000, outputTokens: 0 })
    expect(cost).toBeCloseTo(0.15, 6)
  })
})
