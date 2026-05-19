import { describe, it, expect } from 'vitest'
import { compactAnthropic } from '../../src/compactor/providers/anthropic.js'
import { compactOpenai } from '../../src/compactor/providers/openai.js'
import { selectCompactor } from '../../src/compactor/providers/index.js'

describe('selectCompactor', () => {
  it('routes anthropic/claude to anthropic', () => {
    expect(selectCompactor('anthropic').kind).toBe('anthropic')
    expect(selectCompactor('claude').kind).toBe('anthropic')
  })
  it('routes openai-family to openai', () => {
    expect(selectCompactor('openai').kind).toBe('openai')
    expect(selectCompactor('azure').kind).toBe('openai')
    expect(selectCompactor('mistral').kind).toBe('openai')
  })
  it('falls through to passthrough for unknown', () => {
    expect(selectCompactor('generic').kind).toBe('passthrough')
    expect(selectCompactor('unknown').kind).toBe('passthrough')
  })
})

describe('compactAnthropic', () => {
  it('mutates tool_result string content', () => {
    const ESC = String.fromCharCode(27)
    const body = {
      model: 'claude-x',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: `${ESC}[31merr${ESC}[0m\n\n\n\ndone`,
            },
          ],
        },
      ],
    }
    const r = compactAnthropic(body)
    expect(r.fires.length).toBeGreaterThan(0)
    const out = r.body.messages[0].content[0].content
    expect(out).not.toContain(ESC)
  })

  it('skips system messages by default', () => {
    const body = {
      messages: [{ role: 'system', content: 'a\n\n\n\nb\n\n\n\nc' }],
    }
    const r = compactAnthropic(body)
    expect(r.body.messages[0].content).toBe('a\n\n\n\nb\n\n\n\nc')
  })

  it('returns input untouched when not a messages body', () => {
    const body = { foo: 'bar' }
    const r = compactAnthropic(body)
    expect(r.body).toBe(body)
    expect(r.fires).toHaveLength(0)
  })
})

describe('compactOpenai', () => {
  it('mutates role:tool string content', () => {
    const body = {
      model: 'gpt-x',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'tool', tool_call_id: 't1', content: 'a\n\n\n\n\nb' },
      ],
    }
    const r = compactOpenai(body)
    expect(r.fires.length).toBeGreaterThan(0)
    expect(r.body.messages[1].content).not.toBe('a\n\n\n\n\nb')
  })

  it('handles input array form (Responses API)', () => {
    const body = {
      input: [{ role: 'tool', content: 'a\n\n\n\n\nb' }],
    }
    const r = compactOpenai(body)
    expect(r.fires.length).toBeGreaterThan(0)
    expect(r.body.input[0].content).not.toBe('a\n\n\n\n\nb')
  })
})
