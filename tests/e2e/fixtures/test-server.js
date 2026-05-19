/**
 * Boot script for Playwright `webServer`. Spawns:
 *   1. A deterministic fake upstream on a random port that mimics Mistral/OpenAI
 *      response shapes so the provider parser populates tokens + cost.
 *   2. AIRelay (createApp) on PORT (default 3100) pointing at the fake upstream.
 *
 * Designed to run in-process. No Docker, no real LLM, no network.
 *
 * Exits cleanly on SIGINT/SIGTERM so Playwright can tear it down between runs.
 */

import http from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const PORT = parseInt(process.env.PORT ?? '3100', 10)

// Deterministic responses, keyed by request path. Mistral OpenAI-compatible
// chat completion shape — provider parser extracts tokens + costs.
function buildResponse(body) {
  const isStream = body && body.stream === true
  if (isStream) {
    // Minimal SSE stream
    const id = 'cmpl-test-' + Math.random().toString(36).slice(2, 10)
    return {
      isStream: true,
      lines: [
        `data: {"id":"${id}","object":"chat.completion.chunk","model":"mistral-small-latest","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"}}]}`,
        `data: {"id":"${id}","object":"chat.completion.chunk","model":"mistral-small-latest","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}`,
        `data: [DONE]`,
      ],
    }
  }
  return {
    isStream: false,
    body: {
      id: 'cmpl-test-' + Math.random().toString(36).slice(2, 10),
      object: 'chat.completion',
      created: 1715000000,
      model: 'mistral-small-latest',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi there' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
    },
  }
}

async function startFakeUpstream() {
  const server = http.createServer((req, res) => {
    let raw = Buffer.alloc(0)
    req.on('data', (c) => {
      raw = Buffer.concat([raw, c])
    })
    req.on('end', () => {
      let body = null
      try {
        body = raw.length ? JSON.parse(raw.toString('utf8')) : null
      } catch {
        body = null
      }
      const r = buildResponse(body)
      if (r.isStream) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        for (const line of r.lines) res.write(line + '\n\n')
        res.end()
      } else {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r.body))
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}

async function main() {
  const upstream = await startFakeUpstream()
  const upstreamPort = upstream.address().port

  // Configure AIRelay env BEFORE importing (config is captured at module load).
  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.PROXY_PROVIDER = 'mistral'
  process.env.PROXY_TOKEN_TRACKING = 'true'
  process.env.NODE_ENV = 'test'
  process.env.LOG_SINK = 'noop'
  process.env.METRICS_TICK_MS = '500'
  // Compactor: enabled so its tab has live data; tests can still send X-Compactor: off.
  process.env.COMPACTOR_ENABLED = process.env.COMPACTOR_ENABLED ?? 'true'

  const { createApp } = await import('../../../src/server.js')
  const { startMetricsBroadcaster } = await import('../../../src/metrics/broadcaster.js')
  const app = createApp()
  startMetricsBroadcaster()

  const server = app.listen(PORT, '127.0.0.1', () => {
    // Playwright waits on this URL — emit a marker for human runs too.
    // eslint-disable-next-line no-console
    console.log(`[e2e] AIRelay on http://127.0.0.1:${PORT} -> upstream :${upstreamPort}`)
  })

  const shutdown = () => {
    server.close(() => upstream.close(() => process.exit(0)))
    // Hard timeout
    setTimeout(() => process.exit(0), 2000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[e2e] startup failed:', err)
    process.exit(1)
  })
}
