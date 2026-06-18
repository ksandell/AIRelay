/**
 * Metrics SSE facade.
 * Delegates to the shared hub on channel 'metrics'.
 * External API is unchanged.
 */
import {
  addClient as hubAddClient,
  broadcast as hubBroadcast,
  closeAll as hubCloseAll,
  clientCount as hubClientCount,
} from '../sse/hub.js'
import { config } from '../config.js'
import { aggregate } from './aggregator.js'
import { onEvent, getInFlight } from './collector.js'

const CHANNEL = 'metrics'

let perSecondBudget = config.sseEventRate
let lastReset = Date.now()
let tickHandle = null
let unsubscribe = null

export function addMetricsClient(res) {
  hubAddClient(res, CHANNEL)
}

export function startMetricsBroadcaster() {
  if (tickHandle || unsubscribe) return stopMetricsBroadcaster

  unsubscribe = onEvent((ev) => {
    const now = Date.now()
    if (now - lastReset >= 1000) {
      perSecondBudget = config.sseEventRate
      lastReset = now
    }
    if (perSecondBudget <= 0) return
    perSecondBudget--
    hubBroadcast(CHANNEL, ev, 'request')
  })

  tickHandle = setInterval(() => {
    const tickData = {
      ts: new Date().toISOString(),
      windows: {
        '1m': aggregate(60),
        '5m': aggregate(300),
      },
      inFlight: getInFlight(),
      sseClients: hubClientCount(),
    }
    hubBroadcast(CHANNEL, tickData, 'tick')
    // Fan-out to other instances via Redis pub/sub (no-op when fanout disabled)
    import('../cache/fanout.js')
      .then(({ publishTick }) => publishTick(tickData))
      .catch(() => {})
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
  return hubClientCount()
}

export function closeAllMetricsClients() {
  hubCloseAll()
}
