import cron from 'node-cron'
import { config } from './config.js'
import { createApp } from './server.js'
import { logger } from './logs/logger.js'
import { rotateLogsIfNeeded, rotateLogs, startSizeGuard } from './logs/rotation.js'
import { closeAll, startHeartbeat } from './sse/stream.js'
import {
  startMetricsBroadcaster,
  stopMetricsBroadcaster,
  closeAllMetricsClients,
} from './metrics/broadcaster.js'

rotateLogsIfNeeded()

const app = createApp()

const server = app.listen(config.port, config.bindHost, () => {
  logger.info('server started', {
    port: config.port,
    bindHost: config.bindHost,
    publicBaseUrl: config.publicBaseUrl,
    upstream: config.upstreamUrl || null,
    proxyPath: config.upstreamUrl ? config.proxyPathPrefix : null,
    env: config.nodeEnv,
  })
})

// Tune the HTTP server for parallelism. Defaults are conservative.
server.keepAliveTimeout = 65_000
server.headersTimeout = 70_000
server.requestTimeout = 0 // proxied uploads can be long; rely on upstream timeouts
// maxConnections left at default (unlimited). Node treats 0 as "reject all", not "unlimited".

cron.schedule(config.cronSchedule, () => {
  logger.info('cron: rotating logs')
  rotateLogs()
}, { timezone: 'UTC' })

const sizeGuard = startSizeGuard()
const heartbeat = startHeartbeat()
startMetricsBroadcaster()

let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('server shutting down', { signal })

  closeAll()
  closeAllMetricsClients()
  stopMetricsBroadcaster()

  clearInterval(sizeGuard)
  clearInterval(heartbeat)

  server.close(() => {
    logger.info('server closed')
    process.exit(0)
  })

  setTimeout(() => {
    logger.warn('shutdown timeout — forcing exit')
    process.exit(1)
  }, config.shutdownTimeoutMs).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
