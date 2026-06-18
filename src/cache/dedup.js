const _inflight = new Map()

export function dedupGet(sha256) {
  return _inflight.get(sha256) ?? null
}

export function dedupSet(sha256, promise) {
  _inflight.set(sha256, promise)
}

export function dedupDelete(sha256) {
  _inflight.delete(sha256)
}

export function dedupSize() {
  return _inflight.size
}
