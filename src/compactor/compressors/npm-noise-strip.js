import { makeResult } from './base.js'

// Filter rules for npm/yarn/pnpm noise. Each rule is matched per-line.
// Errors (lines starting with `npm ERR!` or containing "Error:") are NEVER stripped.

const STRIP_PATTERNS = [
  /^npm WARN deprecated\b/,
  /^npm notice\b/,
  /^npm fund\b/,
  /^\d+ packages? are looking for funding\b/,
  /^\s+run `npm fund` for details/,
  /^found \d+ vulnerabilities/,
  /^\s*\d+\s+(low|moderate|high|critical) severity/,
  /^To address (?:all issues|issues that do not require attention).*?run:/,
  /^Run `npm audit` for details/,
  // Progress bars: lines containing only [====>     ] style
  /^\s*[█▒░=#>-]+\s*$/,
  /^\[\s*\.+\s*\]\s*$/,
  // Yarn / pnpm equivalents
  /^warning Workspaces can only be enabled in private projects/,
  /^warning .* is deprecated\b/i,
  /^Progress: resolved \d+, reused \d+/,
  /^\s*Packages: \+\d+\s*$/,
]

export const npmNoiseStrip = {
  name: 'npm-noise-strip',
  risky: false,
  appliesTo(s) {
    return (
      s.indexOf('npm WARN') !== -1 ||
      s.indexOf('npm notice') !== -1 ||
      s.indexOf('npm fund') !== -1 ||
      s.indexOf('npm audit') !== -1 ||
      s.indexOf('vulnerabilities') !== -1 ||
      s.indexOf('Progress: resolved') !== -1
    )
  },
  transform(s) {
    const lines = s.split('\n')
    const out = []
    for (const line of lines) {
      let drop = false
      for (const p of STRIP_PATTERNS) {
        if (p.test(line)) {
          drop = true
          break
        }
      }
      if (!drop) out.push(line)
    }
    const joined = out.join('\n')
    return makeResult(s, joined.length >= s.length ? s : joined)
  },
}
