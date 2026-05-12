import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

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

    const entries = await readTail(10)
    expect(entries).toHaveLength(1)
    expect(entries[0].msg).toBe('hello')
  })

  it('returns empty array when log file missing', async () => {
    const { readTail } = await import('../../src/logs/reader.js')
    expect(await readTail()).toEqual([])
  })

  it('respects the limit', async () => {
    const { readTail } = await import('../../src/logs/reader.js')
    const active = path.join(tmpDir, 'app.log')
    const lines =
      Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({ ts: '2026-04-29T00:00:00.000Z', level: 'info', msg: `line ${i}` }),
      ).join('\n') + '\n'
    fs.writeFileSync(active, lines)

    expect(await readTail(3)).toHaveLength(3)
  })
})

describe('readHistoricLog', () => {
  it('returns null when file not found', async () => {
    const { readHistoricLog } = await import('../../src/logs/reader.js')
    expect(await readHistoricLog('2026-01-01')).toBeNull()
  })

  it('throws on invalid date format', async () => {
    const { readHistoricLog } = await import('../../src/logs/reader.js')
    await expect(readHistoricLog('not-a-date')).rejects.toThrow()
  })

  it('decodes a .log.gz file when plain .log absent', async () => {
    const { readHistoricLog } = await import('../../src/logs/reader.js')
    const ndjson =
      JSON.stringify({ ts: '2026-05-12T00:00:00.000Z', level: 'info', msg: 'gz-line' }) + '\n'
    fs.writeFileSync(path.join(tmpDir, 'app-2026-05-12.log.gz'), zlib.gzipSync(Buffer.from(ndjson)))
    const entries = await readHistoricLog('2026-05-12')
    expect(entries).toHaveLength(1)
    expect(entries[0].msg).toBe('gz-line')
  })

  it('merges same-day re-rotation .N.log.gz parts sorted by mtime', async () => {
    const { readHistoricLog } = await import('../../src/logs/reader.js')
    const a = JSON.stringify({ ts: '2026-05-12T00:00:00.000Z', level: 'info', msg: 'part0' }) + '\n'
    const b = JSON.stringify({ ts: '2026-05-12T01:00:00.000Z', level: 'info', msg: 'part1' }) + '\n'
    const p0 = path.join(tmpDir, 'app-2026-05-12.log.gz')
    const p1 = path.join(tmpDir, 'app-2026-05-12.1.log.gz')
    fs.writeFileSync(p0, zlib.gzipSync(Buffer.from(a)))
    fs.writeFileSync(p1, zlib.gzipSync(Buffer.from(b)))
    // force p0 older than p1
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(p0, past, past)
    const entries = await readHistoricLog('2026-05-12')
    expect(entries.map((e) => e.msg)).toEqual(['part0', 'part1'])
  })

  it('aborts when decompressed size exceeds maxLogReadMb', async () => {
    const { config } = await import('../../src/config.js')
    const { readHistoricLog } = await import('../../src/logs/reader.js')
    const origCap = config.maxLogReadMb
    config.maxLogReadMb = 0.001 // 1024 bytes
    try {
      const big = 'x'.repeat(8192) + '\n'
      fs.writeFileSync(path.join(tmpDir, 'app-2026-05-12.log.gz'), zlib.gzipSync(Buffer.from(big)))
      await expect(readHistoricLog('2026-05-12')).rejects.toThrow(/exceed/i)
    } finally {
      config.maxLogReadMb = origCap
    }
  })
})

describe('listAvailableLogs', () => {
  it('lists rotated files sorted newest first', async () => {
    const { listAvailableLogs, _resetAvailableCache } = await import('../../src/logs/reader.js')
    _resetAvailableCache()
    fs.writeFileSync(path.join(tmpDir, 'app.log'), '')
    fs.writeFileSync(path.join(tmpDir, 'app-2026-04-28.log'), 'x')
    fs.writeFileSync(path.join(tmpDir, 'app-2026-04-27.log'), 'xx')

    const { rotated } = await listAvailableLogs()
    expect(rotated[0].date).toBe('2026-04-28')
    expect(rotated[1].date).toBe('2026-04-27')
  })

  it('includes .log.gz rotated files with compressed: true flag', async () => {
    const { listAvailableLogs, _resetAvailableCache } = await import('../../src/logs/reader.js')
    _resetAvailableCache()
    fs.writeFileSync(path.join(tmpDir, 'app.log'), '')
    fs.writeFileSync(
      path.join(tmpDir, 'app-2026-05-12.log.gz'),
      zlib.gzipSync(Buffer.from('{"ts":"2026-05-12T00:00:00.000Z","msg":"x"}\n')),
    )
    fs.writeFileSync(path.join(tmpDir, 'app-2026-05-11.log'), 'plain')

    const { rotated } = await listAvailableLogs()
    const gz = rotated.find((r) => r.date === '2026-05-12')
    const plain = rotated.find((r) => r.date === '2026-05-11')
    expect(gz).toBeDefined()
    expect(gz.compressed).toBe(true)
    expect(gz.sizeBytes).toBeGreaterThan(0)
    expect(plain.compressed).toBe(false)
  })
})
