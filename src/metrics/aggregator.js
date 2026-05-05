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

  for (const ev of iterRecent(seconds)) {
    total++
    durations.push(ev.durationMs ?? 0)
    bytesIn += ev.bytesIn ?? 0
    bytesOut += ev.bytesOut ?? 0

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
  }
}

export function summary() {
  return {
    '1m': aggregate(60),
    '5m': aggregate(300),
    '15m': aggregate(900),
  }
}
