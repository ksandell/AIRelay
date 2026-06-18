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
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj)
  }
  const keys = Object.keys(obj).sort()
  const sorted = Object.fromEntries(keys.map((k) => [k, obj[k]]))
  return JSON.stringify(sorted, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, v[k]]),
      )
    }
    return v
  })
}
