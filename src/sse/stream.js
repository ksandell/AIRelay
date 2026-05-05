import { config } from '../config.js'

const clients = new Set()

export function addClient(res) {
  while (clients.size >= config.maxSseClients) {
    const oldest = clients.values().next().value
    if (!oldest) break
    try {
      oldest.write('event: evicted\ndata: "cap"\n\n')
      oldest.end()
    } catch {
      // ignore write errors
    }
    clients.delete(oldest)
  }
  clients.add(res)
  res.on('close', () => clients.delete(res))
}

function safeWrite(res, payload) {
  try {
    return res.write(payload)
  } catch {
    // write failed; drop this frame
    return false
  }
}

export function broadcast(entry) {
  const data = `data: ${JSON.stringify(entry)}\n\n`
  for (const res of clients) safeWrite(res, data)
}

export function broadcastRetry(ms = 5000) {
  const msg = `retry: ${ms}\n\n`
  for (const res of clients) safeWrite(res, msg)
}

export function closeAll() {
  broadcastRetry(5000)
  for (const res of clients) {
    try {
      res.end()
    } catch {
      // ignore close errors
    }
  }
  clients.clear()
}

export function startHeartbeat() {
  return setInterval(() => {
    for (const res of clients) safeWrite(res, ': heartbeat\n\n')
  }, config.sseHeartbeatMs)
}

export function clientCount() {
  return clients.size
}
