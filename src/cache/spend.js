import { createHash } from 'node:crypto'
import { getClient, isConnected } from './client.js'
import { config } from '../config.js'

function keyHash(apiKey) {
  return createHash('sha256').update(apiKey ?? 'anonymous').digest('hex').slice(0, 16)
}

const dailyKey = (h) => `airelay:spend:${h}:daily:${new Date().toISOString().slice(0, 10)}`
const monthlyKey = (h) => `airelay:spend:${h}:monthly:${new Date().toISOString().slice(0, 7)}`

export function extractApiKey(req) {
  return req.headers['authorization'] ?? req.headers['x-api-key'] ?? null
}

export async function checkSpendLimit(req) {
  if (!isConnected() || !config.cacheSpendEnabled) return null
  const hash = keyHash(extractApiKey(req))
  try {
    const client = getClient()
    const [daily, monthly] = await Promise.all([
      config.cacheSpendDailyLimitUsd != null ? client.get(dailyKey(hash)) : Promise.resolve(null),
      config.cacheSpendMonthlyLimitUsd != null ? client.get(monthlyKey(hash)) : Promise.resolve(null),
    ])
    if (config.cacheSpendDailyLimitUsd != null && parseFloat(daily ?? '0') >= config.cacheSpendDailyLimitUsd) return 'daily'
    if (config.cacheSpendMonthlyLimitUsd != null && parseFloat(monthly ?? '0') >= config.cacheSpendMonthlyLimitUsd) return 'monthly'
  } catch {
    // fail-open: Redis error → allow request
  }
  return null
}

export async function incrementSpend(req, costUsd) {
  if (!isConnected() || !config.cacheSpendEnabled || !costUsd) return
  const hash = keyHash(extractApiKey(req))
  const client = getClient()
  try {
    await Promise.all([
      client.incrbyfloat(dailyKey(hash), costUsd).then(async (v) => {
        if (parseFloat(v) === costUsd) await client.expire(dailyKey(hash), 172_800)
      }),
      client.incrbyfloat(monthlyKey(hash), costUsd).then(async (v) => {
        if (parseFloat(v) === costUsd) await client.expire(monthlyKey(hash), 3_024_000)
      }),
    ])
  } catch {
    // ignore
  }
}
