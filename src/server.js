import express from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { requestLogger } from './middleware/requestLogger.js'
import { apiRateLimiter } from './middleware/rateLimiter.js'
import { errorHandler } from './middleware/errorHandler.js'
import healthRouter from './api/health.js'
import logsRouter from './api/logs.js'
import metricsRouter from './api/metrics.js'
import compactorRouter from './api/compactor.js'
import guardrailsRouter from './api/guardrails.js'
import settingsRouter from './api/settings.js'
import cacheRouter from './cache/api.js'
import { createProxyHandler } from './proxy/proxy.js'
import { createCacheMiddleware } from './cache/middleware.js'
import { createCompactorMiddleware } from './compactor/middleware.js'
import { createGuardrailsMiddleware } from './guardrails/middleware.js'
import { getRoutes } from './routes/registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.set('etag', false)

  // PROXY MUST BE FIRST. Mounted before json/static/requestLogger so the bytes
  // flow through unmodified and the per-request sync logger does not run on
  // the proxy hot path.
  //
  // Multi-upstream (v0.4.0): iterate each route from getRoutes() and mount the
  // Compactor + Guardrails middleware (when enabled) and the proxy handler
  // under that route's prefix. Routes are pre-sorted by descending prefix
  // length so Express's longest-prefix-wins matching does the right thing.
  const routes = getRoutes()
  for (const route of routes) {
    // ALWAYS register — the middleware itself checks config.*Enabled per-request,
    // so runtime enable/disable (via POST /api/settings) takes effect immediately.
    // Cache MUST be first — it buffers the body in req._cacheBodyBuffer so
    // Compactor/Guardrails can still read it (body-buffer contract).
    app.use(route.prefix, createCacheMiddleware())
    app.use(route.prefix, createCompactorMiddleware())
    app.use(route.prefix, createGuardrailsMiddleware())
    app.use(route.prefix, createProxyHandler(route))
  }

  app.use(express.json())
  app.use(requestLogger)
  app.use(express.static(path.join(__dirname, '..', 'public')))

  app.use(apiRateLimiter)
  app.use(healthRouter)
  app.use(logsRouter)
  app.use(metricsRouter)
  app.use(compactorRouter)
  app.use(guardrailsRouter)
  app.use(settingsRouter)
  app.use(cacheRouter)

  app.use(errorHandler)

  return app
}
