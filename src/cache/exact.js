import { getClient, isConnected } from './client.js'
import { config } from '../config.js'

const PREFIX = 'airelay:exact:'

export async function exactGet(sha256) {
  if (!isConnected() || !config.cacheExactMatchEnabled) return null
  try {
    const val = await getClient().get(PREFIX + sha256)
    return val ? JSON.parse(val) : null
  } catch {
    return null
  }
}

export async function exactSet(sha256, entry) {
  if (!isConnected() || !config.cacheExactMatchEnabled) return
  try {
    await getClient().set(
      PREFIX + sha256,
      JSON.stringify({ ...entry, cachedAt: Date.now() }),
      'EX',
      config.cacheExactTtlSeconds,
    )
  } catch {
    // ignore — miss is safe
  }
}

export async function exactKeyCount() {
  if (!isConnected()) return 0
  try { return await getClient().dbsize() } catch { return 0 }
}
