import { makeResult } from './base.js'

// Collapse runs of identical consecutive lines.
const MIN_RUN = 3

export const repeatLineDedupe = {
  name: 'repeat-line-dedupe',
  risky: false,
  appliesTo() {
    return true
  },
  transform(s) {
    const lines = s.split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      let j = i + 1
      while (j < lines.length && lines[j] === lines[i]) j++
      const run = j - i
      if (run >= MIN_RUN && lines[i].length > 0) {
        out.push(lines[i])
        out.push(`<line repeated ${run - 1} more times>`)
      } else {
        for (let k = i; k < j; k++) out.push(lines[k])
      }
      i = j
    }
    const joined = out.join('\n')
    return makeResult(s, joined.length >= s.length ? s : joined)
  },
}
