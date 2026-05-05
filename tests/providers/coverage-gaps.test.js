import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPricing } from '../../src/providers/pricing.js'
import { AnthropicProvider } from '../../src/providers/anthropic.js'
import { OpenAIProvider } from '../../src/providers/openai.js'
import { GroqProvider } from '../../src/providers/groq.js'
import { OllamaProvider } from '../../src/providers/ollama.js'
import { GoogleProvider } from '../../src/providers/google.js'

describe('pricing override error path', () => {
  it('throws clear error when override file unreadable', () => {
    expect(() => loadPricing('openai', '/nonexistent/path/pricing.json')).toThrow(
      /Failed to load PRICING_CONFIG_PATH/,
    )
  })

  it('accepts override without providers wrapper', () => {
    const tmpPath = join(tmpdir(), 'test-pricing-flat.json')
    writeFileSync(tmpPath, JSON.stringify({ openai: { 'foo-model': { input: 1, output: 2 } } }))
    const p = loadPricing('openai', tmpPath)
    expect(p['foo-model']).toMatchObject({ input: 1, output: 2 })
    unlinkSync(tmpPath)
  })
})

describe('AnthropicProvider streaming edge cases', () => {
  const p = new AnthropicProvider(loadPricing('anthropic'))

  it('skips malformed SSE lines', () => {
    const buf = Buffer.from(
      'data: {bad json\n' +
        'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":5}}}\n' +
        'data: {"type":"message_delta","usage":{"output_tokens":3}}\n',
    )
    expect(p.extractTokens(buf)).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
    })
  })

  it('returns null when no usage info present in stream', () => {
    const buf = Buffer.from('data: {"type":"ping"}\n')
    expect(p.extractTokens(buf)).toBeNull()
  })

  it('calculateCost returns null when tokens has no model', () => {
    expect(p.calculateCost({ inputTokens: 10 })).toBeNull()
    expect(p.calculateCost(null)).toBeNull()
  })
})

describe('OpenAIProvider streaming edge cases', () => {
  const p = new OpenAIProvider(loadPricing('openai'))

  it('skips malformed SSE lines but parses good ones', () => {
    const buf = Buffer.from(
      'data: {oops\n' +
        'data: {"model":"gpt-4o","usage":{"prompt_tokens":7,"completion_tokens":2}}\n' +
        'data: [DONE]\n',
    )
    expect(p.extractTokens(buf)).toMatchObject({
      model: 'gpt-4o',
      inputTokens: 7,
      outputTokens: 2,
      totalTokens: 9,
    })
  })

  it('calculateCost returns null when tokens missing model', () => {
    expect(p.calculateCost({ inputTokens: 5 })).toBeNull()
    expect(p.calculateCost(null)).toBeNull()
  })
})

describe('GroqProvider', () => {
  const p = new GroqProvider(loadPricing('groq'))

  it('extracts tokens from x_groq.usage chunk', () => {
    const buf = Buffer.from(
      'data: {"model":"llama-3.3-70b-versatile","x_groq":{"usage":{"prompt_tokens":11,"completion_tokens":4,"total_tokens":15}}}\n' +
        'data: [DONE]\n',
    )
    expect(p.extractTokens(buf)).toMatchObject({
      model: 'llama-3.3-70b-versatile',
      inputTokens: 11,
      outputTokens: 4,
      totalTokens: 15,
    })
  })

  it('falls through to OpenAI extraction when no x_groq', () => {
    const buf = Buffer.from(
      JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    )
    expect(p.extractTokens(buf)).toMatchObject({ inputTokens: 1, outputTokens: 2 })
  })

  it('catch block falls through on malformed SSE', () => {
    const buf = Buffer.from('data: {malformed\n')
    expect(p.extractTokens(buf)).toBeNull()
  })
})

describe('OllamaProvider edge', () => {
  const p = new OllamaProvider(loadPricing('ollama'))

  it('calculateCost returns null when no model', () => {
    expect(p.calculateCost(null)).toBeNull()
    expect(p.calculateCost({ inputTokens: 10 })).toBeNull()
  })
})

describe('GoogleProvider edge cases', () => {
  const p = new GoogleProvider(loadPricing('google'))

  it('returns null on malformed buffer', () => {
    expect(p.extractTokens(Buffer.from('not json'))).toBeNull()
  })

  it('returns null when usageMetadata missing', () => {
    expect(
      p.extractTokens(Buffer.from(JSON.stringify({ modelVersion: 'gemini-1.5-pro' }))),
    ).toBeNull()
  })

  it('calculateCost returns null without model', () => {
    expect(p.calculateCost(null)).toBeNull()
    expect(p.calculateCost({ inputTokens: 1 })).toBeNull()
  })

  it('calculateCost returns null for unknown model', () => {
    expect(
      p.calculateCost({ model: 'gemini-unknown-zzz', inputTokens: 10, outputTokens: 5 }),
    ).toBeNull()
  })
})
