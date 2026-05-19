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
export const ROTATED_RE = /^app-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.log(?:\.gz)?$/

export async function rotateLogs() {
  const logDir = config.logDir
  fs.mkdirSync(logDir, { recursive: true })

  const active = activeLog()
  const date = todayUTC()

  beginRotation()
  let rotatedDest = null
  try {
    // 1. Fully close the active write stream BEFORE the rename. On Windows an
    //    open write handle holds a kernel lock that blocks rename; closing
    //    sync isn't enough — must await fd release via the stream 'close' event.
    await closeActiveStream()

    if (fs.existsSync(active)) {
      rotatedDest = uniqueRotatedPath(date)
      fs.renameSync(active, rotatedDest)
    }
    // 2. Recreate active file and reopen the sink IMMEDIATELY after rename so
    //    the rotation drop-window (during which logger writes are skipped) is
    //    bounded to the rename itself, not to rename + gzip + cleanup. Gzip
    //    runs after the sink is back online.
    fs.writeFileSync(active, '', 'utf8')
    redirectStream(active)
  } finally {
    endRotation()
  }

  // 3. Post-swap, non-blocking phases. Errors here propagate to the caller
  //    (cron / sizeGuard) instead of being swallowed, so failed compression
  //    or retention deletes are visible in stderr and metrics.
  if (rotatedDest && config.enableCompression) {
    await compressRotated(rotatedDest)
  }
  cleanupOldLogs()
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
