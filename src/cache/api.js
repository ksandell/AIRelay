import { Router } from 'express'
import { config } from '../config.js'
import { exactKeyCount } from './exact.js'
import { isConnected as clientConnected } from './client.js'
import { lifetimeSnapshot, window1mSnapshot, iterRecent } from './metrics.js'
import { dedupSize } from './dedup.js'

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

export default router
