import express from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config } from './config.js'
import { requestLogger } from './middleware/requestLogger.js'
import { errorHandler } from './middleware/errorHandler.js'
import healthRouter from './api/health.js'
import logsRouter from './api/logs.js'
import metricsRouter from './api/metrics.js'
import compactorRouter from './api/compactor.js'
import guardrailsRouter from './api/guardrails.js'
import { createProxyHandler } from './proxy/proxy.js'
import { createCompactorMiddleware } from './compactor/middleware.js'
import { createGuardrailsMiddleware } from './guardrails/middleware.js'

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
    // Compactor middleware (v0.3.0). Mounted under the proxy prefix and BEFORE
    // the proxy handler. When COMPACTOR_ENABLED=false (default), it is a no-op
    // — single boolean check, no body buffering, byte-identical passthrough.
    // When enabled, it buffers JSON request bodies, runs the compressor
    // pipeline, and stashes the result on req._compactorBody for the proxy
    // handler to forward via http-proxy's `buffer` option.
    // See docs/COMPACTOR.md.
    if (config.compactorEnabled) {
      app.use(config.proxyPathPrefix, createCompactorMiddleware())
    }
    // Guardrails middleware (v0.4.0). Mounted under the proxy prefix AFTER
    // Compactor — so guardrails sees compacted bytes (smaller scan surface) and
    // banners stack predictably. When GUARDRAILS_ENABLED=false (default), it
    // is a no-op: single boolean check, no body buffering, byte-identical
    // passthrough. When enabled, it inspects JSON request bodies against
    // active detectors and either alerts, blocks, or redacts per category mode.
    // See docs/GUARDRAILS.md.
    if (config.guardrailsEnabled) {
      app.use(config.proxyPathPrefix, createGuardrailsMiddleware())
    }
    app.use(config.proxyPathPrefix, createProxyHandler())
  }

  app.use(express.json())
  app.use(requestLogger)
  app.use(express.static(path.join(__dirname, '..', 'public')))

  app.use(healthRouter)
  app.use(logsRouter)
  app.use(metricsRouter)
  app.use(compactorRouter)
  app.use(guardrailsRouter)

  app.use(errorHandler)

  return app
}
