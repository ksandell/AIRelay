import http from 'node:http'
import https from 'node:https'
import { config } from '../config.js'

// Shared agents tuned for high parallelism. Default Node agent caps maxSockets
// at 5/host which serializes excess — fatal for a passthrough proxy under load.
const opts = {
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  scheduling: 'lifo',
}

export const httpAgent = new http.Agent(opts)
// TLS verification is ON by default — required for any real AI provider
// (api.anthropic.com, api.openai.com, etc.). Disabling is opt-in via
// PROXY_INSECURE_TLS=true and intended only for self-signed dev upstreams.
export const httpsAgent = new https.Agent({
  ...opts,
  rejectUnauthorized: !config.proxyInsecureTls,
})

export function pickAgent(targetUrl) {
  return targetUrl.startsWith('https:') ? httpsAgent : httpAgent
}
