import { describe, it, expect } from 'vitest'
import pricing from '../../config/pricing.json' with { type: 'json' }

const REQUIRED_PROVIDERS = [
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
  'ollama',
  'nvidia',
  'openrouter',
  'anlinkai',
]

describe('pricing.json completeness', () => {
  it('contains all 15 required providers', () => {
    const present = Object.keys(pricing.providers)
    for (const name of REQUIRED_PROVIDERS) {
      expect(present, `missing provider "${name}"`).toContain(name)
    }
  })

  it.each(REQUIRED_PROVIDERS)(
    'provider %s has at least one model entry with input/output prices',
    (name) => {
      const models = pricing.providers[name]
      expect(models, `provider ${name} has no models block`).toBeDefined()
      const keys = Object.keys(models)
      expect(keys.length, `provider ${name} has 0 models`).toBeGreaterThan(0)
      for (const key of keys) {
        const entry = models[key]
        expect(typeof entry.input, `${name}/${key} input price`).toBe('number')
        expect(typeof entry.output, `${name}/${key} output price`).toBe('number')
      }
    },
  )
})
