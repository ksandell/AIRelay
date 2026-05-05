import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-opt-test-'))

  const { config } = await import('../../src/config.js')
  config.logDir = tmpDir
  config.logRetentionDays = 3
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('rotateLogs', () => {
  it('renames app.log to dated file and creates a new empty app.log', async () => {
    const { rotateLogs } = await import('../../src/logs/rotation.js')
    const active = path.join(tmpDir, 'app.log')
    fs.writeFileSync(active, 'old content\n')

    rotateLogs()

    expect(fs.existsSync(active)).toBe(true)
    expect(fs.readFileSync(active, 'utf8')).toBe('')

    const rotated = fs.readdirSync(tmpDir).filter((f) => f.startsWith('app-') && f.endsWith('.log'))
    expect(rotated).toHaveLength(1)
  })

  it('handles missing app.log gracefully', async () => {
    const { rotateLogs } = await import('../../src/logs/rotation.js')
    expect(() => rotateLogs()).not.toThrow()
  })
})

describe('cleanupOldLogs', () => {
  it('deletes files beyond retention limit', async () => {
    const { cleanupOldLogs } = await import('../../src/logs/rotation.js')

    for (let i = 1; i <= 5; i++) {
      const name = `app-2026-04-${String(i).padStart(2, '0')}.log`
      fs.writeFileSync(path.join(tmpDir, name), '')
    }

    cleanupOldLogs()

    const remaining = fs.readdirSync(tmpDir).filter((f) => f.startsWith('app-'))
    expect(remaining).toHaveLength(3)
  })
})

describe('rotateLogsIfNeeded', () => {
  it('creates app.log if it does not exist', async () => {
    const { rotateLogsIfNeeded } = await import('../../src/logs/rotation.js')
    rotateLogsIfNeeded()
    expect(fs.existsSync(path.join(tmpDir, 'app.log'))).toBe(true)
  })
})
