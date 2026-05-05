import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadPricing } from '../../src/providers/pricing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const openaiSyncBuf = readFileSync(join(__dirname, 'fixtures/openai-sync.json'))

const COMPAT_PROVIDERS = [
  {
    name: 'mistral',
    file: '../../src/providers/mistral.js',
    cls: 'MistralProvider',
    model: 'mistral-large-latest',
  },
  {
    name: 'groq',
    file: '../../src/providers/groq.js',
    cls: 'GroqProvider',
    model: 'llama-3.3-70b-versatile',
  },
  {
    name: 'microsoft',
    file: '../../src/providers/microsoft.js',
    cls: 'MicrosoftProvider',
    model: 'gpt-4o',
  },
  {
    name: 'openrouter',
    file: '../../src/providers/openrouter.js',
    cls: 'OpenRouterProvider',
    model: 'openai/gpt-4o',
  },
  {
    name: 'together',
    file: '../../src/providers/together.js',
    cls: 'TogetherProvider',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  {
    name: 'fireworks',
    file: '../../src/providers/fireworks.js',
    cls: 'FireworksProvider',
    model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  },
  {
    name: 'deepseek',
    file: '../../src/providers/deepseek.js',
    cls: 'DeepSeekProvider',
    model: 'deepseek-chat',
  },
  { name: 'xai', file: '../../src/providers/xai.js', cls: 'XAIProvider', model: 'grok-2' },
  {
    name: 'perplexity',
    file: '../../src/providers/perplexity.js',
    cls: 'PerplexityProvider',
    model: 'llama-3.1-sonar-large-128k-online',
  },
  { name: 'ollama', file: '../../src/providers/ollama.js', cls: 'OllamaProvider', model: 'llama3' },
  {
    name: 'nvidia',
    file: '../../src/providers/nvidia.js',
    cls: 'NvidiaProvider',
    model: 'meta/llama-3.1-70b-instruct',
  },
]

for (const { name, file, cls, model } of COMPAT_PROVIDERS) {
  describe(`${cls}`, async () => {
    const mod = await import(file)
    const p = new mod[cls](loadPricing(name))

    it(`name is "${name}"`, () => expect(p.name).toBe(name))

    it('extracts tokens from OpenAI-shaped sync body', () => {
      const body = Buffer.from(JSON.stringify({ ...JSON.parse(openaiSyncBuf), model }))
      expect(p.extractTokens(body)).toMatchObject({
        model,
        inputTokens: 25,
        outputTokens: 10,
        totalTokens: 35,
      })
    })

    it('returns null for malformed buffer', () => {
      expect(p.extractTokens(Buffer.from('not json'))).toBeNull()
    })

    if (name === 'ollama') {
      it('calculateCost returns 0 for any model (local = free)', () => {
        expect(
          p.calculateCost({ model: 'any-model', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
        ).toBe(0)
      })
    }
  })
}
