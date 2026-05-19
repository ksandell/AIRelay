import { Router } from 'express'
import { config } from '../config.js'
import {
  guardrailsLifetimeSnapshot,
  iterRecentGuardrails,
  _resetGuardrailsMetrics,
} from '../guardrails/metrics.js'
import { allDetectorNames, activeDetectors, categoriesActive } from '../guardrails/registry.js'
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
    requestsScanned: 0,
    requestsClean: 0,
    requestsBlocked: 0,
    requestsRedacted: 0,
    requestsAlerted: 0,
    requestsBypassed: 0,
    hits: 0,
    bytesScanned: 0,
    bytesRedacted: 0,
    byDetector: {},
    bypassReasons: {},
  }
  for (const ev of iterRecentGuardrails(seconds)) {
    if (ev.bypassReason) {
      acc.requestsBypassed++
      acc.bypassReasons[ev.bypassReason] = (acc.bypassReasons[ev.bypassReason] ?? 0) + 1
      continue
    }
    acc.requestsScanned++
    acc.hits += ev.hits
    acc.bytesScanned += ev.bytesIn
    if (ev.hits === 0) acc.requestsClean++
    if (ev.blocked) acc.requestsBlocked++
    if (ev.mode === 'redact' || ev.mode === 'mixed') acc.requestsRedacted++
    if (ev.mode === 'alert' && ev.hits > 0) acc.requestsAlerted++
    if (ev.bytesIn > ev.bytesOut) acc.bytesRedacted += ev.bytesIn - ev.bytesOut
    for (const name of ev.detectorsFired) {
      acc.byDetector[name] = (acc.byDetector[name] ?? 0) + 1
    }
  }
  return { windowSec: seconds, ...acc }
}

router.get('/api/guardrails/summary', (req, res) => {
  res.json({
    enabled: config.guardrailsEnabled,
    settings: {
      maxReqBytes: config.guardrailsMaxReqBytes,
      modes: categoriesActive(),
      customPatternsFile: config.guardrailsCustomPatternsFile,
    },
    detectors: {
      all: allDetectorNames(),
      active: activeDetectors().map((d) => ({
        name: d.name,
        category: d.category,
        mode: d.mode,
      })),
    },
    windows: {
      '1m': aggregate(60),
      '5m': aggregate(300),
      '15m': aggregate(900),
    },
    lifetime: guardrailsLifetimeSnapshot(),
  })
})

router.get('/api/guardrails/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), config.maxApiResultRows)
  const out = []
  for (const ev of iterRecentGuardrails(900)) {
    out.push(ev)
    if (out.length >= limit) break
  }
  res.json(out)
})

router.get('/api/guardrails/history', (req, res) => {
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
    guardrailsAny: true,
    limit,
  })
  res.json({ ...range, count: events.length, events })
})

router.get('/api/guardrails/rollups', (req, res) => {
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
    guardrailsAny: true,
  })
  res.json({ period, ...range, buckets })
})

// Test-only reset for Playwright isolation. Already gated in compactor router;
// this one is additive — exposed as POST /api/test/reset/guardrails so it can
// be called independently.
if (process.env.NODE_ENV === 'test') {
  router.post('/api/test/reset/guardrails', (req, res) => {
    _resetGuardrailsMetrics()
    res.json({ ok: true })
  })
}

export default router
