import fs from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

const MAX_READ_BYTES = 10 * 1024 * 1024 // 10 MB cap

const activeLog = () => path.join(config.logDir, 'app.log')

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

export async function readTail(limit = 500) {
  const filePath = activeLog()
  try {
    const content = await readFile(filePath, 'utf8')
    const lines = parseLines(content)
    return lines.slice(-limit)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

export async function readHistoricLog(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`)
  }

  const filePath = path.join(config.logDir, `app-${date}.log`)
  try {
    const content = await readFile(filePath, 'utf8')
    return parseLines(content)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
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

  const rotatedFiles = entries.filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
  const rotated = await Promise.all(
    rotatedFiles.map(async (f) => {
      const date = f.slice(4, 14)
      try {
        const s = await stat(path.join(logDir, f))
        return { date, sizeBytes: s.size }
      } catch {
        return { date, sizeBytes: 0 }
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
