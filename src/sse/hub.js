/**
 * Single SSE hub — owns one client map, one heartbeat timer, one eviction policy.
 * Logs and metrics are "channels" on this hub.
 *
 * exports: addClient(res, channel), broadcast(channel, data, eventName),
 *          broadcastRaw(channel, payload), startHeartbeat(), closeAll(), clientCount()
 */
import { config } from '../config.js'

/** @type {Map<object, string>} res → channel */
const clients = new Map()

function safeWrite(res, payload) {
  try {
    return res.write(payload)
  } catch {
    return false
  }
}

export function addClient(res, channel) {
  // Evict oldest across ALL channels when total cap reached.
  while (clients.size >= config.maxSseClients) {
    const oldest = clients.keys().next().value
    if (!oldest) break
    try {
      oldest.write('event: evicted\ndata: "cap"\n\n')
      oldest.end()
    } catch {
      // ignore
    }
    clients.delete(oldest)
  }
  clients.set(res, channel)
  res.on('close', () => clients.delete(res))
}

/**
 * Broadcast a structured event to clients subscribed to `channel`.
 * @param {string} channel
 * @param {unknown} data  — will be JSON-serialised
 * @param {string|null} eventName  — optional SSE event: field
 */
export function broadcast(channel, data, eventName = null) {
  const payload = (eventName ? `event: ${eventName}\n` : '') + `data: ${JSON.stringify(data)}\n\n`
  for (const [res, ch] of clients) {
    if (ch === channel) safeWrite(res, payload)
  }
}

/**
 * Broadcast a raw SSE frame string to clients subscribed to `channel`.
 */
export function broadcastRaw(channel, payload) {
  for (const [res, ch] of clients) {
    if (ch === channel) safeWrite(res, payload)
  }
}

export function startHeartbeat() {
  return setInterval(() => {
    for (const res of clients.keys()) safeWrite(res, ': heartbeat\n\n')
  }, config.sseHeartbeatMs)
}

export function closeAll() {
  for (const res of clients.keys()) {
    try {
      res.end()
    } catch {
      // ignore
    }
  }
  clients.clear()
}

export function clientCount() {
  return clients.size
}
