import { config } from '../config.js'

const MAX_BYTES = 1_048_576
const SEED_RE = /"seed"\s*:/

function readBody(req) {
  const prior = req._guardrailsBody ?? req._compactorBody ?? req._cacheBodyBuffer
  if (prior) return Promise.resolve(prior)
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Rename the OpenAI-spec `seed` to Mistral's `random_seed` (issue #194).
 * Opt-in (PROXY_MAP_SEED=true), Mistral routes only, small JSON bodies only.
 * Everything else streams through untouched. The rewritten body is stashed on
 * req._guardrailsBody, the proxy handler's highest-precedence substitute slot.
 */
export function createSeedMapMiddleware(route) {
  if (route.provider !== 'mistral') return (_req, _res, next) => next()

  return async (req, res, next) => {
    try {
      const declared = Number(req.headers['content-length'])
      if (
        !config.proxyMapSeed ||
        req.method !== 'POST' ||
        !(req.headers['content-type'] ?? '').includes('application/json') ||
        !(declared > 0 && declared <= MAX_BYTES)
      ) {
        return next()
      }
      const buf = await readBody(req)
      let out = buf
      if (SEED_RE.test(buf.toString('utf8'))) {
        try {
          const body = JSON.parse(buf.toString('utf8'))
          if (body && typeof body === 'object' && 'seed' in body) {
            const { seed, ...rest } = body
            out = Buffer.from(
              JSON.stringify('random_seed' in rest ? rest : { ...rest, random_seed: seed }),
            )
          }
        } catch {
          // not valid JSON — forward as-is, upstream reports the error
        }
      }
      req._guardrailsBody = out
      req.headers['content-length'] = String(out.length)
      next()
    } catch (err) {
      next(err)
    }
  }
}
