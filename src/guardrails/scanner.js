import { activeDetectors } from './registry.js'

/**
 * Scan a text blob against all active detectors. Returns:
 *   {
 *     matches: [{ name, category, mode, start, end, value }],
 *     byDetector: { name: count },
 *     modes: Set<'alert' | 'block' | 'redact'>,
 *     hasBlock: boolean,
 *     hasRedact: boolean,
 *   }
 *
 * Pure & sync. Overlapping matches from different detectors are kept; the
 * caller (middleware) decides how to apply replacements (longest-first wins).
 */
export function scan(text) {
  const detectors = activeDetectors()
  const matches = []
  const byDetector = {}
  const modes = new Set()
  let hasBlock = false
  let hasRedact = false

  for (const d of detectors) {
    // Reset RegExp lastIndex defensively: registry detectors share regex
    // instances across requests.
    d.regex.lastIndex = 0
    let m
    while ((m = d.regex.exec(text)) !== null) {
      const value = m[0]
      if (d.validate && !d.validate(value)) continue
      matches.push({
        name: d.name,
        category: d.category,
        mode: d.mode,
        start: m.index,
        end: m.index + value.length,
        value,
      })
      byDetector[d.name] = (byDetector[d.name] ?? 0) + 1
      modes.add(d.mode)
      if (d.mode === 'block') hasBlock = true
      if (d.mode === 'redact') hasRedact = true
      // Guard against zero-width matches causing infinite loops.
      if (m.index === d.regex.lastIndex) d.regex.lastIndex++
    }
  }

  return { matches, byDetector, modes, hasBlock, hasRedact }
}

/**
 * Apply redactions to text. Only matches whose mode === 'redact' are replaced;
 * other matches (alert/block) are reported but the bytes are left intact.
 *
 * Overlap resolution: longest-match-first. If two matches overlap, the longer
 * (or earlier on tie) wins; the shorter is dropped. This keeps redactions
 * deterministic and avoids partial-mangled output.
 */
export function redact(text, matches) {
  const redactable = matches.filter((m) => m.mode === 'redact')
  if (redactable.length === 0) return { text, redacted: 0, bytesRedacted: 0 }

  // Sort: start asc, then length desc — so we can walk left-to-right and
  // skip any match that begins inside the previously emitted range.
  redactable.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))

  const out = []
  let cursor = 0
  let redacted = 0
  let bytesRedacted = 0
  for (const m of redactable) {
    if (m.start < cursor) continue // overlapped by an earlier (longer) match
    out.push(text.slice(cursor, m.start))
    out.push(`<redacted:${m.name}>`)
    cursor = m.end
    redacted++
    bytesRedacted += m.end - m.start
  }
  out.push(text.slice(cursor))
  return { text: out.join(''), redacted, bytesRedacted }
}
