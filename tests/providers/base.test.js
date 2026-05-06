import { describe, it, expect } from 'vitest'
import { BaseProvider } from '../../src/providers/base.js'

describe('BaseProvider', () => {
  const p = new BaseProvider({})

  it('throws on name if not overridden', () => {
    expect(() => p.name).toThrow('not implemented')
  })

  it('throws on extractTokens if not overridden', () => {
    expect(() => p.extractTokens(Buffer.from(''))).toThrow('not implemented')
  })

  it('throws on calculateCost if not overridden', () => {
    expect(() => p.calculateCost({})).toThrow('not implemented')
  })
})

describe('BaseProvider._parseJson', () => {
  const p = new (class extends BaseProvider {
    get name() {
      return 'test'
    }
    extractTokens() {
      return null
    }
    calculateCost() {
      return null
    }
  })()

  it('parses valid JSON', () => {
    const buf = Buffer.from(JSON.stringify({ a: 1 }))
    expect(p._parseJson(buf)).toEqual({ a: 1 })
  })

  it('returns null for invalid JSON', () => {
    expect(p._parseJson(Buffer.from('{bad}'))).toBeNull()
  })

  it('returns null for null buffer', () => {
    expect(p._parseJson(null)).toBeNull()
  })

  it('returns null when buffer exceeds maxBodyParseMb', () => {
    const bigBuf = Buffer.alloc(11 * 1024 * 1024) // 11 MB > default 10 MB
    expect(p._parseJson(bigBuf)).toBeNull()
  })
})
