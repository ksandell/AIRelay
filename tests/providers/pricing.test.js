import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPricing, lookupModelPrice } from '../../src/providers/pricing.js'

describe('loadPricing', () => {
  it('returns pricing for a known provider', () => {
    const pricing = loadPricing('anthropic')
    expect(pricing['claude-sonnet-4-6']).toMatchObject({ input: 3.0, output: 15.0 })
  })

  it('returns empty object for unknown provider', () => {
    expect(loadPricing('unknownprovider')).toEqual({})
  })

  it('all 14 providers have entries', () => {
    const providers = [
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
    ]
    for (const p of providers) {
      expect(Object.keys(loadPricing(p)).length).toBeGreaterThan(0)
    }
  })

  it('deep-merges override file over bundled defaults', () => {
    const override = { providers: { openai: { 'gpt-custom': { input: 99.0, output: 99.0 } } } }
    const tmpPath = join(tmpdir(), 'test-pricing-override.json')
    writeFileSync(tmpPath, JSON.stringify(override))
    const pricing = loadPricing('openai', tmpPath)
    expect(pricing['gpt-custom']).toMatchObject({ input: 99.0 })
    expect(pricing['gpt-4o']).toBeDefined()
    unlinkSync(tmpPath)
  })
})

describe('lookupModelPrice', () => {
  it('returns price for known model', () => {
    expect(lookupModelPrice(loadPricing('anthropic'), 'claude-sonnet-4-6')).toMatchObject({
      input: 3.0,
    })
  })

  it('returns wildcard price for ollama (any model name)', () => {
    expect(lookupModelPrice(loadPricing('ollama'), 'llama3')).toMatchObject({ input: 0, output: 0 })
  })

  it('returns null for unknown model', () => {
    expect(lookupModelPrice(loadPricing('openai'), 'unknown-model-xyz')).toBeNull()
  })

  it('returns null for null pricing', () => {
    expect(lookupModelPrice(null, 'gpt-4o')).toBeNull()
  })
})
