import { config } from '../config.js'
import { ansiStrip } from './compressors/ansi-strip.js'
import { blanklineCollapse } from './compressors/blankline-collapse.js'
import { diffCollapse } from './compressors/diff-collapse.js'
import { lockfileDrop } from './compressors/lockfile-drop.js'
import { lsLongShrink } from './compressors/ls-long-shrink.js'
import { npmNoiseStrip } from './compressors/npm-noise-strip.js'
import { repeatLineDedupe } from './compressors/repeat-line-dedupe.js'
import { stacktraceDedupe } from './compressors/stacktrace-dedupe.js'
import { longFileElide } from './compressors/long-file-elide.js'
import { base64Truncate } from './compressors/base64-truncate.js'

// Fixed application order. Normalizers (ansi-strip, blankline-collapse) run
// first so downstream compressors see canonical input. Risky compressors run
// last so they elide content already shrunk by safer passes.
const ALL = [
  { c: ansiStrip, key: 'ansiStrip' },
  { c: blanklineCollapse, key: 'blanklineCollapse' },
  { c: lockfileDrop, key: 'lockfileDrop' },
  { c: diffCollapse, key: 'diffCollapse' },
  { c: lsLongShrink, key: 'lsLongShrink' },
  { c: npmNoiseStrip, key: 'npmNoiseStrip' },
  { c: repeatLineDedupe, key: 'repeatLineDedupe' },
  { c: stacktraceDedupe, key: 'stacktraceDedupe' },
  { c: base64Truncate, key: 'base64Truncate' },
  { c: longFileElide, key: 'longFileElide' },
]

export function activeCompressors() {
  const out = []
  for (const { c, key } of ALL) {
    if (!config.compactor[key]) continue
    if (c.risky && !config.compactorAllowRisky) continue
    out.push(c)
  }
  return out
}

export function allCompressorNames() {
  return ALL.map(({ c }) => c.name)
}
