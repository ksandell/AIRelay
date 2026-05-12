import { open, readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { config } from '../config.js'
import { ROTATED_RE } from './rotation.js'

const activeLog = () => path.join(config.logDir, 'app.log')

// Match `app-YYYY-MM-DD[.N].log[.gz]` and capture the date + optional part.
const ROTATED_DATE_RE = /^app-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log(\.gz)?$/

function parseLines(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { ts: null, level: 'raw', msg: line }
      }
    })
}

async function readFileCapped(filePath) {
  const fh = await open(filePath, 'r')
  try {
    const { size } = await fh.stat()
    const readSize = Math.min(size, config.maxLogReadMb * 1024 * 1024)
    const offset =
      size > config.maxLogReadMb * 1024 * 1024 ? size - config.maxLogReadMb * 1024 * 1024 : 0
    const buf = Buffer.allocUnsafe(readSize)
    const { bytesRead } = await fh.read(buf, 0, readSize, offset)
    return buf.slice(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

// Stream a .gz file through gunzip, enforcing the cap on DECOMPRESSED bytes.
// Aborts (rejects) early if the decompressed stream exceeds the cap so a tiny
// gzip bomb cannot blow up memory.
function readGzippedCapped(filePath) {
  const cap = config.maxLogReadMb * 1024 * 1024
  return new Promise((resolve, reject) => {
    const src = createReadStream(filePath)
    const gunzip = zlib.createGunzip()
    const chunks = []
    let total = 0
    let aborted = false

    const fail = (err) => {
      if (aborted) return
      aborted = true
      src.destroy()
      gunzip.destroy()
      reject(err)
    }

    src.on('error', fail)
    gunzip.on('error', fail)
    gunzip.on('data', (chunk) => {
      total += chunk.length
      if (total > cap) {
        fail(new Error(`Decompressed log exceeds maxLogReadMb (${config.maxLogReadMb} MB)`))
        return
      }
      chunks.push(chunk)
    })
    gunzip.on('end', () => {
      if (aborted) return
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    src.pipe(gunzip)
  })
}

export async function readTail(limit = 500) {
  const filePath = activeLog()
  try {
    const content = await readFileCapped(filePath)
    const lines = parseLines(content)
    return lines.slice(-limit)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// Same-day re-rotation policy: when multiple parts exist for the requested
// date (`app-<date>.log[.gz]`, `app-<date>.1.log[.gz]`, ...), MERGE every part
// into a single response sorted by mtime ascending (oldest first). This keeps
// the API contract date-scoped (`?date=YYYY-MM-DD`) and avoids the need for a
// `&part=N` query param. Compressed (.gz) and plain parts are both honoured.
export async function readHistoricLog(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`)
  }

  let entries
  try {
    entries = await readdir(config.logDir)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }

  const candidates = []
  for (const f of entries) {
    const m = ROTATED_DATE_RE.exec(f)
    if (!m || m[1] !== date) continue
    const full = path.join(config.logDir, f)
    try {
      const s = await stat(full)
      // Parse `.N` part number (undefined for the base file → -1 so it sorts
      // first, matching write order). Used as a tiebreak when same-day
      // re-rotations share mtimeMs (sub-ms FS resolution on Windows / ext4)
      // or after a clock-skew step.
      const part = m[2] === undefined ? -1 : Number(m[2])
      candidates.push({ path: full, gz: Boolean(m[3]), mtime: s.mtimeMs, part })
    } catch {
      /* ignore vanished file */
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.mtime - b.mtime || a.part - b.part)

  const out = []
  for (const c of candidates) {
    const content = c.gz ? await readGzippedCapped(c.path) : await readFileCapped(c.path)
    out.push(...parseLines(content))
  }
  return out
}

// 5-second cache for the available-logs listing (O(N) directory scan).
let availableCache = null
let availableCacheTs = 0
const AVAILABLE_TTL_MS = 5000

export async function listAvailableLogs() {
  const now = Date.now()
  if (availableCache && now - availableCacheTs < AVAILABLE_TTL_MS) {
    return availableCache
  }

  const logDir = config.logDir
  let entries
  try {
    entries = await readdir(logDir)
  } catch (err) {
    if (err.code === 'ENOENT') {
      availableCache = { active: null, rotated: [] }
      availableCacheTs = now
      return availableCache
    }
    throw err
  }

  const active = activeLog()
  let activeInfo = null
  try {
    const s = await stat(active)
    activeInfo = { date: 'today', sizeBytes: s.size }
  } catch {
    // file absent — leave null
  }

  // Reuse the canonical rotation regex so the lister and rotator agree on
  // what constitutes a rotated file (both plain and .gz, plus .N parts).
  const rotatedFiles = entries.filter((f) => ROTATED_RE.test(f) && f !== 'app.log')
  const rotated = await Promise.all(
    rotatedFiles.map(async (f) => {
      const m = ROTATED_DATE_RE.exec(f)
      const date = m ? m[1] : f.slice(4, 14)
      const compressed = Boolean(m && m[3])
      try {
        const s = await stat(path.join(logDir, f))
        return { date, sizeBytes: s.size, compressed }
      } catch {
        return { date, sizeBytes: 0, compressed }
      }
    }),
  )
  rotated.sort((a, b) => b.date.localeCompare(a.date))

  availableCache = { active: activeInfo, rotated }
  availableCacheTs = now
  return availableCache
}

export function _resetAvailableCache() {
  availableCache = null
  availableCacheTs = 0
}
