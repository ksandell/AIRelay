#!/usr/bin/env node
// Lightweight proxy perf harness. Used for ADR 0002 baseline (issue #127).
//
// What it does:
//   1. Boots an in-process fake upstream (mimics tests/e2e/fixtures/test-server.js)
//      that returns a constant ~250-byte JSON body.
//   2. Boots AIRelay createApp() pointed at the fake upstream.
//   3. Hammers /proxy with N concurrent workers for DURATION_MS, measuring
//      end-to-end latency per request.
//   4. Reports req/s, p50, p99, max-RSS.
//
// Designed to run twice (before/after a proxy-lib swap) to validate the
// tolerance gate documented in docs/adr/0002-replace-http-proxy.md.
//
// Usage: node scripts/perf-baseline.mjs [--concurrency=64] [--duration=15000]

import http from 'node:http'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const CONCURRENCY = parseInt(argv.concurrency ?? '64', 10)
const DURATION_MS = parseInt(argv.duration ?? '15000', 10)

const RESPONSE_BODY = JSON.stringify({
  id: 'cmpl-perf',
  object: 'chat.completion',
  model: 'mistral-small-latest',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
})

async function startFakeUpstream() {
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Length', Buffer.byteLength(RESPONSE_BODY))
      res.end(RESPONSE_BODY)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}

async function main() {
  const upstream = await startFakeUpstream()
  const upstreamPort = upstream.address().port

  process.env.UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.PROXY_PROVIDER = 'mistral'
  process.env.PROXY_TOKEN_TRACKING = 'true'
  process.env.NODE_ENV = 'production'
  process.env.LOG_SINK = 'noop'
  process.env.METRICS_TICK_MS = '5000'

  const { createApp } = await import('../src/server.js')
  const app = createApp()
  const proxyServer = app.listen(0, '127.0.0.1')
  await once(proxyServer, 'listening')
  const proxyPort = proxyServer.address().port

  const body = JSON.stringify({
    model: 'mistral-small-latest',
    max_tokens: 30,
    messages: [{ role: 'user', content: 'ping' }],
  })

  const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY * 2 })
  const reqOpts = {
    host: '127.0.0.1',
    port: proxyPort,
    method: 'POST',
    path: '/proxy/v1/chat/completions',
    agent,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Authorization: 'Bearer perf-fake-key',
    },
  }

  const latencies = []
  let done = 0
  let inflight = 0
  let stop = false
  let maxRss = 0

  const rssTimer = setInterval(() => {
    const r = process.memoryUsage().rss
    if (r > maxRss) maxRss = r
  }, 100)

  async function worker() {
    while (!stop) {
      const t0 = performance.now()
      inflight++
      await new Promise((resolve) => {
        const req = http.request(reqOpts, (res) => {
          res.resume()
          res.on('end', () => {
            latencies.push(performance.now() - t0)
            done++
            inflight--
            resolve()
          })
        })
        req.on('error', () => {
          inflight--
          resolve()
        })
        req.end(body)
      })
    }
  }

  // Warmup: 1s
  const warmup = Array.from({ length: CONCURRENCY }, () => worker())
  setTimeout(() => {
    latencies.length = 0
    done = 0
  }, 1000)

  setTimeout(() => {
    stop = true
  }, 1000 + DURATION_MS)

  await Promise.all(warmup)
  clearInterval(rssTimer)

  // Drain
  while (inflight > 0) await new Promise((r) => setTimeout(r, 10))

  latencies.sort((a, b) => a - b)
  const reqs = latencies.length
  const reqsPerSec = (reqs / DURATION_MS) * 1000
  const p50 = latencies[Math.floor(reqs * 0.5)]
  const p99 = latencies[Math.floor(reqs * 0.99)]

  console.log(
    JSON.stringify(
      {
        concurrency: CONCURRENCY,
        duration_ms: DURATION_MS,
        requests: reqs,
        reqs_per_sec: Number(reqsPerSec.toFixed(1)),
        latency_p50_ms: Number(p50?.toFixed(2)),
        latency_p99_ms: Number(p99?.toFixed(2)),
        max_rss_mb: Number((maxRss / 1024 / 1024).toFixed(1)),
        node: process.version,
      },
      null,
      2,
    ),
  )

  proxyServer.close()
  upstream.close()
  agent.destroy()
}

main().catch((err) => {
  console.error('perf-baseline failed:', err)
  process.exit(1)
})
