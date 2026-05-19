import { Router } from 'express'
import { config } from '../config.js'
import {
  guardrailsLifetimeSnapshot,
  iterRecentGuardrails,
  _resetGuardrailsMetrics,
} from '../guardrails/metrics.js'
import { allDetectorNames, activeDetectors, categoriesActive } from '../guardrails/registry.js'

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
