import rateLimit from 'express-rate-limit'
import { config } from '../config.js'

// Rate limiter for the dashboard/API routes (/health, /api/*). The proxy hot
// path is intentionally NOT rate-limited — it must absorb unbounded concurrency.
export const apiRateLimiter = rateLimit({
  windowMs: config.apiRateLimitWindowMs,
  limit: config.apiRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // ponytail: draft-8 hashes keyGenerator result; undefined req.ip (Docker/proxy) throws TypeError and hangs the request
  keyGenerator: (req) => req.ip ?? req.socket?.remoteAddress ?? 'unknown',
})
