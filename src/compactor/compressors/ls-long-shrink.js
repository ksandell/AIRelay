import { makeResult } from './base.js'

// Match `ls -l` style entries:
//   -rw-r--r--  1 user group 12345 May 10 12:34 filename
// Optional 'total N' header. We keep just the filename column.

const LS_LINE_RE =
  /^([-dlcbsp])([rwxstST-]{9}\+?)\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+(?:\d{4}|\d{1,2}:\d{2})\s+(.+)$/

const TOTAL_RE = /^total\s+\d+$/

function lineLooksLikeLsLong(line) {
  return LS_LINE_RE.test(line)
}

export const lsLongShrink = {
  name: 'ls-long-shrink',
  risky: false,
  appliesTo(s) {
    // Cheap probe: at least one `-rw` or `drwx` prefix.
    return /(^|\n)([-d][rwxstST-]{9})/.test(s)
  },
  transform(s) {
    const lines = s.split('\n')
    let blockStart = -1
    const out = []
    const flush = (endExclusive) => {
      if (blockStart < 0) return
      const blockLen = endExclusive - blockStart
      if (blockLen < 3) {
        for (let k = blockStart; k < endExclusive; k++) out.push(lines[k])
      } else {
        for (let k = blockStart; k < endExclusive; k++) {
          const line = lines[k]
          if (TOTAL_RE.test(line)) continue
          const m = line.match(LS_LINE_RE)
          if (m) out.push(m[3])
          else out.push(line)
        }
      }
      blockStart = -1
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const inBlock = lineLooksLikeLsLong(line) || TOTAL_RE.test(line)
      if (inBlock) {
        if (blockStart < 0) blockStart = i
      } else {
        flush(i)
        out.push(line)
      }
    }
    flush(lines.length)
    const joined = out.join('\n')
    return makeResult(s, joined.length >= s.length ? s : joined)
  },
}
