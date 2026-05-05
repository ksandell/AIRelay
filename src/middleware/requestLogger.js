import { randomUUID } from 'node:crypto'
import { logger } from '../logs/logger.js'

const SKIP_PATHS = ['/health', '/api/metrics/', '/api/logs/']

export function requestLogger(req, res, next) {
  if (SKIP_PATHS.some((p) => req.url.startsWith(p))) {
    return next()
  }

  const requestId = req.headers['x-request-id'] ?? randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)

  const start = Date.now()
  res.on('finish', () => {
    logger.info('request', {
      requestId,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ms: Date.now() - start,
    })
  })

  next()
}
