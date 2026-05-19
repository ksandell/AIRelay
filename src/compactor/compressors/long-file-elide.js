import { makeResult } from './base.js'
import { config } from '../../config.js'

// When a text segment exceeds the threshold line count, keep the first and
// last K lines and elide the middle. Marked `risky:true` because it can drop
// content the model needs. Off unless COMPACTOR_ALLOW_RISKY=true.

const KEEP = 50

export const longFileElide = {
  name: 'long-file-elide',
  risky: true,
  appliesTo(s) {
    // Avoid splitting twice — count newlines directly.
    let n = 0
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
    return n >= config.compactorLongFileThreshold
  },
  transform(s) {
    const lines = s.split('\n')
    if (lines.length < config.compactorLongFileThreshold) return makeResult(s, s)
    if (lines.length <= KEEP * 2) return makeResult(s, s)
    const head = lines.slice(0, KEEP)
    const tail = lines.slice(lines.length - KEEP)
    const elided = lines.length - KEEP * 2
    const out = head.concat([`<${elided} lines elided>`], tail).join('\n')
    return makeResult(s, out.length >= s.length ? s : out)
  },
}
