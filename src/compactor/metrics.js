/**
 * Compactor metrics: a parallel ring buffer to the proxy collector. Events
 * here are per-request aggregates emitted once after the pipeline runs.
 *
 * Event shape:
 *   {
 *     ts: ISO-8601,
 *     requestId: string,
 *     scope: 'request' | 'response',
 *     filtersFired: string[],
 *     bytesIn: number,
 *     bytesOut: number,
 *     bytesSaved: number,
 *     estimatedTokensSaved: number,  // bytesSaved / 4 heuristic
 *     durationMicros: number,
 *     bypassReason: string | null,
 *   }
 */

import { config } from '../config.js'

const SIZE = config.maxMetricEvents
const buf = new Array(SIZE)
let head = 0
let count = 0
const listeners = new Set()

// Global counters since process start (also exposed via /api/compactor/summary).
const lifetime = {
  requestsCompressed: 0,
  requestsBypassed: 0,
  bytesIn: 0,
  bytesOut: 0,
  bytesSaved: 0,
  byCompressor: {}, // name -> { fires, bytesSaved, durationMicros }
  bypassReasons: {}, // reason -> count
}

export function recordCompactorEvent(event) {
  buf[head] = event
  head = (head + 1) % SIZE
  if (count < SIZE) count++
  if (event.bypassReason) {
    lifetime.requestsBypassed++
    lifetime.bypassReasons[event.bypassReason] =
      (lifetime.bypassReasons[event.bypassReason] ?? 0) + 1
  } else {
    lifetime.requestsCompressed++
    lifetime.bytesIn += event.bytesIn ?? 0
    lifetime.bytesOut += event.bytesOut ?? 0
    lifetime.bytesSaved += event.bytesSaved ?? 0
  }
  for (const l of listeners) {
    try {
      l(event)
    } catch {
      // ignore listener errors
    }
  }
}

export function recordCompressorFire({ name, bytesBefore, bytesAfter, durationMicros }) {
  let agg = lifetime.byCompressor[name]
  if (!agg) {
    agg = { fires: 0, bytesSaved: 0, durationMicros: 0 }
    lifetime.byCompressor[name] = agg
  }
  agg.fires++
  agg.bytesSaved += bytesBefore - bytesAfter
  agg.durationMicros += durationMicros
}

export function* iterRecentCompactor(seconds) {
  const cutoff = Date.now() - seconds * 1000
  const n = count
  for (let i = 0; i < n; i++) {
    const idx = (head - 1 - i + SIZE) % SIZE
    const ev = buf[idx]
    if (!ev) break
    const t = Date.parse(ev.ts)
    if (t < cutoff) continue
    yield ev
  }
}

export function lifetimeSnapshot() {
  return JSON.parse(JSON.stringify(lifetime))
}

export function onCompactorEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function _resetCompactorMetrics() {
  for (let i = 0; i < SIZE; i++) buf[i] = undefined
  head = 0
  count = 0
  lifetime.requestsCompressed = 0
  lifetime.requestsBypassed = 0
  lifetime.bytesIn = 0
  lifetime.bytesOut = 0
  lifetime.bytesSaved = 0
  lifetime.byCompressor = {}
  lifetime.bypassReasons = {}
  listeners.clear()
}
