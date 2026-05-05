import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { broadcast } from '../sse/stream.js'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const minLevel = LEVELS[config.logLevel] ?? LEVELS.info

// Single persistent WriteStream — eliminates per-write file-open overhead and
// removes sync I/O from the event loop. Replaced atomically on log rotation.
let _stream = null
let _streamPath = null
let _rotating = false // mutex: prevent writes during stream swap

function activeLogPath() {
  return path.join(config.logDir, 'app.log')
}

function openStream(filePath) {
  const s = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })
  s.on('error', (err) => {
    process.stderr.write(`[logger] stream error: ${err.message}\n`)
  })
  return s
}

function getStream() {
  const target = activeLogPath()
  if (!_stream || _streamPath !== target) {
    if (_stream) {
      try { _stream.end() } catch { /* ignore */ }
    }
    fs.mkdirSync(config.logDir, { recursive: true })
    _stream = openStream(target)
    _streamPath = target
  }
  return _stream
}

// Redirect the write stream to a new path without losing buffered data.
// Called by rotation.js after renaming the active file.
export function redirectStream(newPath) {
  _rotating = true
  const old = _stream
  _stream = openStream(newPath)
  _streamPath = newPath
  // Drain old stream before closing — any in-flight cork/uncork completes first.
  if (old) {
    setImmediate(() => {
      try { old.end() } catch { /* ignore */ }
      _rotating = false
    })
  } else {
    _rotating = false
  }
}

export function closeStream() {
  if (_stream) {
    try { _stream.end() } catch { /* ignore */ }
    _stream = null
    _streamPath = null
  }
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
    try {
      const s = getStream()
      // cork batches the write into the current tick's kernel buffer flush.
      s.cork()
      s.write(line)
      process.nextTick(() => s.uncork())
    } catch (err) {
      process.stderr.write(`[logger] write failed: ${err.message}\n`)
    }
  }

  broadcast(entry)
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
}
