import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

const activeLog = () => path.join(config.logDir, 'app.log')

function rotatedPath(date) {
  return path.join(config.logDir, `app-${date}.log`)
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}

export function rotateLogs() {
  const logDir = config.logDir
  fs.mkdirSync(logDir, { recursive: true })

  const active = activeLog()
  const date = todayUTC()
  const dest = rotatedPath(date)

  try {
    if (fs.existsSync(active)) {
      fs.renameSync(active, dest)
    }
    fs.writeFileSync(active, '', 'utf8')
    cleanupOldLogs()
  } catch (err) {
    process.stderr.write(`[rotation] failed: ${err.message}\n`)
  }
}

export function cleanupOldLogs() {
  const logDir = config.logDir

  const files = fs
    .readdirSync(logDir)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
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

export function rotateLogsIfNeeded() {
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
    rotateLogs()
  }

  cleanupOldLogs()
}

export function startSizeGuard() {
  return setInterval(
    () => {
      const active = activeLog()
      if (!fs.existsSync(active)) return
      const { size } = fs.statSync(active)
      if (size > config.maxLogSizeMb * 1024 * 1024) {
        rotateLogs()
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
