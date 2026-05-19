import { activeCompressors } from './registry.js'
import { formatBanner } from './banner.js'

/**
 * Run a text segment through the active compressors in registry order.
 * Returns { text, fires: [{name, bytesBefore, bytesAfter, durationMicros}],
 *           bytesBefore, bytesAfter }
 *
 * Pure & sync. If at least one compressor fires, a banner is prepended to the
 * returned text so the model can audit what changed.
 */
export function runPipeline(input) {
  const compressors = activeCompressors()
  const fires = []
  let current = input
  const bytesBefore = Buffer.byteLength(input, 'utf8')
  for (const c of compressors) {
    if (!c.appliesTo(current)) continue
    const t0 = process.hrtime.bigint()
    const r = c.transform(current)
    const t1 = process.hrtime.bigint()
    if (r.fired && r.bytesAfter < r.bytesBefore) {
      fires.push({
        name: c.name,
        bytesBefore: r.bytesBefore,
        bytesAfter: r.bytesAfter,
        durationMicros: Number((t1 - t0) / 1000n),
      })
      current = r.text
    }
  }
  const bytesAfter = Buffer.byteLength(current, 'utf8')
  if (fires.length > 0) {
    const banner = formatBanner({
      filters: fires.map((f) => f.name),
      bytesIn: bytesBefore,
      bytesOut: bytesAfter,
    })
    current = banner + current
  }
  return {
    text: current,
    fires,
    bytesBefore,
    bytesAfter: Buffer.byteLength(current, 'utf8'),
  }
}
