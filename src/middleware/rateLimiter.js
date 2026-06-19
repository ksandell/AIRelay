import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { config } from '../config.js'

// Rate limiter for the dashboard/API routes (/health, /api/*). The proxy hot
// path is intentionally NOT rate-limited — it must absorb unbounded concurrency.
export const apiRateLimiter = rateLimit({
  windowMs: config.apiRateLimitWindowMs,
  limit: config.apiRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // ponytail: ipKeyGenerator handles IPv6 normalisation; fallback for undefined req.ip in Docker
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? 'unknown'),
})
