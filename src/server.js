import express from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config } from './config.js'
import { requestLogger } from './middleware/requestLogger.js'
import { errorHandler } from './middleware/errorHandler.js'
import healthRouter from './api/health.js'
import logsRouter from './api/logs.js'
import metricsRouter from './api/metrics.js'
import { createProxyHandler } from './proxy/proxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = express()

  // Disable etag/x-powered-by for predictability under load.
  app.disable('x-powered-by')
  app.set('etag', false)

  // PROXY MUST BE FIRST.
  // Mounted before json/static/requestLogger so the bytes flow through unmodified
  // and the per-request sync logger does not run on the proxy hot path.
  if (config.upstreamUrl) {
    app.use(config.proxyPathPrefix, createProxyHandler())
  }

  app.use(express.json())
  app.use(requestLogger)
  app.use(express.static(path.join(__dirname, '..', 'public')))

  app.use(healthRouter)
  app.use(logsRouter)
  app.use(metricsRouter)

  app.use(errorHandler)

  return app
}
