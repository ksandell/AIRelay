import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-opt-reader-'))
  const { config } = await import('../../src/config.js')
  config.logDir = tmpDir
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('readTail', () => {
  it('returns parsed JSONL entries', async () => {
    const { readTail } = await import('../../src/logs/reader.js')
    const active = path.join(tmpDir, 'app.log')
    fs.writeFileSync(active, '{"ts":"2026-04-29T00:00:00.000Z","level":"info","msg":"hello"}\n')

    const entries = readTail(10)
    expect(entries).toHaveLength(1)
    expect(entries[0].msg).toBe('hello')
  })

  it('returns empty array when log file missing', async () => {
    const { readTail } = await import('../../src/logs/reader.js')
    expect(readTail()).toEqual([])
  })

  it('respects the limit', async () => {
    const { readTail } = await import('../../src/logs/reader.js')
    const active = path.join(tmpDir, 'app.log')
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ ts: '2026-04-29T00:00:00.000Z', level: 'info', msg: `line ${i}` }),
    ).join('\n') + '\n'
    fs.writeFileSync(active, lines)

    expect(readTail(3)).toHaveLength(3)
  })
})

describe('readHistoricLog', () => {
  it('returns null when file not found', async () => {
    const { readHistoricLog } = await import('../../src/logs/reader.js')
    expect(readHistoricLog('2026-01-01')).toBeNull()
  })

  it('throws on invalid date format', async () => {
    const { readHistoricLog } = await import('../../src/logs/reader.js')
    expect(() => readHistoricLog('not-a-date')).toThrow()
  })
})

describe('listAvailableLogs', () => {
  it('lists rotated files sorted newest first', async () => {
    const { listAvailableLogs } = await import('../../src/logs/reader.js')
    fs.writeFileSync(path.join(tmpDir, 'app.log'), '')
    fs.writeFileSync(path.join(tmpDir, 'app-2026-04-28.log'), 'x')
    fs.writeFileSync(path.join(tmpDir, 'app-2026-04-27.log'), 'xx')

    const { rotated } = listAvailableLogs()
    expect(rotated[0].date).toBe('2026-04-28')
    expect(rotated[1].date).toBe('2026-04-27')
  })
})
