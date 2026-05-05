import { describe, it, expect } from 'vitest'
import { GenericProvider } from '../../src/providers/generic.js'

describe('GenericProvider', () => {
  const p = new GenericProvider({})

  it('name is "generic"', () => expect(p.name).toBe('generic'))
  it('extractTokens returns null for any buffer', () => expect(p.extractTokens(Buffer.from('anything'))).toBeNull())
  it('calculateCost returns null', () => expect(p.calculateCost(null)).toBeNull())
})
