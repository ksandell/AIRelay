import { describe, it, expect } from 'vitest'
import { normalizeBody, hashBody } from '../../src/cache/normalize.js'

describe('normalizeBody', () => {
  it('strips stream field', () => {
    const result = normalizeBody({ model: 'claude-3', stream: true, messages: [] })
    expect(result).not.toHaveProperty('stream')
    expect(result).toHaveProperty('model', 'claude-3')
  })

  it('strips user field', () => {
    const result = normalizeBody({ model: 'gpt-4', user: 'user-123', messages: [] })
    expect(result).not.toHaveProperty('user')
  })

  it('keeps model, messages, tools, temperature, max_tokens', () => {
    const body = {
      model: 'claude-3',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      max_tokens: 100,
    }
    const result = normalizeBody(body)
    expect(result).toMatchObject(body)
  })

  it('returns non-object unchanged', () => {
    expect(normalizeBody(null)).toBeNull()
    expect(normalizeBody('string')).toBe('string')
  })
})

describe('hashBody', () => {
  it('returns 64-char hex string', () => {
    const h = hashBody({ model: 'claude-3', messages: [] })
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it('same body → same hash', () => {
    const body = { model: 'claude-3', messages: [{ role: 'user', content: 'hello' }] }
    expect(hashBody(body)).toBe(hashBody(body))
  })

  it('different body → different hash', () => {
    const h1 = hashBody({ model: 'claude-3', messages: [{ role: 'user', content: 'hello' }] })
    const h2 = hashBody({ model: 'claude-3', messages: [{ role: 'user', content: 'world' }] })
    expect(h1).not.toBe(h2)
  })

  it('stream field does not affect hash', () => {
    const h1 = hashBody({ model: 'claude-3', messages: [], stream: false })
    const h2 = hashBody({ model: 'claude-3', messages: [], stream: true })
    expect(h1).toBe(h2)
  })

  it('key order does not affect hash', () => {
    const h1 = hashBody({ model: 'a', messages: [] })
    const h2 = hashBody({ messages: [], model: 'a' })
    expect(h1).toBe(h2)
  })
})
