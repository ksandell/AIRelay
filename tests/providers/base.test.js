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
