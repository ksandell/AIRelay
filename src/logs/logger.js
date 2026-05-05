import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { broadcast } from '../sse/stream.js'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const minLevel = LEVELS[config.logLevel] ?? LEVELS.info

function activeLogPath() {
  return path.join(config.logDir, 'app.log')
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

  try {
    fs.mkdirSync(config.logDir, { recursive: true })
    fs.appendFileSync(activeLogPath(), line, 'utf8')
  } catch (err) {
    process.stderr.write(`[logger] write failed: ${err.message}\n`)
  }

  broadcast(entry)
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
}
