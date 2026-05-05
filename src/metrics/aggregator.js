import { iterRecent } from './collector.js'

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function makeAcc() {
  return {
    durations: [],
    statusBuckets: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 },
    total: 0,
    errors: 0,
    bytesIn: 0,
    bytesOut: 0,
    totalCostUsd: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    toolCalls: 0,
    toolBytesIn: 0,
    toolBytesOut: 0,
    toolInputTokens: 0,
    toolOutputTokens: 0,
    byModel: {},
  }
}

function accumulateEvent(acc, ev) {
  acc.total++
  acc.durations.push(ev.durationMs ?? 0)
  acc.bytesIn += ev.bytesIn ?? 0
  acc.bytesOut += ev.bytesOut ?? 0

  const cost = ev.costUsd ?? 0
  acc.totalCostUsd += cost
  acc.totalTokens += ev.totalTokens ?? 0
  acc.totalInputTokens += ev.inputTokens ?? 0
  acc.totalOutputTokens += ev.outputTokens ?? 0
  acc.toolCalls += ev.toolCalls ?? 0
  acc.toolBytesIn += ev.toolBytesIn ?? 0
  acc.toolBytesOut += ev.toolBytesOut ?? 0
  if ((ev.toolCalls ?? 0) > 0) {
    acc.toolInputTokens += ev.inputTokens ?? 0
    acc.toolOutputTokens += ev.outputTokens ?? 0
  }

  if (ev.model != null) {
    let m = acc.byModel[ev.model]
    if (!m) {
      m = { provider: ev.provider ?? null, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
      acc.byModel[ev.model] = m
    }
    m.requests++
    m.inputTokens += ev.inputTokens ?? 0
    m.outputTokens += ev.outputTokens ?? 0
    m.costUsd += ev.costUsd ?? 0
  }

  const s = ev.status | 0
  if (s >= 200 && s < 300) acc.statusBuckets['2xx']++
  else if (s >= 300 && s < 400) acc.statusBuckets['3xx']++
  else if (s >= 400 && s < 500) { acc.statusBuckets['4xx']++; acc.errors++ }
  else if (s >= 500) { acc.statusBuckets['5xx']++; acc.errors++ }
  else acc.statusBuckets.other++

  if (ev.error && (ev.status | 0) < 400) acc.errors++
}

function finalizeAcc(acc, seconds) {
  acc.durations.sort((a, b) => a - b)
  for (const k of Object.keys(acc.byModel)) {
    acc.byModel[k].costUsd = +acc.byModel[k].costUsd.toFixed(6)
  }
  const { total, errors, durations, bytesIn, bytesOut, totalCostUsd, totalTokens,
    totalInputTokens, totalOutputTokens, toolCalls, toolBytesIn, toolBytesOut,
    toolInputTokens, toolOutputTokens, statusBuckets, byModel } = acc
  return {
    windowSec: seconds,
    total,
    rps: +(total / seconds).toFixed(3),
    errorRate: total ? +(errors / total).toFixed(4) : 0,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    statusBuckets,
    bytesIn,
    bytesOut,
    totalCostUsd: +totalCostUsd.toFixed(6),
    totalTokens,
    tokensPerSec: +(totalTokens / seconds).toFixed(3),
    inputTokensPerSec: +(totalInputTokens / seconds).toFixed(3),
    outputTokensPerSec: +(totalOutputTokens / seconds).toFixed(3),
    toolCalls,
    toolCallsPerMin: +((toolCalls * 60) / seconds).toFixed(3),
    toolBytesIn,
    toolBytesOut,
    toolInputTokensPerSec: +(toolInputTokens / seconds).toFixed(3),
    toolOutputTokensPerSec: +(toolOutputTokens / seconds).toFixed(3),
    byModel,
  }
}

// 1-second memoize: /api/metrics/summary is polled by SSE tick — no need to
// re-scan the ring buffer more than once per second.
let summaryCache = null
let summaryCacheTs = 0

export function summary() {
  const now = Date.now()
  if (summaryCache && now - summaryCacheTs < 1000) return summaryCache

  const WINDOWS = [60, 300, 900]
  const accs = WINDOWS.map(makeAcc)
  const nowSec = now / 1000

  for (const ev of iterRecent(900)) {
    const age = nowSec - new Date(ev.ts).getTime() / 1000
    for (let i = 0; i < WINDOWS.length; i++) {
      if (age <= WINDOWS[i]) accumulateEvent(accs[i], ev)
    }
  }

  summaryCache = {
    '1m': finalizeAcc(accs[0], 60),
    '5m': finalizeAcc(accs[1], 300),
    '15m': finalizeAcc(accs[2], 900),
  }
  summaryCacheTs = now
  return summaryCache
}

// Keep aggregate() for any callers that use a single window (broadcaster tick uses aggregate).
export function aggregate(seconds) {
  const acc = makeAcc()
  const nowSec = Date.now() / 1000
  for (const ev of iterRecent(seconds)) {
    const age = nowSec - new Date(ev.ts).getTime() / 1000
    if (age <= seconds) accumulateEvent(acc, ev)
  }
  return finalizeAcc(acc, seconds)
}

export function _resetSummaryCache() {
  summaryCache = null
  summaryCacheTs = 0
}
