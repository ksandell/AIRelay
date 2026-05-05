import { logger } from '../logs/logger.js'

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  logger.error('unhandled error', {
    requestId: req.requestId,
    message: err.message,
    stack: err.stack,
  })

  const status = err.status ?? err.statusCode ?? 500
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
  })
}
