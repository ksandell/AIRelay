/**
 * Banner prepended to mutated bodies so the model can see which guardrails
 * fired and how to request raw. Format mirrors Compactor's banner so dashboards
 * and downstream tooling can parse both with the same shape.
 */

export function formatBanner({ detectors, bytesIn, bytesOut, modes }) {
  const ratio = bytesIn > 0 ? Math.round((1 - bytesOut / bytesIn) * 100) : 0
  const names = detectors.join(',')
  const modeStr = [...new Set(modes)].join('/')
  return (
    `[guardrails: ${modeStr} detectors=${names}; bytes ${bytesIn}->${bytesOut} ` +
    `(-${ratio}%); set header X-Guardrails: off to bypass]\n`
  )
}

export const BANNER_PREFIX = '[guardrails:'
