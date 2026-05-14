import { makeResult } from './base.js'

// Detect a lockfile diff inside a unified-diff segment and replace its body
// with a one-line summary. Lockfile diffs are nearly always noise to the
// model and can run thousands of lines.

const LOCKFILE_BASENAMES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-lock.yml',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
  'Pipfile.lock',
  'go.sum',
]

const FILE_HEADER_RE = /^(?:diff --git |--- |\+\+\+ |Index: )(.+)$/

function isLockfilePath(line) {
  const m = line.match(FILE_HEADER_RE)
  if (!m) return false
  const lower = m[1].toLowerCase()
  return LOCKFILE_BASENAMES.some((name) => lower.endsWith('/' + name) || lower.endsWith(name))
}

export const lockfileDrop = {
  name: 'lockfile-drop',
  risky: false,
  appliesTo(s) {
    if (s.indexOf('diff --git') === -1 && s.indexOf('--- ') === -1) return false
    const lower = s.toLowerCase()
    return LOCKFILE_BASENAMES.some((n) => lower.indexOf(n.toLowerCase()) !== -1)
  },
  transform(s) {
    const lines = s.split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      if (isLockfilePath(lines[i])) {
        // Capture all header lines for this file (diff --git, index, ---, +++)
        const startHeader = i
        const fileLine = lines[i]
        // Advance to end of header block
        while (
          i < lines.length &&
          (lines[i].startsWith('diff --git') ||
            lines[i].startsWith('index ') ||
            lines[i].startsWith('--- ') ||
            lines[i].startsWith('+++ ') ||
            lines[i].startsWith('Index: ') ||
            lines[i].startsWith('===') ||
            lines[i].startsWith('new file mode') ||
            lines[i].startsWith('deleted file mode') ||
            lines[i].startsWith('similarity index') ||
            lines[i].startsWith('rename from') ||
            lines[i].startsWith('rename to'))
        ) {
          i++
        }
        // Skip body until the next file header or EOF
        const bodyStart = i
        while (
          i < lines.length &&
          !lines[i].startsWith('diff --git') &&
          !(lines[i].startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ '))
        ) {
          i++
        }
        const omitted = i - bodyStart
        if (omitted < 4) {
          // Not worth eliding
          for (let k = startHeader; k < i; k++) out.push(lines[k])
        } else {
          out.push(fileLine)
          out.push(`<lockfile diff omitted: ${omitted} lines>`)
        }
      } else {
        out.push(lines[i])
        i++
      }
    }
    const joined = out.join('\n')
    return makeResult(s, joined.length >= s.length ? s : joined)
  },
}
