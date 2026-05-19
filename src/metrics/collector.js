import { config } from '../config.js'
import { enqueue as persistEvent, isOpen as storeIsOpen } from './store.js'

/**
 * Canonical metric event shape (all fields except `ts` may be null/undefined):
 *
 *   ts             ISO-8601 string  — request completion timestamp (required)
 *   method         string           — HTTP method
 *   path           string           — request path (post-prefix)
 *   status         number           — upstream response status code
 *   durationMs     number           — total request duration in ms
 *   bytesIn        number           — request body bytes forwarded upstream
 *   bytesOut       number           — response body bytes returned to client
 *   upstream       string           — resolved upstream URL
 *   route          string|null      — route prefix that matched (v0.4.0 multi-upstream)
 *   error          string|null      — error message if proxy failed, else null
 *
 *   v0.2.0 token & cost fields (all nullable — populated by provider parsers):
 *   provider          string|null   — e.g. 'anthropic', 'openai', 'gemini'
 *   model             string|null   — e.g. 'claude-sonnet-4-5'
 *   inputTokens       number|null   — prompt tokens
 *   outputTokens      number|null   — completion tokens
 *   cacheReadTokens   number|null   — cached prompt tokens read
 *   cacheWriteTokens  number|null   — cached prompt tokens written
 *   totalTokens       number|null   — sum of all token classes
 *   costUsd           number|null   — computed USD cost from pricing config
 *
 *   v0.2.2 tool-call fields (nullable — populated by provider parsers):
 *   toolCalls         number|null   — count of tool invocation blocks (request + response)
 *   toolBytesIn       number|null   — bytes of tool_result / role:tool / functionResponse blocks (req)
 *   toolBytesOut      number|null   — bytes of tool_use / tool_calls / functionCall blocks (resp)
 *
 * Events are stored by reference; record() does not copy or validate.
 */

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
  // Persist when the SQLite store is open. enqueue() is synchronous and only
  // pushes onto an in-memory buffer — actual disk I/O is on a flush timer.
  // No-op when METRICS_DB_PATH is unset (default).
  if (storeIsOpen()) persistEvent(event)
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
