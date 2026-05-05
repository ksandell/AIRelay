import { describe, it, expect } from 'vitest'
import pricing from '../../config/pricing.json' with { type: 'json' }
import { AnthropicProvider } from '../../src/providers/anthropic.js'
import { OpenAIProvider } from '../../src/providers/openai.js'
import { GoogleProvider } from '../../src/providers/google.js'

// Compute expected cost from pricing.json so the test stays correct if prices change.
function expectedCost(provider, model, inputTokens, outputTokens) {
  const p = pricing.providers[provider][model]
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

describe('cost math — exact values from pricing.json', () => {
  it('anthropic claude-sonnet-4-6: 25 input + 10 output', () => {
    const tokens = {
      model: 'claude-sonnet-4-6',
      inputTokens: 25,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    const expected = expectedCost('anthropic', 'claude-sonnet-4-6', 25, 10)
    const provider = new AnthropicProvider(pricing.providers.anthropic)
    const cost = provider.calculateCost(tokens)
    expect(cost).toBeCloseTo(expected, 12)
    // Sanity: at the documented $3/$15 rate this is 0.000225.
    expect(expected).toBeCloseTo(0.000225, 12)
  })

  it('openai gpt-4o: 1M input + 1M output', () => {
    const tokens = { model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const expected = expectedCost('openai', 'gpt-4o', 1_000_000, 1_000_000)
    const provider = new OpenAIProvider(pricing.providers.openai)
    const cost = provider.calculateCost(tokens)
    expect(cost).toBeCloseTo(expected, 10)
    expect(expected).toBeCloseTo(12.5, 10)
  })

  it('google gemini-2.0-flash: 1M input + 1M output', () => {
    const tokens = { model: 'gemini-2.0-flash', inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const expected = expectedCost('google', 'gemini-2.0-flash', 1_000_000, 1_000_000)
    const provider = new GoogleProvider(pricing.providers.google)
    const cost = provider.calculateCost(tokens)
    expect(cost).toBeCloseTo(expected, 10)
    expect(expected).toBeCloseTo(0.5, 10)
  })
})
