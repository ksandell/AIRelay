import IORedis from 'ioredis'
import { config } from '../config.js'

const CHANNEL = 'airelay:metrics'

let _sub = null
let _pub = null

// Called at startup when fanout is enabled
export async function initFanout(broadcastFn) {
  if (!config.cacheEnabled || !config.cacheSseFanoutEnabled || !config.cacheRedisUrl) return

  _sub = new IORedis(config.cacheRedisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  })
  _sub.on('error', () => {})

  _pub = new IORedis(config.cacheRedisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  })
  _pub.on('error', () => {})

  try {
    await Promise.all([_sub.connect(), _pub.connect()])
    await _sub.subscribe(CHANNEL)
    _sub.on('message', (ch, msg) => {
      if (ch !== CHANNEL) return
      try {
        broadcastFn(JSON.parse(msg))
      } catch {
        /* ignore */
      }
    })
  } catch {
    // Graceful degrade
  }
}

export async function publishTick(data) {
  if (!_pub) return
  try {
    await _pub.publish(CHANNEL, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export async function closeFanout() {
  await Promise.all([_sub?.quit().catch(() => {}), _pub?.quit().catch(() => {})])
  _sub = null
  _pub = null
}
