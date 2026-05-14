import { makeResult } from './base.js'

// 3+ consecutive blank lines (possibly containing whitespace) collapse to 1.
const MULTI_BLANK = /(?:[ \t]*\r?\n){3,}/g

export const blanklineCollapse = {
  name: 'blankline-collapse',
  risky: false,
  appliesTo(s) {
    return s.indexOf('\n\n\n') !== -1
  },
  transform(s) {
    const out = s.replace(MULTI_BLANK, '\n\n')
    return makeResult(s, out)
  },
}
