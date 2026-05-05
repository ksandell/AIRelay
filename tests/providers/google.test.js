import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { GoogleProvider } from '../../src/providers/google.js'
import { loadPricing } from '../../src/providers/pricing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fix = (f) => readFileSync(join(__dirname, 'fixtures', f))

describe('GoogleProvider', () => {
  const p = new GoogleProvider(loadPricing('google'))

  it('name is "google"', () => expect(p.name).toBe('google'))

  it('extracts tokens from sync response', () => {
    expect(p.extractTokens(fix('google-sync.json'))).toMatchObject({
      model: 'gemini-2.0-flash',
      inputTokens: 25,
      outputTokens: 10,
      totalTokens: 35,
    })
  })

  it('returns null for invalid JSON', () => {
    expect(p.extractTokens(Buffer.from('not json'))).toBeNull()
  })

  it('returns null when usageMetadata missing', () => {
    expect(
      p.extractTokens(Buffer.from('{"candidates":[],"modelVersion":"gemini-2.0-flash"}')),
    ).toBeNull()
  })

  it('calculates cost (1M tokens each — $0.10 input + $0.40 output = $0.50)', () => {
    expect(
      p.calculateCost({
        model: 'gemini-2.0-flash',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.5, 4)
  })

  it('calculateCost returns null for unknown model', () => {
    expect(p.calculateCost({ model: 'gemini-99', inputTokens: 100, outputTokens: 50 })).toBeNull()
  })

  describe('extractToolCalls', () => {
    it('counts functionCall in response', () => {
      const resp = Buffer.from(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'get_weather', args: { city: 'Oslo' } } }],
              },
            },
          ],
        }),
      )
      const out = p.extractToolCalls(null, resp)
      expect(out).toMatchObject({ toolCalls: 1 })
      expect(out.toolBytesOut).toBeGreaterThan(0)
    })

    it('counts functionResponse parts in request', () => {
      const req = Buffer.from(
        JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ functionResponse: { name: 'get_weather', response: { temp: 72 } } }],
            },
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
          Buffer.from('{"contents":[{"parts":[{"text":"hi"}]}]}'),
          Buffer.from('{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}'),
        ),
      ).toBeNull()
    })
  })
})
