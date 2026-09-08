import IORedis from 'ioredis'
import { config } from '../config.js'

let _client = null
let _connected = false
let _warnedOnce = false

export function getClient() {
  return _client
}

export function isConnected() {
  return _connected
}

export async function initClient() {
  if (!config.cacheRedisUrl) return

  _client = new IORedis(config.cacheRedisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    // connectTimeout only covers opening the socket. Without a per-command
    // deadline a connected-but-unresponsive Dragonfly leaves every GET/SET
    // pending forever — and exactGet/checkSpendLimit are awaited on the hot
    // path of every JSON POST, so the whole proxy stalls. A rejection here is
    // caught by the callers and degrades to a cache miss, which a hang is not.
    // ponytail: fixed 2s; make it env-tunable if it ever trips on a healthy box
    commandTimeout: 2000,
    enableOfflineQueue: false,
    lazyConnect: true,
  })

  _client.on('connect', () => {
    _connected = true
    _warnedOnce = false
  })
  _client.on('close', () => {
    _connected = false
  })
  _client.on('error', (err) => {
    _connected = false
    if (!_warnedOnce) {
      console.warn('[cache] Dragonfly connection error — cache disabled:', err.message)
      _warnedOnce = true
    }
  })

  try {
    await _client.connect()
  } catch (err) {
    console.warn('[cache] Could not connect to Dragonfly — cache disabled:', err.message)
  }
}

export async function closeClient() {
  if (_client) {
    try {
      await _client.quit()
    } catch {
      /* ignore */
    }
    _client = null
    _connected = false
  }
}
