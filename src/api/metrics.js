import { Router } from 'express'
import { recent, snapshot, getInFlight } from '../metrics/collector.js'
import { summary } from '../metrics/aggregator.js'
import { addMetricsClient, metricsClientCount } from '../metrics/broadcaster.js'

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
  const limit = Math.min(parseInt(req.query.limit ?? '200', 10), 5000)
  res.json(recent(limit))
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
