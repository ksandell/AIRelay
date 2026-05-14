import { describe, it, expect } from 'vitest'
import { runPipeline } from '../../src/compactor/pipeline.js'
import { BANNER_PREFIX } from '../../src/compactor/banner.js'

describe('runPipeline', () => {
  it('returns input unchanged when no compressor fires', () => {
    const r = runPipeline('plain short text')
    expect(r.text).toBe('plain short text')
    expect(r.fires).toHaveLength(0)
  })

  it('prepends a banner when at least one compressor fires', () => {
    const input = 'a\n\n\n\n\nb'
    const r = runPipeline(input)
    expect(r.fires.length).toBeGreaterThan(0)
    expect(r.text.startsWith(BANNER_PREFIX)).toBe(true)
  })

  it('reports per-compressor fire stats', () => {
    const ESC = String.fromCharCode(27)
    const input = `${ESC}[31mhello${ESC}[0m\n\n\n\nworld`
    const r = runPipeline(input)
    const names = r.fires.map((f) => f.name)
    expect(names).toContain('ansi-strip')
    expect(names).toContain('blankline-collapse')
  })
})
