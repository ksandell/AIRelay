import { Router } from 'express'
import { config } from '../config.js'
import {
  lifetimeSnapshot,
  iterRecentCompactor,
  _resetCompactorMetrics,
} from '../compactor/metrics.js'
import { allCompressorNames, activeCompressors } from '../compactor/registry.js'
import { _reset as _resetMetrics } from '../metrics/collector.js'
import { _resetGuardrailsMetrics } from '../guardrails/metrics.js'
import {
  isOpen as storeIsOpen,
  queryRange as storeQueryRange,
  rollups as storeRollups,
} from '../metrics/store.js'

function parseRange(q) {
  const to = q.to ? new Date(q.to) : new Date()
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3600_000)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('invalid from/to — must be ISO-8601')
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

const VALID_PERIODS = new Set(['minute', '5min', '15min', 'hour', 'day', 'week'])

const router = Router()

function aggregate(seconds) {
  const acc = {
    requests: 0,
    bytesIn: 0,
    bytesOut: 0,
    bytesSaved: 0,
    estimatedTokensSaved: 0,
    byCompressor: {},
    bypasses: 0,
    bypassReasons: {},
  }
  for (const ev of iterRecentCompactor(seconds)) {
    if (ev.bypassReason) {
      acc.bypasses++
      acc.bypassReasons[ev.bypassReason] = (acc.bypassReasons[ev.bypassReason] ?? 0) + 1
      continue
    }
    acc.requests++
    acc.bytesIn += ev.bytesIn
    acc.bytesOut += ev.bytesOut
    acc.bytesSaved += ev.bytesSaved
    acc.estimatedTokensSaved += ev.estimatedTokensSaved
    for (const name of ev.filtersFired) {
      acc.byCompressor[name] = (acc.byCompressor[name] ?? 0) + 1
    }
  }
  return {
    windowSec: seconds,
    ...acc,
    ratio: acc.bytesIn > 0 ? +(acc.bytesOut / acc.bytesIn).toFixed(4) : null,
  }
}

router.get('/api/compactor/summary', (req, res) => {
  res.json({
    enabled: config.compactorEnabled,
    settings: {
      requestBody: config.compactorRequestBody,
      responseBody: config.compactorResponseBody,
      toolResultOnly: config.compactorToolResultOnly,
      allowRisky: config.compactorAllowRisky,
      maxReqBytes: config.compactorMaxReqBytes,
      longFileThreshold: config.compactorLongFileThreshold,
    },
    compressors: {
      all: allCompressorNames(),
      active: activeCompressors().map((c) => c.name),
    },
    windows: {
      '1m': aggregate(60),
      '5m': aggregate(300),
      '15m': aggregate(900),
    },
    lifetime: lifetimeSnapshot(),
  })
})

router.get('/api/compactor/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), config.maxApiResultRows)
  const out = []
  for (const ev of iterRecentCompactor(900)) {
    out.push(ev)
    if (out.length >= limit) break
  }
  res.json(out)
})

router.get('/api/compactor/history', (req, res) => {
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
    compactorActive: true,
    limit,
  })
  res.json({ ...range, count: events.length, events })
})

router.get('/api/compactor/rollups', (req, res) => {
  if (!storeIsOpen()) {
    return res.status(503).json({ error: 'persistence disabled — set METRICS_DB_PATH' })
  }
  const period = (req.query.period ?? 'hour').toLowerCase()
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
    compactorActive: true,
  })
  res.json({ period, ...range, buckets })
})

// Test-only reset endpoint. Gated to NODE_ENV=test so it can't be triggered
// in production. Used by Playwright E2E specs to isolate test state.
if (process.env.NODE_ENV === 'test') {
  router.post('/api/test/reset', (req, res) => {
    _resetCompactorMetrics()
    _resetGuardrailsMetrics()
    _resetMetrics()
    res.json({ ok: true })
  })
}

export default router
