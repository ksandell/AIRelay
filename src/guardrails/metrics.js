/**
 * Guardrails metrics — parallel to Compactor's metrics module. One event per
 * request, recorded after detection runs (or once on bypass).
 *
 * Event shape:
 *   {
 *     ts: ISO-8601,
 *     requestId: string | null,
 *     mode: 'alert' | 'block' | 'redact' | 'mixed' | 'bypass',
 *     detectorsFired: string[],   // unique detector names that matched
 *     hits: number,               // total match count across detectors
 *     bytesIn: number,
 *     bytesOut: number,           // same as bytesIn unless mode includes redact
 *     blocked: boolean,           // true if request was rejected (block mode hit)
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

const lifetime = {
  requestsScanned: 0,
  requestsClean: 0,
  requestsAlerted: 0,
  requestsBlocked: 0,
  requestsRedacted: 0,
  requestsBypassed: 0,
  bytesScanned: 0,
  totalHits: 0,
  byDetector: {}, // name -> { fires, hits, bytesRedacted }
  bypassReasons: {},
}

export function recordGuardrailsEvent(event) {
  buf[head] = event
  head = (head + 1) % SIZE
  if (count < SIZE) count++
  if (event.bypassReason) {
    lifetime.requestsBypassed++
    lifetime.bypassReasons[event.bypassReason] =
      (lifetime.bypassReasons[event.bypassReason] ?? 0) + 1
  } else {
    lifetime.requestsScanned++
    lifetime.bytesScanned += event.bytesIn ?? 0
    lifetime.totalHits += event.hits ?? 0
    if (event.hits === 0) lifetime.requestsClean++
    if (event.blocked) lifetime.requestsBlocked++
    if (event.mode === 'redact' || event.mode === 'mixed') lifetime.requestsRedacted++
    if (event.mode === 'alert' && event.hits > 0) lifetime.requestsAlerted++
  }
  for (const l of listeners) {
    try {
      l(event)
    } catch {
      // ignore listener errors
    }
  }
}

export function recordDetectorHit({ name, hits, bytesRedacted }) {
  let agg = lifetime.byDetector[name]
  if (!agg) {
    agg = { fires: 0, hits: 0, bytesRedacted: 0 }
    lifetime.byDetector[name] = agg
  }
  agg.fires++
  agg.hits += hits
  agg.bytesRedacted += bytesRedacted ?? 0
}

export function* iterRecentGuardrails(seconds) {
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

export function guardrailsLifetimeSnapshot() {
  return JSON.parse(JSON.stringify(lifetime))
}

export function onGuardrailsEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function _resetGuardrailsMetrics() {
  for (let i = 0; i < SIZE; i++) buf[i] = undefined
  head = 0
  count = 0
  lifetime.requestsScanned = 0
  lifetime.requestsClean = 0
  lifetime.requestsAlerted = 0
  lifetime.requestsBlocked = 0
  lifetime.requestsRedacted = 0
  lifetime.requestsBypassed = 0
  lifetime.bytesScanned = 0
  lifetime.totalHits = 0
  lifetime.byDetector = {}
  lifetime.bypassReasons = {}
  listeners.clear()
}
