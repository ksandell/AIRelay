/**
 * Pure sanitizer for log lines, error messages, and URL query strings.
 *
 * Strips obvious secret-shaped tokens before strings are persisted to disk,
 * streamed over SSE, or surfaced on the dashboard. Independent of the
 * request-body Guardrails middleware: this is always-on and zero-config.
 *
 * Patterns intentionally overlap the Guardrails registry for secrets — same
 * shape, separate code path so log sanitization works even when
 * GUARDRAILS_ENABLED=false.
 */

const PATTERNS = [
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'github-pat', re: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', re: /\bsk-(?!ant-)[A-Za-z0-9]{32,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  // bearer tokens in Authorization-like strings
  { name: 'bearer', re: /\b(?:Bearer|Token)\s+[A-Za-z0-9._\-+/=]{16,}/gi },
]

export function sanitize(input) {
  if (input == null) return input
  let s = String(input)
  for (const p of PATTERNS) {
    s = s.replace(p.re, `<redacted:${p.name}>`)
  }
  return s
}

/**
 * Sanitize a URL: strip secret-shaped values from the query string while
 * leaving the path intact. Falls back to whole-string sanitize on parse error.
 */
export function sanitizeUrl(url) {
  if (!url) return url
  const q = url.indexOf('?')
  if (q === -1) return url
  const path = url.slice(0, q)
  const query = url.slice(q + 1)
  const parts = query.split('&').map((kv) => {
    const eq = kv.indexOf('=')
    if (eq === -1) return kv
    const k = kv.slice(0, eq)
    const v = kv.slice(eq + 1)
    return `${k}=${sanitize(v)}`
  })
  return `${path}?${parts.join('&')}`
}
