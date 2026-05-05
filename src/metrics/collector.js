import { config } from '../config.js'

// Pre-allocated ring buffer. record() is O(1), no allocations on the hot path
// beyond the event object the caller already created.
const SIZE = config.maxMetricEvents
const buf = new Array(SIZE)
let head = 0
let count = 0
let inFlight = 0
const listeners = new Set()

export function record(event) {
  buf[head] = event
  head = (head + 1) % SIZE
  if (count < SIZE) count++
  for (const l of listeners) {
    try {
      l(event)
    } catch {
      // ignore listener errors
    }
  }
}

export function recent(limit = 200) {
  const n = Math.min(limit, count)
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const idx = (head - n + i + SIZE) % SIZE
    out[i] = buf[idx]
  }
  return out
}

// Iterate from newest to oldest, stopping once events fall outside the window.
export function* iterRecent(seconds) {
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

export function snapshot() {
  return { count, capacity: SIZE }
}

export function onEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function incInFlight() {
  inFlight++
}
export function decInFlight() {
  if (inFlight > 0) inFlight--
}
export function getInFlight() {
  return inFlight
}

// Test-only: reset all state between vitest runs.
export function _reset() {
  for (let i = 0; i < SIZE; i++) buf[i] = undefined
  head = 0
  count = 0
  inFlight = 0
  listeners.clear()
}
