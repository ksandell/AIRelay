import { config } from '../config.js'

const SIZE = config.maxMetricEvents
const buf = new Array(SIZE)
let head = 0
let count = 0

const lifetime = {
  exactHits: 0,
  exactMisses: 0,
  dedupCoalesced: 0,
  spendRejected: 0,
  bytesFromCache: 0,
}

const win1m = {
  exactHits: 0,
  exactMisses: 0,
  dedupCoalesced: 0,
  spendRejected: 0,
  bytesFromCache: 0,
}

let win1mReset = Date.now()

function tickWindow() {
  if (Date.now() - win1mReset >= 60_000) {
    win1m.exactHits = 0
    win1m.exactMisses = 0
    win1m.dedupCoalesced = 0
    win1m.spendRejected = 0
    win1m.bytesFromCache = 0
    win1mReset = Date.now()
  }
}

export function recordCacheEvent(event) {
  buf[head] = event
  head = (head + 1) % SIZE
  if (count < SIZE) count++
  tickWindow()
  const bytes = event.bytes ?? 0
  switch (event.type) {
    case 'HIT':
      lifetime.exactHits++
      win1m.exactHits++
      lifetime.bytesFromCache += bytes
      win1m.bytesFromCache += bytes
      break
    case 'MISS':
      lifetime.exactMisses++
      win1m.exactMisses++
      break
    case 'DEDUP':
      lifetime.dedupCoalesced++
      win1m.dedupCoalesced++
      break
    case 'SPEND-REJECT':
      lifetime.spendRejected++
      win1m.spendRejected++
      break
  }
}

function hitRate(hits, misses) {
  const total = hits + misses
  return total > 0 ? hits / total : 0
}

export function lifetimeSnapshot() {
  return {
    ...lifetime,
    hitRate: hitRate(lifetime.exactHits, lifetime.exactMisses),
  }
}

export function window1mSnapshot() {
  tickWindow()
  return {
    ...win1m,
    hitRate: hitRate(win1m.exactHits, win1m.exactMisses),
  }
}

export function* iterRecent(limit = 20) {
  const n = Math.min(count, limit)
  for (let i = 0; i < n; i++) {
    const idx = (head - 1 - i + SIZE) % SIZE
    if (buf[idx]) yield buf[idx]
  }
}

export function _resetCacheMetrics() {
  for (let i = 0; i < SIZE; i++) buf[i] = undefined
  head = 0
  count = 0
  Object.assign(lifetime, {
    exactHits: 0,
    exactMisses: 0,
    dedupCoalesced: 0,
    spendRejected: 0,
    bytesFromCache: 0,
  })
  Object.assign(win1m, {
    exactHits: 0,
    exactMisses: 0,
    dedupCoalesced: 0,
    spendRejected: 0,
    bytesFromCache: 0,
  })
  win1mReset = Date.now()
}
