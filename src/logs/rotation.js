import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { config } from '../config.js'
import { beginRotation, endRotation, closeActiveStream, redirectStream } from './logger.js'

// Streaming gzip; awaited before cleanupOldLogs so retention never sees a
// partial .gz and can't race with the source file being read.
async function compressRotated(src) {
  const dest = `${src}.gz`
  try {
    await pipeline(fs.createReadStream(src), zlib.createGzip(), fs.createWriteStream(dest))
    fs.unlinkSync(src)
  } catch (err) {
    process.stderr.write(`[rotation] gzip failed ${src}: ${err.message}\n`)
    try {
      fs.unlinkSync(dest)
    } catch {
      /* partial .gz may not exist */
    }
  }
}

// Pick a destination that doesn't collide with an existing rotated file or an
// in-flight gzip — handles same-day re-rotation (size guard after a burst).
function uniqueRotatedPath(date) {
  const base = path.join(config.logDir, `app-${date}`)
  let candidate = `${base}.log`
  let i = 1
  while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.gz`)) {
    candidate = `${base}.${i}.log`
    i += 1
  }
  return candidate
}

const activeLog = () => path.join(config.logDir, 'app.log')

function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}

// Retention regex matches both plain and gzipped rotated files, including the
// `.N.log[.gz]` suffix used by uniqueRotatedPath for same-day re-rotation.
const ROTATED_RE = /^app-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.log(?:\.gz)?$/

export async function rotateLogs() {
  const logDir = config.logDir
  fs.mkdirSync(logDir, { recursive: true })

  const active = activeLog()
  const date = todayUTC()

  beginRotation()
  try {
    // 1. Fully close the active write stream BEFORE the rename. On Windows an
    //    open write handle holds a kernel lock that blocks rename; closing
    //    sync isn't enough — must await fd release via the stream 'close' event.
    await closeActiveStream()

    if (fs.existsSync(active)) {
      const dest = uniqueRotatedPath(date)
      fs.renameSync(active, dest)
      if (config.enableCompression) {
        // Await — cleanupOldLogs must not run until the .gz is final, otherwise
        // a partial .gz can be counted toward retention or deleted mid-write.
        await compressRotated(dest)
      }
    }
    // 2. Recreate active file, then point the sink at it. Order matters: the
    //    new stream is opened only AFTER rename, so it can't race with it.
    fs.writeFileSync(active, '', 'utf8')
    redirectStream(active)
    cleanupOldLogs()
  } catch (err) {
    process.stderr.write(`[rotation] failed: ${err.message}\n`)
  } finally {
    endRotation()
  }
}

export function cleanupOldLogs() {
  const logDir = config.logDir

  const files = fs
    .readdirSync(logDir)
    .filter((f) => ROTATED_RE.test(f))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(logDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  const toDelete = files.slice(config.logRetentionDays)
  for (const file of toDelete) {
    try {
      fs.unlinkSync(path.join(logDir, file.name))
    } catch (err) {
      process.stderr.write(`[rotation] delete failed ${file.name}: ${err.message}\n`)
    }
  }
}

export async function rotateLogsIfNeeded() {
  const active = activeLog()

  if (!fs.existsSync(active)) {
    fs.mkdirSync(config.logDir, { recursive: true })
    fs.writeFileSync(active, '', 'utf8')
    return
  }

  const stat = fs.statSync(active)
  const lastModDate = stat.mtime.toISOString().slice(0, 10)
  const today = todayUTC()

  const oversized = stat.size > config.maxLogSizeMb * 1024 * 1024

  if (lastModDate < today || oversized) {
    await rotateLogs()
  }

  cleanupOldLogs()
}

export function startSizeGuard() {
  return setInterval(
    async () => {
      const active = activeLog()
      if (!fs.existsSync(active)) return
      const { size } = fs.statSync(active)
      if (size > config.maxLogSizeMb * 1024 * 1024) {
        try {
          await rotateLogs()
        } catch (err) {
          process.stderr.write(`[rotation] sizeGuard rotateLogs failed: ${err.message}\n`)
        }
      }
    },
    5 * 60 * 1000,
  )
}

export function nextRotationISO() {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toISOString()
}
