import fs from 'node:fs'
import { config } from '../config.js'

/**
 * Detector contract.
 *
 *   name       unique kebab-case identifier (used in metrics + redaction marker)
 *   category   'secrets' | 'pii' | 'injection'
 *   regex      RegExp with the `g` flag; matches are reported & replaceable
 *   validate   optional (match: string) => boolean; secondary check (e.g. Luhn)
 *   risky      currently informational; reserved for future use
 *
 * Detectors are pure & sync. Patterns must be anchored enough to avoid runaway
 * false positives on prose. Tight beats loose: if a pattern is noisy, default
 * it to disabled and let operators opt in.
 */

// Built-in detectors. Order matters only for redaction stability (earlier
// detectors win when ranges overlap — see middleware.js).
const BUILTIN = [
  {
    name: 'aws-access-key',
    category: 'secrets',
    key: 'awsAccessKey',
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: 'github-pat',
    category: 'secrets',
    key: 'githubPat',
    regex: /ghp_[A-Za-z0-9]{36}/g,
  },
  {
    name: 'anthropic-key',
    category: 'secrets',
    key: 'anthropicKey',
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: 'openai-key',
    category: 'secrets',
    key: 'openaiKey',
    // Anchored to "sk-" + at least 32 chars; excludes "sk-ant-" so we don't
    // double-report Anthropic keys (longer match wins via dedupe in middleware).
    regex: /\bsk-(?!ant-)[A-Za-z0-9]{32,}\b/g,
  },
  {
    name: 'private-key',
    category: 'secrets',
    key: 'privateKey',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    name: 'jwt',
    category: 'secrets',
    key: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  {
    name: 'generic-high-entropy',
    category: 'secrets',
    key: 'genericHighEntropy',
    regex: /\b[A-Za-z0-9+/=_-]{32,}\b/g,
    validate: highEntropy,
  },
  {
    name: 'email',
    category: 'pii',
    key: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    name: 'phone-e164',
    category: 'pii',
    key: 'phone',
    // E.164-ish: optional + then 8-15 digits. Boundary-anchored to skip embedded
    // numeric IDs.
    regex: /(?<![\d.])\+?[1-9]\d{7,14}(?!\d)/g,
  },
  {
    name: 'ssn-us',
    category: 'pii',
    key: 'ssnUs',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    name: 'credit-card',
    category: 'pii',
    key: 'creditCard',
    regex: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: luhn,
  },
  {
    name: 'role-override',
    category: 'injection',
    key: 'roleOverride',
    regex: /\bignore (?:all |the )?(?:previous|prior|above) (?:instructions|prompts?|rules)\b/gi,
  },
  {
    name: 'system-prompt-leak',
    category: 'injection',
    key: 'systemPromptLeak',
    regex:
      /\b(?:what is|reveal|print|show|repeat|output) (?:your |the )?system (?:prompt|message|instructions)\b/gi,
  },
  {
    name: 'tool-override',
    category: 'injection',
    key: 'toolOverride',
    regex:
      /\byou are now (?:a |an |the )?(?:different|new|new ai|new assistant|developer mode)\b/gi,
  },
]

function shannon(s) {
  const freq = {}
  for (const c of s) freq[c] = (freq[c] ?? 0) + 1
  const len = s.length
  let h = 0
  for (const c in freq) {
    const p = freq[c] / len
    h -= p * Math.log2(p)
  }
  return h
}

function highEntropy(match) {
  return shannon(match) >= 4.5
}

function luhn(match) {
  const digits = match.replace(/[^\d]/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10)
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

let customCache = null
function loadCustom() {
  if (customCache !== null) return customCache
  const path = config.guardrailsCustomPatternsFile
  if (!path) {
    customCache = []
    return customCache
  }
  try {
    const raw = fs.readFileSync(path, 'utf8')
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) throw new Error('custom patterns file must be a JSON array')
    customCache = arr.map((p) => ({
      name: String(p.name),
      category: p.category === 'pii' || p.category === 'injection' ? p.category : 'secrets',
      regex: new RegExp(p.regex, 'g'),
      risky: p.risky === true,
      custom: true,
    }))
  } catch (err) {
    // Loud-fail so misconfig is obvious at startup, not on first request.
    throw new Error(`failed to load GUARDRAILS_CUSTOM_PATTERNS_FILE=${path}: ${err.message}`)
  }
  return customCache
}

function categoryMode(category) {
  if (category === 'secrets') return config.guardrailsSecretsMode
  if (category === 'pii') return config.guardrailsPiiMode
  if (category === 'injection') return config.guardrailsInjectionMode
  return 'off'
}

/**
 * Detectors active for this request, paired with the mode their category is in.
 * Built-in detectors are gated by per-detector env toggle; custom detectors run
 * whenever their category is not 'off'.
 */
export function activeDetectors() {
  if (!config.guardrailsEnabled) return []
  const out = []
  for (const d of BUILTIN) {
    const m = categoryMode(d.category)
    if (m === 'off') continue
    if (!config.guardrails[d.key]) continue
    out.push({ ...d, mode: m })
  }
  for (const d of loadCustom()) {
    const m = categoryMode(d.category)
    if (m === 'off') continue
    out.push({ ...d, mode: m })
  }
  return out
}

export function allDetectorNames() {
  return [...BUILTIN.map((d) => d.name), ...loadCustom().map((d) => d.name)]
}

export function categoriesActive() {
  return {
    secrets: config.guardrailsSecretsMode,
    pii: config.guardrailsPiiMode,
    injection: config.guardrailsInjectionMode,
  }
}

// Test-only: invalidate the custom-patterns cache so a test can reset env vars
// mid-run and re-load.
export function _resetCustomCache() {
  customCache = null
}
