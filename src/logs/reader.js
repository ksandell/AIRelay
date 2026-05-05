import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

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

export function readTail(limit = 500) {
  const filePath = activeLog()
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = parseLines(content)
  return lines.slice(-limit)
}

export function readHistoricLog(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`)
  }

  const filePath = path.join(config.logDir, `app-${date}.log`)
  if (!fs.existsSync(filePath)) return null

  const content = fs.readFileSync(filePath, 'utf8')
  return parseLines(content)
}

export function listAvailableLogs() {
  const logDir = config.logDir
  if (!fs.existsSync(logDir)) return { active: null, rotated: [] }

  const active = activeLog()
  const activeInfo = fs.existsSync(active)
    ? { date: 'today', sizeBytes: fs.statSync(active).size }
    : null

  const rotated = fs
    .readdirSync(logDir)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
    .map((f) => {
      const date = f.slice(4, 14)
      const sizeBytes = fs.statSync(path.join(logDir, f)).size
      return { date, sizeBytes }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  return { active: activeInfo, rotated }
}
