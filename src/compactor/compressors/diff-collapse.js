import { makeResult } from './base.js'

// Collapse long runs of unchanged context lines (lines starting with ' ') inside
// a unified diff hunk. Keep CONTEXT lines around each transition so the model
// still sees what surrounds a change. Never touch +/- lines or @@ headers.

const HUNK_RE = /^@@.*@@/
const CONTEXT_KEEP = 3
const MIN_RUN = 8

function isContextLine(line) {
  return line.startsWith(' ')
}
function isChangeLine(line) {
  return line.startsWith('+') || line.startsWith('-')
}
function isHunk(line) {
  return HUNK_RE.test(line)
}

function collapseHunkBody(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    if (!isContextLine(lines[i])) {
      out.push(lines[i])
      i++
      continue
    }
    let j = i
    while (j < lines.length && isContextLine(lines[j])) j++
    const run = j - i
    if (run < MIN_RUN) {
      for (let k = i; k < j; k++) out.push(lines[k])
    } else {
      // Keep first CONTEXT_KEEP and last CONTEXT_KEEP lines; elide middle.
      for (let k = i; k < i + CONTEXT_KEEP; k++) out.push(lines[k])
      out.push(`... ${run - CONTEXT_KEEP * 2} lines unchanged ...`)
      for (let k = j - CONTEXT_KEEP; k < j; k++) out.push(lines[k])
    }
    i = j
  }
  return out
}

function looksLikeUnifiedDiff(s) {
  return s.indexOf('@@') !== -1 && /^@@.*@@/m.test(s)
}

export const diffCollapse = {
  name: 'diff-collapse',
  risky: false,
  appliesTo(s) {
    return looksLikeUnifiedDiff(s)
  },
  transform(s) {
    const lines = s.split('\n')
    const out = []
    let hunkBuf = null
    for (const line of lines) {
      if (isHunk(line)) {
        if (hunkBuf) out.push(...collapseHunkBody(hunkBuf.body))
        hunkBuf = { header: line, body: [] }
        out.push(line)
      } else if (hunkBuf && (isContextLine(line) || isChangeLine(line) || line === '')) {
        hunkBuf.body.push(line)
      } else {
        if (hunkBuf) {
          out.push(...collapseHunkBody(hunkBuf.body))
          hunkBuf = null
        }
        out.push(line)
      }
    }
    if (hunkBuf) out.push(...collapseHunkBody(hunkBuf.body))
    const result = out.join('\n')
    return makeResult(s, result.length >= s.length ? s : result)
  },
}
