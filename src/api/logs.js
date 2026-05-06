import { Router } from 'express'
import { readTail, readHistoricLog, listAvailableLogs } from '../logs/reader.js'
import { addClient } from '../sse/stream.js'

const router = Router()

router.get('/api/logs', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10), 5000)
    const entries = await readTail(limit)
    res.json(entries)
  } catch (err) {
    next(err)
  }
})

router.get('/api/logs/available', async (req, res, next) => {
  try {
    res.json(await listAvailableLogs())
  } catch (err) {
    next(err)
  }
})

router.get('/api/logs/history', async (req, res, next) => {
  const { date } = req.query
  if (!date) {
    return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' })
  }

  try {
    const entries = await readHistoricLog(date)
    if (entries === null) {
      return res.status(404).json({ error: `No log found for ${date}` })
    }
    res.json(entries)
  } catch (err) {
    if (err.message.startsWith('Invalid date format')) {
      return res.status(400).json({ error: err.message })
    }
    next(err)
  }
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
