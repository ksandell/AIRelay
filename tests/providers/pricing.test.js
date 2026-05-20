import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadPricing,
  lookupModelPrice,
  _resetUnknownModelWarnings,
} from '../../src/providers/pricing.js'

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
    const dir = mkdtempSync(join(tmpdir(), 'airelay-'))
    const tmpPath = join(dir, 'pricing-override.json')
    writeFileSync(tmpPath, JSON.stringify(override))
    const pricing = loadPricing('openai', tmpPath)
    expect(pricing['gpt-custom']).toMatchObject({ input: 99.0 })
    expect(pricing['gpt-4o']).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
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

describe('pricing coverage', () => {
  it('every model in the bundled pricing table yields cost > 0 for nonzero tokens (except ollama wildcard)', () => {
    const bundled = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../config/pricing.json'), 'utf8'),
    )
    for (const [provider, models] of Object.entries(bundled.providers)) {
      if (provider === 'ollama') continue
      for (const [model, price] of Object.entries(models)) {
        const cost = (1000 * price.input + 1000 * price.output) / 1_000_000
        expect(cost, `${provider}:${model} should price > 0`).toBeGreaterThan(0)
      }
    }
  })

  it('mistral table includes medium-latest and open-mistral-7b', () => {
    const pricing = loadPricing('mistral')
    expect(pricing['mistral-medium-latest']).toBeDefined()
    expect(pricing['mistral-medium-latest'].input).toBeGreaterThan(0)
    expect(pricing['mistral-medium-latest'].output).toBeGreaterThan(0)
    expect(pricing['open-mistral-7b']).toBeDefined()
    expect(pricing['open-mistral-7b'].input).toBeGreaterThan(0)
    expect(pricing['open-mistral-7b'].output).toBeGreaterThan(0)
  })
})

describe('unknown model warning (one-shot)', () => {
  beforeEach(() => {
    _resetUnknownModelWarnings()
  })

  it('writes one stderr line on first unknown provider:model lookup', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    lookupModelPrice(loadPricing('openai'), 'mystery-model-1', 'openai')
    const matches = spy.mock.calls.filter((c) => String(c[0]).includes('[pricing] unknown'))
    expect(matches.length).toBe(1)
    expect(String(matches[0][0])).toContain('openai:mystery-model-1')
    spy.mockRestore()
  })

  it('does not warn twice for the same pair', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    lookupModelPrice(loadPricing('openai'), 'mystery-model-2', 'openai')
    lookupModelPrice(loadPricing('openai'), 'mystery-model-2', 'openai')
    const matches = spy.mock.calls.filter((c) => String(c[0]).includes('openai:mystery-model-2'))
    expect(matches.length).toBe(1)
    spy.mockRestore()
  })

  it('warns separately per distinct provider:model pair', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    lookupModelPrice(loadPricing('openai'), 'mystery-a', 'openai')
    lookupModelPrice(loadPricing('openai'), 'mystery-b', 'openai')
    const matches = spy.mock.calls.filter((c) => String(c[0]).includes('[pricing] unknown'))
    expect(matches.length).toBe(2)
    spy.mockRestore()
  })

  it('does not warn for ollama wildcard match', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    lookupModelPrice(loadPricing('ollama'), 'any-model', 'ollama')
    const matches = spy.mock.calls.filter((c) => String(c[0]).includes('[pricing] unknown'))
    expect(matches.length).toBe(0)
    spy.mockRestore()
  })
})
