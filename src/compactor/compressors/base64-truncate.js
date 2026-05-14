import crypto from 'node:crypto'
import { makeResult } from './base.js'

// Detect long base64 runs and replace with a sha256 summary. We accept
// data: URIs and bare base64 blobs of >= MIN_LEN. Conservative: requires
// the run to contain only base64 chars and be at least MIN_LEN long.

const MIN_LEN = 256
// data:image/png;base64,XXXX... — capture the whole URI
const DATA_URI_RE = /data:[^;,\s]+;base64,([A-Za-z0-9+/=]{256,})/g
// Bare runs (no whitespace, no newlines, valid b64 alphabet)
const BARE_B64_RE = /[A-Za-z0-9+/]{256,}={0,2}/g

function summarize(b64) {
  const buf = Buffer.from(b64, 'base64')
  const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12)
  return `<base64: ${buf.length} bytes, sha256:${sha}>`
}

export const base64Truncate = {
  name: 'base64-truncate',
  risky: false,
  appliesTo(s) {
    return s.length >= MIN_LEN && (s.indexOf('base64,') !== -1 || BARE_B64_RE.test(s))
  },
  transform(s) {
    let out = s.replace(DATA_URI_RE, (_m, b64) => summarize(b64))
    // Reset lastIndex on global regex usage
    BARE_B64_RE.lastIndex = 0
    out = out.replace(BARE_B64_RE, (run) => (run.length >= MIN_LEN ? summarize(run) : run))
    return makeResult(s, out.length >= s.length ? s : out)
  },
}
