import { Router } from 'express'
import { config } from '../config.js'
import { exactKeyCount } from './exact.js'
import { isConnected as clientConnected } from './client.js'
import { lifetimeSnapshot, window1mSnapshot, iterRecent } from './metrics.js'
import { dedupSize } from './dedup.js'
import {
  isOpen as storeIsOpen,
  queryRange as storeQueryRange,
  rollups as storeRollups,
} from '../metrics/store.js'

const VALID_PERIODS = new Set(['minute', '5min', '15min', 'hour', 'day', 'week'])

function parseRange(q) {
  const to = q.to ? new Date(q.to) : new Date()
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3600_000)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('invalid from/to — must be ISO-8601')
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

const router = Router()

router.get('/api/cache/summary', async (req, res) => {
  const connected = clientConnected()
  let keyCount = 0
  if (connected) {
    try {
      keyCount = await exactKeyCount()
    } catch {
      /* ignore */
    }
  }
  res.json({
    enabled: config.cacheEnabled,
    connected,
    keyCount,
    exactMatch: {
      enabled: config.cacheExactMatchEnabled,
      ttlSeconds: config.cacheExactTtlSeconds,
    },
    dedup: {
      enabled: config.cacheDedupEnabled,
      inflight: dedupSize(),
    },
    spend: {
      enabled: config.cacheSpendEnabled,
      dailyLimitUsd: config.cacheSpendDailyLimitUsd ?? null,
      monthlyLimitUsd: config.cacheSpendMonthlyLimitUsd ?? null,
    },
    fanout: { enabled: config.cacheSseFanoutEnabled },
    window_1m: window1mSnapshot(),
    lifetime: lifetimeSnapshot(),
  })
})

router.get('/api/cache/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100)
  res.json([...iterRecent(limit)])
})

// Per-event history over a time window — only cache-tagged events (HIT / MISS /
// DEDUP / spend-reject). Requires METRICS_DB_PATH persistence.
router.get('/api/cache/history', (req, res) => {
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
    cacheActive: true,
    cacheStatus: req.query.status || null,
    limit,
  })
  res.json({ ...range, count: events.length, events })
})

// Bucketed rollups (cacheHits / cacheMisses / cacheDedup / bytesFromCache).
router.get('/api/cache/rollups', (req, res) => {
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
  const buckets = storeRollups({ period, ...range, route: req.query.route || null })
  res.json({ ...range, period, buckets })
})

export default router
