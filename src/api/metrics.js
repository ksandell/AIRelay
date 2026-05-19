import { Router } from 'express'
import { recent, snapshot, getInFlight } from '../metrics/collector.js'
import { summary } from '../metrics/aggregator.js'
import { addMetricsClient, metricsClientCount } from '../metrics/broadcaster.js'
import {
  isOpen as storeIsOpen,
  queryRange as storeQueryRange,
  rollups as storeRollups,
} from '../metrics/store.js'
import { getRoutes } from '../routes/registry.js'
import { config } from '../config.js'

const router = Router()

router.get('/api/metrics/summary', (req, res) => {
  res.json({
    ...snapshot(),
    inFlight: getInFlight(),
    sseClients: metricsClientCount(),
    windows: summary(),
  })
})

router.get('/api/metrics/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '200', 10), config.maxApiResultRows)
  res.json(recent(limit))
})

router.get('/api/metrics/models', (req, res) => {
  const events = recent(config.maxMetricEvents)
  const groups = new Map()
  for (const ev of events) {
    if (!ev || ev.model == null) continue
    let g = groups.get(ev.model)
    if (!g) {
      g = {
        model: ev.model,
        provider: ev.provider ?? null,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }
      groups.set(ev.model, g)
    }
    g.requests++
    g.inputTokens += ev.inputTokens ?? 0
    g.outputTokens += ev.outputTokens ?? 0
    g.costUsd += ev.costUsd ?? 0
  }
  const out = Array.from(groups.values())
    .map((g) => ({ ...g, costUsd: Math.round(g.costUsd * 1e6) / 1e6 }))
    .sort((a, b) => b.costUsd - a.costUsd)
  res.json(out)
})

// v0.4.0 — multi-upstream support
router.get('/api/metrics/routes', (req, res) => {
  res.json(
    getRoutes().map((r) => ({
      prefix: r.prefix,
      upstream: r.upstream,
      provider: r.provider,
    })),
  )
})

// v0.4.0 — SQLite history. Returns 503 + helpful message when persistence
// is disabled rather than silently returning the ring buffer (different
// semantics).
function parseRange(q) {
  const to = q.to ? new Date(q.to) : new Date()
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3600_000)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('invalid from/to — must be ISO-8601')
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

router.get('/api/metrics/history', (req, res) => {
  if (!storeIsOpen()) {
    return res.status(503).json({
      error: 'persistence disabled — set METRICS_DB_PATH to enable history queries',
    })
  }
  let range
  try {
    range = parseRange(req.query)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  const limit = Math.min(parseInt(req.query.limit ?? '5000', 10), config.maxApiResultRows)
  const events = storeQueryRange({
    ...range,
    route: req.query.route || null,
    model: req.query.model || null,
    limit,
  })
  res.json({ ...range, count: events.length, events })
})

// v0.4.0 — bucketed rollups (hour | day | week)
const VALID_PERIODS = new Set(['minute', '5min', '15min', 'hour', 'day', 'week'])
router.get('/api/metrics/rollups', (req, res) => {
  if (!storeIsOpen()) {
    return res.status(503).json({
      error: 'persistence disabled — set METRICS_DB_PATH to enable rollups',
    })
  }
  const period = (req.query.period ?? 'day').toLowerCase()
  if (!VALID_PERIODS.has(period)) {
    return res.status(400).json({ error: `period must be one of ${[...VALID_PERIODS].join('|')}` })
  }
  let range
  try {
    range = parseRange(req.query)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  const buckets = storeRollups({
    period,
    ...range,
    route: req.query.route || null,
    model: req.query.model || null,
  })
  res.json({ period, ...range, buckets })
})

// v0.4.0 — CSV export
const CSV_COLUMNS = [
  'ts',
  'method',
  'path',
  'status',
  'durationMs',
  'bytesIn',
  'bytesOut',
  'upstream',
  'route',
  'error',
  'provider',
  'model',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'costUsd',
  'toolCalls',
  'toolBytesIn',
  'toolBytesOut',
]

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

router.get('/api/metrics/export.csv', (req, res) => {
  const events = storeIsOpen()
    ? (() => {
        let range
        try {
          range = parseRange(req.query)
        } catch {
          return []
        }
        return storeQueryRange({
          ...range,
          route: req.query.route || null,
          model: req.query.model || null,
          limit: Math.min(parseInt(req.query.limit ?? '50000', 10), 100_000),
        })
      })()
    : recent(config.maxMetricEvents)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="airelay-metrics-${new Date().toISOString().slice(0, 10)}.csv"`,
  )
  res.write(CSV_COLUMNS.join(',') + '\n')
  for (const ev of events) {
    if (!ev) continue
    res.write(CSV_COLUMNS.map((c) => csvEscape(ev[c])).join(',') + '\n')
  }
  res.end()
})

router.get('/api/metrics/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write('retry: 5000\n\n')
  addMetricsClient(res)
})

export default router
