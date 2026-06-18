import { createHash } from 'node:crypto'

const STRIP_KEYS = new Set(['stream', 'user'])

export function normalizeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const out = {}
  for (const [k, v] of Object.entries(body)) {
    if (!STRIP_KEYS.has(k)) out[k] = v
  }
  return out
}

export function hashBody(body) {
  const normalized = normalizeBody(body)
  const canonical = canonicalJSON(normalized)
  return createHash('sha256').update(canonical).digest('hex')
}

function canonicalJSON(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj)
  if (typeof obj !== 'object' || Array.isArray(obj)) return JSON.stringify(obj)

  const keys = Object.keys(obj).sort()
  const pairs = keys.map((k) => `"${k}":${canonicalJSON(obj[k])}`)
  return '{' + pairs.join(',') + '}'
}
