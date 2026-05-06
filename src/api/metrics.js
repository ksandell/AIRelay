import { Router } from 'express'
import { recent, snapshot, getInFlight } from '../metrics/collector.js'
import { summary } from '../metrics/aggregator.js'
import { addMetricsClient, metricsClientCount } from '../metrics/broadcaster.js'
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
