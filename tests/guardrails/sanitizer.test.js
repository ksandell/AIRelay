import { describe, it, expect } from 'vitest'
import { sanitize, sanitizeUrl } from '../../src/guardrails/sanitizer.js'

describe('sanitize', () => {
  it('redacts AWS access keys', () => {
    const out = sanitize('using key AKIAIOSFODNN7EXAMPLE in code')
    expect(out).toContain('<redacted:aws-access-key>')
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('redacts GitHub PATs', () => {
    const tok = 'ghp_' + 'A'.repeat(36)
    expect(sanitize(`auth: ${tok}`)).toContain('<redacted:github-pat>')
  })

  it('redacts Anthropic keys', () => {
    const tok = 'sk-ant-' + 'a'.repeat(40)
    expect(sanitize(tok)).toContain('<redacted:anthropic-key>')
  })

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdef123456'
    expect(sanitize(jwt)).toContain('<redacted:jwt>')
  })

  it('redacts Bearer tokens', () => {
    const out = sanitize('Authorization: Bearer abc123def456ghi789jkl012mno345')
    expect(out).toContain('<redacted:bearer>')
  })

  it('passes through clean strings unchanged', () => {
    expect(sanitize('plain log line: 200 OK in 42ms')).toBe('plain log line: 200 OK in 42ms')
  })

  it('handles null/undefined', () => {
    expect(sanitize(null)).toBe(null)
    expect(sanitize(undefined)).toBe(undefined)
  })

  it('sanitizes query strings without touching path', () => {
    const tok = 'sk-ant-' + 'b'.repeat(40)
    const out = sanitizeUrl(`/proxy/v1/messages?api_key=${tok}&model=foo`)
    expect(out).toContain('/proxy/v1/messages?')
    expect(out).toContain('<redacted:anthropic-key>')
    expect(out).toContain('model=foo')
  })

  it('leaves URLs without query strings unchanged', () => {
    expect(sanitizeUrl('/proxy/v1/messages')).toBe('/proxy/v1/messages')
  })
})
