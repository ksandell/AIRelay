import path from 'node:path'
import { config } from '../config.js'
import { broadcast } from '../sse/stream.js'
import { createSink } from './sinks.js'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const minLevel = LEVELS[config.logLevel] ?? LEVELS.info

const _sink = createSink(config.logSink, config.logDir)
let _rotating = false // mutex: prevent writes during stream swap

function activeLogPath() {
  return path.join(config.logDir, 'app.log')
}

// Redirect the write stream to a new path without losing buffered data.
// Called by rotation.js after renaming the active file.
export function redirectStream(newPath) {
  if (!_sink.redirect) return
  _rotating = true
  const old = _sink.redirect(newPath)
  // Drain old stream before closing — any in-flight cork/uncork completes first.
  if (old) {
    setImmediate(() => {
      try {
        old.end()
      } catch {
        /* ignore */
      }
      _rotating = false
    })
  } else {
    _rotating = false
  }
}

export function closeStream() {
  _sink.close()
}

function write(level, msg, meta = {}) {
  if ((LEVELS[level] ?? 0) < minLevel) return

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(Object.keys(meta).length ? { meta } : {}),
  }

  const line = JSON.stringify(entry) + '\n'

  if (!_rotating) {
    _sink.write(line, activeLogPath())
  }

  broadcast(entry)
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
}
