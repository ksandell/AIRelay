import { logger } from '../logs/logger.js'
import { sanitize } from '../guardrails/sanitizer.js'

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  logger.error('unhandled error', {
    requestId: req.requestId,
    message: sanitize(err.message),
    stack: sanitize(err.stack),
  })

  const status = err.status ?? err.statusCode ?? 500
  res.status(status).json({
    error: status < 500 ? sanitize(err.message) : 'Internal server error',
  })
}
