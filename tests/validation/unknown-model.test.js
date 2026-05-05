import { describe, it, expect } from 'vitest'
import pricing from '../../config/pricing.json' with { type: 'json' }
import { loadProvider } from '../../src/providers/registry.js'

const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'groq',
  'microsoft',
  'together',
  'fireworks',
  'deepseek',
  'xai',
  'perplexity',
  'nvidia',
  'openrouter',
  // ollama intentionally excluded — uses wildcard "*" pricing of $0.
]

describe('unknown-model cost behavior', () => {
  it.each(PROVIDERS)('provider %s returns null for unknown model', (name) => {
    const provider = loadProvider(name)
    const tokens = {
      model: 'this-model-does-not-exist-xyz-9999',
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 200,
    }
    expect(provider.calculateCost(tokens)).toBeNull()
  })

  it('every provider returns null when tokens.model is null', () => {
    for (const name of PROVIDERS) {
      const provider = loadProvider(name)
      expect(provider.calculateCost({ model: null, inputTokens: 1, outputTokens: 1 })).toBeNull()
    }
  })

  it('ollama wildcard returns 0 for any model (not null)', () => {
    const provider = loadProvider('ollama')
    const cost = provider.calculateCost({
      model: 'any-local-model',
      inputTokens: 100,
      outputTokens: 100,
    })
    expect(cost).toBe(0)
    // sanity-check pricing.json is the source
    expect(pricing.providers.ollama['*']).toBeDefined()
  })
})
