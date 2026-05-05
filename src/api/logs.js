import { Router } from 'express'
import { readTail, readHistoricLog, listAvailableLogs } from '../logs/reader.js'
import { addClient } from '../sse/stream.js'

const router = Router()

router.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '500', 10), 5000)
  res.json(readTail(limit))
})

router.get('/api/logs/available', (req, res) => {
  res.json(listAvailableLogs())
})

router.get('/api/logs/history', (req, res) => {
  const { date } = req.query
  if (!date) {
    return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' })
  }

  let entries
  try {
    entries = readHistoricLog(date)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  if (entries === null) {
    return res.status(404).json({ error: `No log found for ${date}` })
  }

  res.json(entries)
})

router.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  addClient(res)
})

export default router
