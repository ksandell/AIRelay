import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import dotenv from 'dotenv'

// Parse-equivalence sweep across the env surface AIRelay actually reads:
//   - .env.example (the canonical operator-facing template)
//   - inline JSON values used by PROXY_ROUTES + GUARDRAILS_CUSTOM_PATTERNS_FILE
//
// The intent (see issue #124) is to catch any quoting / multiline regression
// introduced by the dotenv 16 -> 17 bump.

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_EXAMPLE = resolve(__dirname, '../../.env.example')

describe('dotenv parse equivalence (.env.example)', () => {
  const raw = readFileSync(ENV_EXAMPLE, 'utf8')
  const parsed = dotenv.parse(raw)

  it('parses without throwing and yields a non-empty result', () => {
    expect(Object.keys(parsed).length).toBeGreaterThan(20)
  })

  it('preserves critical hot-path defaults verbatim', () => {
    // These values are referenced by code paths the proxy depends on; if dotenv
    // ever started trimming, quoting, or expanding them, behavior would shift.
    expect(parsed.PORT).toBe('3000')
    expect(parsed.BIND_HOST).toBe('0.0.0.0')
    expect(parsed.TZ).toBe('UTC')
    expect(parsed.PROXY_PATH_PREFIX).toBe('/proxy')
    expect(parsed.PROXY_PROVIDER).toBe('generic')
    expect(parsed.PROXY_TOKEN_TRACKING).toBe('true')
    expect(parsed.COMPACTOR_ENABLED).toBe('false')
    expect(parsed.GUARDRAILS_ENABLED).toBe('false')
  })

  it('preserves cron expression with spaces and asterisks', () => {
    // CRON_SCHEDULE=0 0 * * *  — spaces are load-bearing, no quoting in source.
    expect(parsed.CRON_SCHEDULE).toBe('0 0 * * *')
  })

  it('preserves URLs with colons and slashes', () => {
    expect(parsed.PUBLIC_BASE_URL).toBe('http://airelay.local:3000')
  })

  it('treats # at column 0 as a comment, not a value', () => {
    expect(parsed['#']).toBeUndefined()
  })

  it('treats unset UPSTREAM_URL as empty string (proxy-disabled sentinel)', () => {
    expect(parsed.UPSTREAM_URL).toBe('')
  })
})

describe('dotenv parse equivalence (inline JSON envelopes)', () => {
  // PROXY_ROUTES and GUARDRAILS_CUSTOM_PATTERNS_FILE are documented inline-JSON
  // env values. Confirm dotenv 17 round-trips them byte-identically when wrapped
  // in single quotes (the documented form).

  it('round-trips a multi-route PROXY_ROUTES JSON value', () => {
    const json =
      '{"routes":[{"prefix":"/proxy/anthropic","upstream":"https://api.anthropic.com","provider":"anthropic"},{"prefix":"/proxy/openai","upstream":"https://api.openai.com/v1","provider":"openai"}]}'
    const line = `PROXY_ROUTES='${json}'`
    const parsed = dotenv.parse(line)
    expect(parsed.PROXY_ROUTES).toBe(json)
    // And the round-tripped value must itself parse as JSON.
    expect(() => JSON.parse(parsed.PROXY_ROUTES)).not.toThrow()
  })

  it('round-trips a custom-patterns inline JSON file path with spaces', () => {
    // Quoted values with embedded spaces must survive — operators put files in
    // paths like /etc/airelay/custom patterns.json (rare but valid on macOS).
    const line = 'GUARDRAILS_CUSTOM_PATTERNS_FILE="/etc/airelay/custom patterns.json"'
    const parsed = dotenv.parse(line)
    expect(parsed.GUARDRAILS_CUSTOM_PATTERNS_FILE).toBe('/etc/airelay/custom patterns.json')
  })

  it('preserves regex backslashes inside a single-quoted PROXY_ROUTES JSON', () => {
    // dotenv 17 changed escape behavior in *double*-quoted values; single
    // quotes must remain literal. Custom-pattern regexes often contain \b, \d.
    const json = '[{"name":"my-secret","category":"secrets","regex":"FOO_[A-Z0-9]{20}"}]'
    const line = `GUARDRAILS_CUSTOM_PATTERNS='${json}'`
    const parsed = dotenv.parse(line)
    expect(parsed.GUARDRAILS_CUSTOM_PATTERNS).toBe(json)
  })
})
