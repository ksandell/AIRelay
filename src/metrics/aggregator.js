import { iterRecent } from './collector.js'

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

export function aggregate(seconds) {
  const durations = []
  const statusBuckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 }
  let total = 0
  let errors = 0
  let bytesIn = 0
  let bytesOut = 0
  let totalCostUsd = 0
  let totalTokens = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let toolCalls = 0
  let toolBytesIn = 0
  let toolBytesOut = 0
  let toolInputTokens = 0
  let toolOutputTokens = 0
  const byModel = {}

  for (const ev of iterRecent(seconds)) {
    total++
    durations.push(ev.durationMs ?? 0)
    bytesIn += ev.bytesIn ?? 0
    bytesOut += ev.bytesOut ?? 0

    const cost = ev.costUsd ?? 0
    const toks = ev.totalTokens ?? 0
    totalCostUsd += cost
    totalTokens += toks
    totalInputTokens += ev.inputTokens ?? 0
    totalOutputTokens += ev.outputTokens ?? 0
    toolCalls += ev.toolCalls ?? 0
    toolBytesIn += ev.toolBytesIn ?? 0
    toolBytesOut += ev.toolBytesOut ?? 0
    if ((ev.toolCalls ?? 0) > 0) {
      toolInputTokens += ev.inputTokens ?? 0
      toolOutputTokens += ev.outputTokens ?? 0
    }

    if (ev.model != null) {
      let m = byModel[ev.model]
      if (!m) {
        m = {
          provider: ev.provider ?? null,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        }
        byModel[ev.model] = m
      }
      m.requests++
      m.inputTokens += ev.inputTokens ?? 0
      m.outputTokens += ev.outputTokens ?? 0
      m.costUsd += ev.costUsd ?? 0
    }

    const s = ev.status | 0
    if (s >= 200 && s < 300) statusBuckets['2xx']++
    else if (s >= 300 && s < 400) statusBuckets['3xx']++
    else if (s >= 400 && s < 500) {
      statusBuckets['4xx']++
      errors++
    } else if (s >= 500) {
      statusBuckets['5xx']++
      errors++
    } else statusBuckets.other++

    if (ev.error && s < 400) errors++
  }

  durations.sort((a, b) => a - b)

  for (const k of Object.keys(byModel)) {
    byModel[k].costUsd = +byModel[k].costUsd.toFixed(6)
  }

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

export function summary() {
  return {
    '1m': aggregate(60),
    '5m': aggregate(300),
    '15m': aggregate(900),
  }
}
