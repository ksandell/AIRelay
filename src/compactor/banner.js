/**
 * Banner prepended to mutated text segments so the model can see which
 * compressors fired and how to request raw output. Mirrors the design intent
 * of VSCode 1.120's `chat.tools.compressOutput.enabled` feature.
 */

export function formatBanner({ filters, bytesIn, bytesOut }) {
  const ratio = bytesIn > 0 ? Math.round((1 - bytesOut / bytesIn) * 100) : 0
  const names = filters.join(',')
  return (
    `[compactor: applied filters=${names}; bytes ${bytesIn}->${bytesOut} ` +
    `(-${ratio}%); set header X-Compactor: off to bypass]\n`
  )
}

export const BANNER_PREFIX = '[compactor:'
