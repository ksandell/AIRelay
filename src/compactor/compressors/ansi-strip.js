import { makeResult } from './base.js'

// Strip ANSI escape sequences. Two patterns cover the common cases:
//   CSI / SGR : ESC [ <params> <final-byte>
//   OSC       : ESC ] ... BEL  (or ESC \)
//   SS3 / 2-byte: ESC <single>
const ESC = ''
// eslint-disable-next-line no-control-regex
const CSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g
// eslint-disable-next-line no-control-regex
const OSC_RE = /\][^]*(?:|\\)/g
// eslint-disable-next-line no-control-regex
const SHORT_RE = /[@-Z\\-_]/g

export const ansiStrip = {
  name: 'ansi-strip',
  risky: false,
  appliesTo(s) {
    return s.indexOf(ESC) !== -1
  },
  transform(s) {
    const out = s.replace(CSI_RE, '').replace(OSC_RE, '').replace(SHORT_RE, '')
    return makeResult(s, out)
  },
}
