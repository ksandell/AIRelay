import { describe, it, expect, beforeEach } from 'vitest'

describe('loadProvider', () => {
  let loadProvider

  beforeEach(async () => {
    // Re-import with cache bust to reset singleton between tests
    const mod = await import('../../src/providers/registry.js?' + Date.now())
    loadProvider = mod.loadProvider
  })

  it('returns AnthropicProvider for "anthropic"', async () => {
    const { AnthropicProvider } = await import('../../src/providers/anthropic.js')
    expect(loadProvider('anthropic')).toBeInstanceOf(AnthropicProvider)
  })

  it('returns OpenAIProvider for "openai"', async () => {
    const { OpenAIProvider } = await import('../../src/providers/openai.js')
    expect(loadProvider('openai')).toBeInstanceOf(OpenAIProvider)
  })

  it('returns GoogleProvider for "google"', async () => {
    const { GoogleProvider } = await import('../../src/providers/google.js')
    expect(loadProvider('google')).toBeInstanceOf(GoogleProvider)
  })

  it('returns AnLinkAIProvider for "anlinkai"', async () => {
    const { AnLinkAIProvider } = await import('../../src/providers/anlinkai.js')
    expect(loadProvider('anlinkai')).toBeInstanceOf(AnLinkAIProvider)
  })

  it('returns CerebrasProvider for "cerebras"', async () => {
    const { CerebrasProvider } = await import('../../src/providers/cerebras.js')
    expect(loadProvider('cerebras')).toBeInstanceOf(CerebrasProvider)
  })

  it('returns GenericProvider for unknown name', async () => {
    const { GenericProvider } = await import('../../src/providers/generic.js')
    expect(loadProvider('unknown-xyz')).toBeInstanceOf(GenericProvider)
  })

  it('returns same instance on repeated calls (singleton per process)', () => {
    const a = loadProvider('openai')
    const b = loadProvider('openai')
    expect(a).toBe(b)
  })
})
