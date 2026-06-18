import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { Router } from 'express'
import { config } from '../config.js'
import { nextRotationISO } from '../logs/rotation.js'
import { getInFlight } from '../metrics/collector.js'
import { metricsClientCount } from '../metrics/broadcaster.js'

const router = Router()

const eld = monitorEventLoopDelay({ resolution: 20 })
eld.enable()

let lastUpstreamCheck = 0
let lastUpstreamReachable = null
const UPSTREAM_CHECK_TTL_MS = 5000

async function checkUpstream() {
  const now = Date.now()
  if (now - lastUpstreamCheck < UPSTREAM_CHECK_TTL_MS && lastUpstreamReachable !== null) {
    return lastUpstreamReachable
  }
  lastUpstreamCheck = now

  if (!config.upstreamUrl) {
    lastUpstreamReachable = null
    return null
  }

  return new Promise((resolve) => {
    try {
      const lib = config.upstreamUrl.startsWith('https:') ? https : http
      const req = lib.request(config.upstreamUrl, { method: 'HEAD', timeout: 2000 }, (res) => {
        lastUpstreamReachable = res.statusCode < 500
        res.resume()
        resolve(lastUpstreamReachable)
      })
      req.on('error', () => {
        lastUpstreamReachable = false
        resolve(false)
      })
      req.on('timeout', () => {
        req.destroy()
        lastUpstreamReachable = false
        resolve(false)
      })
      req.end()
    } catch {
      lastUpstreamReachable = false
      resolve(false)
    }
  })
}

router.get('/health', async (req, res) => {
  const activeLog = `${config.logDir}/app.log`

  let logDirWritable = false
  try {
    fs.accessSync(config.logDir, fs.constants.W_OK)
    logDirWritable = true
  } catch {
    // ignore access errors
  }

  let activeLogSizeBytes = 0
  try {
    activeLogSizeBytes = fs.statSync(activeLog).size
  } catch {
    // ignore stat errors
  }

  const upstreamReachable = await checkUpstream()

  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    publicBaseUrl: config.publicBaseUrl,
    bindHost: config.bindHost,
    port: config.port,

    logDir: config.logDir,
    logDirWritable,
    nextRotation: nextRotationISO(),
    activeLogSizeBytes,

    proxy: {
      enabled: Boolean(config.upstreamUrl),
      pathPrefix: config.proxyPathPrefix,
      upstreamReachable,
    },

    runtime: {
      inFlight: getInFlight(),
      sseClients: metricsClientCount(),
      eventLoopLagMs: +(eld.mean / 1e6).toFixed(3),
      rss: process.memoryUsage.rss(),
    },

    timestamp: new Date().toISOString(),
  })
})

export default router
