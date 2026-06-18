import cron from 'node-cron'
import { config, loadOverrides } from './config.js'
import { createApp } from './server.js'
import { logger } from './logs/logger.js'
import { rotateLogsIfNeeded, rotateLogs, startSizeGuard } from './logs/rotation.js'
import { closeAll, startHeartbeat } from './sse/stream.js'
import {
  startMetricsBroadcaster,
  stopMetricsBroadcaster,
  closeAllMetricsClients,
} from './metrics/broadcaster.js'
import {
  open as openMetricsStore,
  pruneOlderThan,
  close as closeMetricsStore,
} from './metrics/store.js'
import { initClient as initCacheClient, closeClient as closeCacheClient } from './cache/client.js'
import { initFanout, closeFanout } from './cache/fanout.js'
import { broadcast as hubBroadcast } from './sse/hub.js'

await loadOverrides()

await initCacheClient()
// The subscriber re-broadcasts ticks from other instances to local SSE clients.
await initFanout((data) => hubBroadcast('metrics', data, 'tick'))

rotateLogsIfNeeded()

if (config.metricsDbPath) {
  await openMetricsStore(config.metricsDbPath)
  logger.info('metrics persistence enabled', {
    dbPath: config.metricsDbPath,
    retentionDays: config.metricsRetentionDays,
  })
}

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

cron.schedule(
  config.cronSchedule,
  async () => {
    logger.info('cron: rotating logs')
    try {
      await rotateLogs()
    } catch (err) {
      logger.error('cron: rotateLogs failed', { error: err.message })
    }
    if (config.metricsDbPath) {
      try {
        const removed = pruneOlderThan(config.metricsRetentionDays)
        if (removed > 0) {
          logger.info('cron: pruned old metric events', { removed })
        }
      } catch (err) {
        logger.error('cron: pruneOlderThan failed', { error: err.message })
      }
    }
  },
  { timezone: 'UTC' },
)

const sizeGuard = startSizeGuard()
const heartbeat = startHeartbeat()
startMetricsBroadcaster()

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('server shutting down', { signal })

  closeAll()
  closeAllMetricsClients()
  stopMetricsBroadcaster()

  clearInterval(sizeGuard)
  clearInterval(heartbeat)
  closeMetricsStore()

  await closeFanout()
  await closeCacheClient()

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
