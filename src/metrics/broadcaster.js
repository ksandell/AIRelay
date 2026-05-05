import { config } from '../config.js'
import { aggregate } from './aggregator.js'
import { onEvent, getInFlight } from './collector.js'

const clients = new Set()

let perSecondBudget = config.sseEventRate
let lastReset = Date.now()
let tickHandle = null
let unsubscribe = null

export function addMetricsClient(res) {
  // Hard cap — evict oldest before accepting new.
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
  // Non-blocking: if the kernel buffer is full we drop this frame for this
  // client rather than queueing — they'll catch up on the next aggregate tick.
  try {
    return res.write(payload)
  } catch {
    // write failed; drop this frame
    return false
  }
}

function broadcast(payload, eventName) {
  const data = (eventName ? `event: ${eventName}\n` : '') + `data: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) safeWrite(res, data)
}

export function startMetricsBroadcaster() {
  if (tickHandle) return stopMetricsBroadcaster

  unsubscribe = onEvent((ev) => {
    const now = Date.now()
    if (now - lastReset >= 1000) {
      perSecondBudget = config.sseEventRate
      lastReset = now
    }
    if (perSecondBudget <= 0) return
    perSecondBudget--
    broadcast(ev, 'request')
  })

  tickHandle = setInterval(() => {
    broadcast(
      {
        ts: new Date().toISOString(),
        windows: {
          '1m': aggregate(60),
          '5m': aggregate(300),
        },
        inFlight: getInFlight(),
        sseClients: clients.size,
      },
      'tick',
    )
  }, config.metricsTickMs)

  return stopMetricsBroadcaster
}

export function stopMetricsBroadcaster() {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  if (tickHandle) {
    clearInterval(tickHandle)
    tickHandle = null
  }
}

export function metricsClientCount() {
  return clients.size
}

export function closeAllMetricsClients() {
  for (const res of clients) {
    try {
      res.end()
    } catch {
      // ignore close errors
    }
  }
  clients.clear()
}
