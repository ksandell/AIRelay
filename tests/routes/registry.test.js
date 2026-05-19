import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let original

beforeEach(() => {
  original = {
    PROXY_ROUTES: process.env.PROXY_ROUTES,
    ROUTES_CONFIG_PATH: process.env.ROUTES_CONFIG_PATH,
    UPSTREAM_URL: process.env.UPSTREAM_URL,
    PROXY_PATH_PREFIX: process.env.PROXY_PATH_PREFIX,
    PROXY_PROVIDER: process.env.PROXY_PROVIDER,
    PROXY_TOKEN_TRACKING: process.env.PROXY_TOKEN_TRACKING,
  }
  process.env.PROXY_TOKEN_TRACKING = 'false'
})

afterEach(async () => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function fresh() {
  const mod = await import('../../src/routes/registry.js')
  mod._resetRoutes()
  return mod
}

describe('routes/registry', () => {
  it('synthesizes a single route from legacy env vars', async () => {
    process.env.UPSTREAM_URL = 'https://api.anthropic.com'
    process.env.PROXY_PATH_PREFIX = '/proxy'
    process.env.PROXY_PROVIDER = 'anthropic'
    delete process.env.PROXY_ROUTES
    delete process.env.ROUTES_CONFIG_PATH
    const { getRoutes } = await fresh()
    const routes = getRoutes()
    expect(routes).toHaveLength(1)
    expect(routes[0].prefix).toBe('/proxy')
    expect(routes[0].upstream).toBe('https://api.anthropic.com')
    expect(routes[0].provider).toBe('anthropic')
  })

  it('parses inline PROXY_ROUTES JSON', async () => {
    process.env.PROXY_ROUTES = JSON.stringify({
      routes: [
        {
          prefix: '/proxy/anthropic',
          upstream: 'https://api.anthropic.com',
          provider: 'anthropic',
        },
        { prefix: '/proxy/openai', upstream: 'https://api.openai.com/v1', provider: 'openai' },
      ],
    })
    delete process.env.ROUTES_CONFIG_PATH
    const { getRoutes } = await fresh()
    const routes = getRoutes()
    expect(routes).toHaveLength(2)
    expect(routes.map((r) => r.prefix)).toEqual(['/proxy/anthropic', '/proxy/openai'])
  })

  it('loads routes from a config file when ROUTES_CONFIG_PATH is set', async () => {
    const tmp = path.join(os.tmpdir(), `airelay-routes-${Date.now()}.json`)
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        routes: [{ prefix: '/proxy/a', upstream: 'http://a.local', provider: 'generic' }],
      }),
    )
    delete process.env.PROXY_ROUTES
    process.env.ROUTES_CONFIG_PATH = tmp
    try {
      const { getRoutes } = await fresh()
      const routes = getRoutes()
      expect(routes).toHaveLength(1)
      expect(routes[0].upstream).toBe('http://a.local')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('PROXY_ROUTES wins over ROUTES_CONFIG_PATH', async () => {
    const tmp = path.join(os.tmpdir(), `airelay-routes-${Date.now()}.json`)
    fs.writeFileSync(
      tmp,
      JSON.stringify({ routes: [{ prefix: '/file', upstream: 'http://file.local' }] }),
    )
    process.env.PROXY_ROUTES = JSON.stringify([
      { prefix: '/env', upstream: 'http://env.local', provider: 'generic' },
    ])
    process.env.ROUTES_CONFIG_PATH = tmp
    try {
      const { getRoutes } = await fresh()
      const routes = getRoutes()
      expect(routes).toHaveLength(1)
      expect(routes[0].prefix).toBe('/env')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('sorts by descending prefix length so longer matches win', async () => {
    process.env.PROXY_ROUTES = JSON.stringify([
      { prefix: '/proxy', upstream: 'http://a.local' },
      { prefix: '/proxy/anthropic', upstream: 'http://b.local' },
    ])
    delete process.env.ROUTES_CONFIG_PATH
    const { getRoutes, routeForPath } = await fresh()
    const routes = getRoutes()
    expect(routes[0].prefix).toBe('/proxy/anthropic')
    expect(routeForPath('/proxy/anthropic/v1/messages').upstream).toBe('http://b.local')
    expect(routeForPath('/proxy/v1/messages').upstream).toBe('http://a.local')
  })

  it('rejects duplicate prefixes', async () => {
    process.env.PROXY_ROUTES = JSON.stringify([
      { prefix: '/proxy', upstream: 'http://a.local' },
      { prefix: '/proxy/', upstream: 'http://b.local' },
    ])
    delete process.env.ROUTES_CONFIG_PATH
    const { getRoutes } = await fresh()
    expect(() => getRoutes()).toThrow(/duplicate route prefix/)
  })

  it('rejects malformed upstream URLs', async () => {
    process.env.PROXY_ROUTES = JSON.stringify([{ prefix: '/proxy', upstream: 'not-a-url' }])
    delete process.env.ROUTES_CONFIG_PATH
    const { getRoutes } = await fresh()
    expect(() => getRoutes()).toThrow(/upstream must be an http\(s\) URL/)
  })

  it('returns empty array when no routes and no UPSTREAM_URL', async () => {
    delete process.env.PROXY_ROUTES
    delete process.env.ROUTES_CONFIG_PATH
    delete process.env.UPSTREAM_URL
    const { getRoutes } = await fresh()
    expect(getRoutes()).toEqual([])
  })
})
