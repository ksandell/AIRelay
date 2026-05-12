import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

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

  it('gzips rotated file when ENABLE_COMPRESSION=true and removes the .log', async () => {
    const { config } = await import('../../src/config.js')
    config.enableCompression = true
    try {
      const { rotateLogs } = await import('../../src/logs/rotation.js')
      const active = path.join(tmpDir, 'app.log')
      const payload = 'compressible payload\n'.repeat(50)
      fs.writeFileSync(active, payload)

      rotateLogs()

      await new Promise((r) => setTimeout(r, 150))

      const files = fs.readdirSync(tmpDir)
      const gz = files.find((f) => /^app-.*\.log\.gz$/.test(f))
      const plain = files.find((f) => /^app-.*\.log$/.test(f))
      expect(gz).toBeDefined()
      expect(plain).toBeUndefined()

      const decoded = zlib.gunzipSync(fs.readFileSync(path.join(tmpDir, gz))).toString('utf8')
      expect(decoded).toBe(payload)
      expect(fs.readFileSync(active, 'utf8')).toBe('')
    } finally {
      config.enableCompression = false
    }
  })
})

describe('cleanupOldLogs (gzipped)', () => {
  it('counts .log.gz files toward retention', async () => {
    const { cleanupOldLogs } = await import('../../src/logs/rotation.js')
    for (let i = 1; i <= 5; i++) {
      const name = `app-2026-04-${String(i).padStart(2, '0')}.log.gz`
      fs.writeFileSync(path.join(tmpDir, name), '')
    }
    cleanupOldLogs()
    const remaining = fs.readdirSync(tmpDir).filter((f) => f.startsWith('app-'))
    expect(remaining).toHaveLength(3)
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
