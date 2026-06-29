import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { config } from '../config.js'

// Rate limiter for the dashboard/API routes (/health, /api/*). The proxy hot
// path is intentionally NOT rate-limited — it must absorb unbounded concurrency.
export const apiRateLimiter = rateLimit({
  windowMs: config.apiRateLimitWindowMs,
  limit: config.apiRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // SSE streams are long-lived and auto-reconnect. Counting them (and their
  // reconnects) against the cap lets a dashboard burst trip 429, after which the
  // stream can never re-establish and the live charts freeze. Never limit them.
  skip: (req) => req.path.endsWith('/stream'),
  // ponytail: ipKeyGenerator handles IPv6 normalisation; fallback for undefined req.ip in Docker
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? 'unknown'),
})
