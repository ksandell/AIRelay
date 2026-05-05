import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'

let server
let port

beforeAll(async () => {
  // Reserve a port, then immediately close — almost certainly nothing is listening on it.
  const tmp = net.createServer()
  tmp.listen(0)
  await once(tmp, 'listening')
  const deadPort = tmp.address().port
  await new Promise((r) => tmp.close(r))

  process.env.UPSTREAM_URL = `http://127.0.0.1:${deadPort}`
  process.env.PROXY_PATH_PREFIX = '/proxy'
  process.env.NODE_ENV = 'test'

  const { createApp } = await import('../../src/server.js')
  const app = createApp()
  server = app.listen(0)
  await once(server, 'listening')
  port = server.address().port
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
})

beforeEach(async () => {
  const { _reset } = await import('../../src/metrics/collector.js')
  _reset()
})

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('proxy error path (upstream down)', () => {
  it('returns 502 with error JSON', async () => {
    const r = await get('/proxy/anything')
    expect(r.status).toBe(502)
    expect(JSON.parse(r.body).error).toBe('bad gateway')
  })

  it('records the failed request as a metric event with error code', async () => {
    await get('/proxy/anything')
    // Allow finalize to run on the event-loop tick
    await new Promise((r) => setImmediate(r))
    const { recent } = await import('../../src/metrics/collector.js')
    const events = recent(10)
    expect(events.length).toBe(1)
    expect(events[0].error).toBeTruthy()
    expect(events[0].status).toBe(502)
  })
})
