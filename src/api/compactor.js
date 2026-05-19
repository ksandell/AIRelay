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
