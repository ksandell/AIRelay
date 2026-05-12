import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let _bundled = null

function getBundled() {
  if (!_bundled) _bundled = require('../../config/pricing.json')
  return _bundled
}

function loadOverride(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to load PRICING_CONFIG_PATH "${configPath}": ${err.message}`)
  }
}

function deepMerge(base, override) {
  const result = { ...base }
  for (const [key, val] of Object.entries(override)) {
    if (val && typeof val === 'object' && !Array.isArray(val) && typeof base[key] === 'object') {
      result[key] = deepMerge(base[key], val)
    } else {
      result[key] = val
    }
  }
  return result
}

export function loadPricing(providerName, overridePath = null) {
  let providers = getBundled().providers
  if (overridePath) {
    const override = loadOverride(overridePath)
    providers = deepMerge(providers, override.providers ?? override)
  }
  return providers[providerName] ?? {}
}

const _unknownModelWarnings = new Set()

export function _resetUnknownModelWarnings() {
  _unknownModelWarnings.clear()
}

export function lookupModelPrice(pricing, model, providerName = null) {
  if (!pricing) return null
  if (pricing[model]) return pricing[model]
  if (pricing['*']) return pricing['*']
  if (providerName && model) {
    const key = `${providerName}:${model}`
    if (!_unknownModelWarnings.has(key)) {
      _unknownModelWarnings.add(key)
      process.stderr.write(`[pricing] unknown ${key} — counting tokens only\n`)
    }
  }
  return null
}
