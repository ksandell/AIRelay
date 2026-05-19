/**
 * Fallback for unknown providers — emit an unsupported-provider signal
 * and forward bytes untouched.
 */
export function compactPassthrough(body) {
  return { body, fires: [], bytesIn: 0, bytesOut: 0, unsupported: true }
}
