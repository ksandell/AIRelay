import { config } from '../config.js'
import { scan, redact } from './scanner.js'
import { formatBanner } from './banner.js'
import { recordGuardrailsEvent, recordDetectorHit } from './metrics.js'
import { categoriesActive } from './registry.js'

const HEADER = 'x-guardrails'
const APPLIED_HEADER = 'X-Guardrails-Applied'

function isBypassValue(v) {
  if (v == null) return false
  const s = v.toString().toLowerCase()
  return s === 'off' || s === 'bypass' || s === 'false'
}

function shouldRun(bypassed) {
  if (!config.guardrailsEnabled) return false
  const cats = categoriesActive()
  if (cats.secrets === 'off' && cats.pii === 'off' && cats.injection === 'off') return false
  if (bypassed) return false
  return true
}

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let overflowed = false
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > cap) {
        overflowed = true
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (overflowed) return resolve({ overflowed: true, buf: null })
      resolve({ overflowed: false, buf: Buffer.concat(chunks) })
    })
    req.on('error', reject)
  })
}

const nowIso = () => new Date().toISOString()

function emitBypass(reason, requestId, bytesIn = 0) {
  recordGuardrailsEvent({
    ts: nowIso(),
    requestId,
    mode: 'bypass',
    detectorsFired: [],
    hits: 0,
    bytesIn,
    bytesOut: bytesIn,
    blocked: false,
    durationMicros: 0,
    bypassReason: reason,
  })
}

/**
 * Express middleware mounted under PROXY_PATH_PREFIX, AFTER the Compactor
 * middleware. If Compactor already buffered the body it lives on
 * req._compactorBody; otherwise we read from the raw stream. Either way we
 * stash the (possibly mutated) result on req._guardrailsBody, which the proxy
 * handler prefers over req._compactorBody.
 *
 * Bypass conditions (forward unchanged):
 *   - GUARDRAILS_ENABLED=false
 *   - all category modes == off
 *   - X-Guardrails: off header (stripped before forward)
 *   - method != POST/PUT/PATCH
 *   - non-JSON content-type
 *   - body > GUARDRAILS_MAX_REQ_BYTES  → returns 413
 *   - parse-error → forwarded as-is
 */
export function createGuardrailsMiddleware() {
  return async (req, res, next) => {
    // Read & strip the bypass header before forwarding so it never reaches
    // upstream — regardless of whether we run, bypass-by-header, or bypass-by-
    // disabled. Mirrors Compactor's strip-on-bypass behavior.
    const bypassed = isBypassValue(req.headers[HEADER])
    if (req.headers[HEADER] !== undefined) delete req.headers[HEADER]
    if (!shouldRun(bypassed)) return next()

    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return next()

    const contentType = (req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.includes('application/json')) {
      emitBypass('non-json', req.requestId)
      return next()
    }

    const t0 = process.hrtime.bigint()

    // If Compactor already buffered, reuse its buffer; otherwise read from stream.
    let original
    if (req._compactorBody) {
      original = req._compactorBody
      if (original.length > config.guardrailsMaxReqBytes) {
        emitBypass('oversize', req.requestId, original.length)
        res.statusCode = 413
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            error: 'guardrails buffer cap exceeded; send X-Guardrails: off to bypass',
            cap: config.guardrailsMaxReqBytes,
          }),
        )
        return
      }
    } else {
      let read
      try {
        read = await readBody(req, config.guardrailsMaxReqBytes)
      } catch {
        emitBypass('read-error', req.requestId)
        return next()
      }
      if (read.overflowed) {
        emitBypass('oversize', req.requestId)
        res.statusCode = 413
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            error: 'guardrails buffer cap exceeded; send X-Guardrails: off to bypass',
            cap: config.guardrailsMaxReqBytes,
          }),
        )
        return
      }
      original = read.buf
    }

    const text = original.toString('utf8')
    const { matches, byDetector, modes, hasBlock, hasRedact } = scan(text)

    const t1 = process.hrtime.bigint()
    const durationMicros = Number((t1 - t0) / 1000n)

    // No matches → forward original unchanged.
    if (matches.length === 0) {
      recordGuardrailsEvent({
        ts: nowIso(),
        requestId: req.requestId,
        mode: 'alert', // scanned, no hits
        detectorsFired: [],
        hits: 0,
        bytesIn: original.length,
        bytesOut: original.length,
        blocked: false,
        durationMicros,
        bypassReason: null,
      })
      req._guardrailsBody = original
      req.headers['content-length'] = String(original.length)
      return next()
    }

    // Block mode wins: any detector in block mode rejects the request.
    if (hasBlock) {
      const blockedNames = [
        ...new Set(matches.filter((m) => m.mode === 'block').map((m) => m.name)),
      ]
      for (const m of matches) {
        recordDetectorHit({ name: m.name, hits: 1, bytesRedacted: 0 })
      }
      recordGuardrailsEvent({
        ts: nowIso(),
        requestId: req.requestId,
        mode: 'block',
        detectorsFired: [...new Set(matches.map((m) => m.name))],
        hits: matches.length,
        bytesIn: original.length,
        bytesOut: 0,
        blocked: true,
        durationMicros,
        bypassReason: null,
      })
      res.statusCode = 422
      res.setHeader('Content-Type', 'application/json')
      res.setHeader(APPLIED_HEADER, blockedNames.join(','))
      res.end(
        JSON.stringify({
          error: 'guardrails: request blocked by policy',
          detectors: blockedNames,
          hint: 'set header X-Guardrails: off to bypass (if your policy allows)',
        }),
      )
      return
    }

    // Redact mode: replace matched bytes; verify result still parses as JSON.
    let outBuf = original
    let redactedCount = 0
    let bytesRedactedTotal = 0
    if (hasRedact) {
      const r = redact(text, matches)
      // Safety: redaction may produce invalid JSON if a match spanned a JSON
      // delimiter. Re-parse to verify; on failure, fall back to alert mode for
      // this request and forward unchanged. This preserves the "never break the
      // request" invariant while still recording the detections.
      try {
        JSON.parse(r.text)
        outBuf = Buffer.from(r.text, 'utf8')
        redactedCount = r.redacted
        bytesRedactedTotal = r.bytesRedacted
      } catch {
        outBuf = original
      }
    }

    // Build banner only if we mutated. Prepend it as a JSON string field so it
    // remains valid JSON. Simplest portable shape: inject a top-level
    // "_guardrails_banner" key. We only do this when redact mode actually
    // mutated bytes — keeps alert-mode forwarding byte-identical.
    if (redactedCount > 0) {
      try {
        const parsed = JSON.parse(outBuf.toString('utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const banner = formatBanner({
            detectors: [...new Set(matches.map((m) => m.name))],
            bytesIn: original.length,
            bytesOut: outBuf.length,
            modes: [...modes],
          })
          parsed._guardrails_banner = banner.trim()
          outBuf = Buffer.from(JSON.stringify(parsed), 'utf8')
        }
      } catch {
        // banner injection is best-effort; mutation already recorded.
      }
    }

    // Record per-detector hits + per-request event.
    for (const [name, hits] of Object.entries(byDetector)) {
      recordDetectorHit({
        name,
        hits,
        bytesRedacted:
          hasRedact && redactedCount > 0
            ? matches
                .filter((m) => m.name === name && m.mode === 'redact')
                .reduce((a, m) => a + (m.end - m.start), 0)
            : 0,
      })
    }
    const eventMode = modes.size === 1 ? [...modes][0] : 'mixed'
    recordGuardrailsEvent({
      ts: nowIso(),
      requestId: req.requestId,
      mode: eventMode,
      detectorsFired: [...new Set(matches.map((m) => m.name))],
      hits: matches.length,
      bytesIn: original.length,
      bytesOut: outBuf.length,
      blocked: false,
      durationMicros,
      bypassReason: null,
    })

    res.setHeader(APPLIED_HEADER, [...new Set(matches.map((m) => m.name))].join(','))
    req._guardrailsBody = outBuf
    req.headers['content-length'] = String(outBuf.length)
    // bytesRedactedTotal kept for future per-request observability if needed
    void bytesRedactedTotal
    return next()
  }
}
