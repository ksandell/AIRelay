import fs from 'node:fs'
import { config } from '../config.js'
import { loadProvider } from '../providers/registry.js'

/**
 * Routes registry (v0.4.0).
 *
 * Builds the per-prefix routing table the proxy uses to dispatch requests.
 * Sources are consulted in priority order:
 *
 *   1. `PROXY_ROUTES` env var — inline JSON, highest priority (override).
 *   2. `ROUTES_CONFIG_PATH` env var — path to a JSON file.
 *   3. Fallback: a single route built from `UPSTREAM_URL` + `PROXY_PATH_PREFIX`
 *      + `PROXY_PROVIDER` so v0.3.0 deployments work without changes.
 *
 * Route shape (after loading + validation):
 *   {
 *     prefix:           string  // e.g. '/proxy/anthropic'
 *     upstream:         string  // e.g. 'https://api.anthropic.com'
 *     provider:         string  // pricing/parser key (e.g. 'anthropic')
 *     trustForwarded:   boolean // per-route override of PROXY_TRUST_FORWARDED
 *     providerInstance: object  // loaded provider instance (token tracking)
 *   }
 *
 * Routes are sorted by descending prefix length so `/proxy/anthropic` matches
 * before a more permissive `/proxy`. The proxy handler scans this sorted list.
 */

function parseInline(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed) return null
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.routes)) return parsed.routes
    return null
  } catch (err) {
    throw new Error(`failed to parse PROXY_ROUTES JSON: ${err.message}`, { cause: err })
  }
}

function loadFromFile(path) {
  let raw
  try {
    raw = fs.readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`failed to read ROUTES_CONFIG_PATH=${path}: ${err.message}`, { cause: err })
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`failed to parse ROUTES_CONFIG_PATH=${path}: ${err.message}`, { cause: err })
  }
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed.routes)) return parsed.routes
  throw new Error(`ROUTES_CONFIG_PATH=${path} must contain an array or { routes: [...] }`)
}

function normalize(r) {
  if (!r || typeof r !== 'object') throw new Error('route entry must be an object')
  if (typeof r.prefix !== 'string' || !r.prefix.startsWith('/')) {
    throw new Error(
      `route.prefix must be a string starting with "/", got: ${JSON.stringify(r.prefix)}`,
    )
  }
  if (typeof r.upstream !== 'string' || !/^https?:\/\//.test(r.upstream)) {
    throw new Error(`route.upstream must be an http(s) URL, got: ${JSON.stringify(r.upstream)}`)
  }
  return {
    prefix: r.prefix.replace(/\/+$/, ''), // drop trailing slash
    upstream: r.upstream.replace(/\/+$/, ''),
    provider: r.provider ?? 'generic',
    trustForwarded:
      typeof r.trustForwarded === 'boolean' ? r.trustForwarded : config.proxyTrustForwarded,
  }
}

let cache = null

function build() {
  let raw
  // env vars are read at build time (not config-frozen) so a test or operator
  // can rotate them without re-importing config. dotenv has already populated
  // process.env in dev; in prod Docker injects them directly.
  const inlineRoutes = process.env.PROXY_ROUTES
  const routesPath = process.env.ROUTES_CONFIG_PATH
  const legacyUpstream = process.env.UPSTREAM_URL
  const legacyPrefix = process.env.PROXY_PATH_PREFIX ?? '/proxy'
  const legacyProvider = process.env.PROXY_PROVIDER ?? 'generic'

  if (inlineRoutes) {
    raw = parseInline(inlineRoutes)
    if (!raw) throw new Error('PROXY_ROUTES must be a JSON array or { "routes": [...] } object')
  } else if (routesPath) {
    raw = loadFromFile(routesPath)
  } else if (legacyUpstream) {
    // Backwards-compat: synthesize a single route from the v0.3.0 env vars.
    raw = [
      {
        prefix: legacyPrefix,
        upstream: legacyUpstream,
        provider: legacyProvider,
        trustForwarded: config.proxyTrustForwarded,
      },
    ]
  } else {
    // No upstream configured at all — proxy disabled.
    return []
  }

  const normalized = raw.map(normalize)

  // Reject overlapping (exactly equal) prefixes so misconfig fails loud.
  const seen = new Set()
  for (const r of normalized) {
    if (seen.has(r.prefix)) {
      throw new Error(`duplicate route prefix: ${r.prefix}`)
    }
    seen.add(r.prefix)
  }

  // Attach the provider instance (used by the proxy for token tracking).
  // Loaded once at startup so the hot path is allocation-free.
  for (const r of normalized) {
    r.providerInstance = config.proxyTokenTracking
      ? loadProvider(r.provider, config.pricingConfigPath)
      : null
  }

  // Sort by descending prefix length so longer matches win.
  normalized.sort((a, b) => b.prefix.length - a.prefix.length)
  return normalized
}

export function getRoutes() {
  if (cache === null) cache = build()
  return cache
}

export function routeForPath(urlPath) {
  for (const r of getRoutes()) {
    if (urlPath === r.prefix || urlPath.startsWith(r.prefix + '/')) return r
  }
  return null
}

// Test-only — invalidate cache when env vars change mid-run.
export function _resetRoutes() {
  cache = null
}
