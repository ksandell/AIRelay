import { config } from '../config.js'

// Client-requested timeout headers, checked in order.
//   X-AIRelay-Timeout-Ms  — milliseconds (AIRelay-native)
//   X-Stainless-Timeout   — seconds (sent by the official OpenAI/Anthropic/Mistral SDKs)
const MS_HEADER = 'x-airelay-timeout-ms'
const SECONDS_HEADER = 'x-stainless-timeout'
const MIN_TIMEOUT_MS = 1000

function parsePositive(raw) {
  if (typeof raw !== 'string') return null
  const n = Number(raw.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Idle timeout (ms) for a request. 0 = disabled.
 * Operator config is the default; a client header may raise or lower it, clamped to
 * [1 s, PROXY_REQUEST_MAX_TIMEOUT_MS]. A client can never disable the watchdog, and
 * nothing is enforced when the operator disabled it (PROXY_REQUEST_IDLE_TIMEOUT_MS=0).
 */
export function resolveTimeoutMs(headers) {
  const base = config.proxyRequestIdleTimeoutMs
  if (base <= 0) return 0
  const ms = parsePositive(headers?.[MS_HEADER])
  const sec = parsePositive(headers?.[SECONDS_HEADER])
  const requested = ms ?? (sec === null ? null : sec * 1000)
  if (requested === null) return base
  return Math.min(Math.max(Math.round(requested), MIN_TIMEOUT_MS), config.proxyRequestMaxTimeoutMs)
}
