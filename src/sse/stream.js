/**
 * Log-stream SSE facade.
 * Delegates to the shared hub on channel 'logs'.
 * External API is unchanged.
 */
import {
  addClient as hubAddClient,
  broadcast as hubBroadcast,
  broadcastRaw,
  startHeartbeat as hubStartHeartbeat,
  closeAll as hubCloseAll,
  clientCount as hubClientCount,
} from './hub.js'

const CHANNEL = 'logs'

export function addClient(res) {
  hubAddClient(res, CHANNEL)
}

export function broadcast(entry) {
  hubBroadcast(CHANNEL, entry)
}

export function broadcastRetry(ms = 5000) {
  broadcastRaw(CHANNEL, `retry: ${ms}\n\n`)
}

export function closeAll() {
  broadcastRetry(5000)
  hubCloseAll()
}

export function startHeartbeat() {
  return hubStartHeartbeat()
}

export function clientCount() {
  return hubClientCount()
}
