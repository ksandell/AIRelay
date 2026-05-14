import { makeResult } from './base.js'

// Detect language-agnostic stack frame indentation and collapse repeated
// adjacent frames pointing at the same location. Conservative: only collapses
// when the SAME frame text repeats 3+ times in a row.

// Identify stack-frame-shaped lines across common runtimes:
//   Node/JS:    "    at funcName (file.js:1:1)"
//   Python:     '  File "x.py", line 1, in funcName'
//   Java/Scala: "    at com.foo.Bar.baz(Bar.java:1)"
//   Ruby:       "    from /path/to/file.rb:1:in `method'"
//   Go:         "    main.go:1 +0x0"
function isFrameLine(line) {
  if (/^\s+at\s+/.test(line)) return true
  if (/^\s+File\s+"/.test(line)) return true
  if (/^\s+from\s+\S+/.test(line)) return true
  if (/^\s{2,}.*\.go:\d+/.test(line)) return true
  return false
}

export const stacktraceDedupe = {
  name: 'stacktrace-dedupe',
  risky: false,
  appliesTo(s) {
    return /\s+at\s+/.test(s) || /\s+File\s+"/.test(s)
  },
  transform(s) {
    const lines = s.split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      if (isFrameLine(lines[i])) {
        let j = i + 1
        while (j < lines.length && lines[j] === lines[i]) j++
        const run = j - i
        if (run >= 3) {
          out.push(lines[i])
          out.push(`    <frame repeated ${run - 1} more times>`)
        } else {
          for (let k = i; k < j; k++) out.push(lines[k])
        }
        i = j
      } else {
        out.push(lines[i])
        i++
      }
    }
    const joined = out.join('\n')
    return makeResult(s, joined.length >= s.length ? s : joined)
  },
}
