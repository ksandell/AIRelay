import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileSink, createStdoutSink, createNoopSink, createSink } from '../../src/logs/sinks.js'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinks-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('createFileSink', () => {
  it('writes a line to the specified file path', async () => {
    const sink = createFileSink(tmpDir)
    const filePath = path.join(tmpDir, 'app.log')
    sink.write('hello\n', filePath)
    sink.close()

    // Give the write stream time to flush
    await new Promise((resolve) => setTimeout(resolve, 50))
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toBe('hello\n')
  })

  it('creates logDir if it does not exist', async () => {
    const nested = path.join(tmpDir, 'sub', 'dir')
    const sink = createFileSink(nested)
    const filePath = path.join(nested, 'app.log')
    sink.write('line\n', filePath)
    sink.close()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('redirect() switches to a new path', async () => {
    const sink = createFileSink(tmpDir)
    const original = path.join(tmpDir, 'app.log')
    const redirected = path.join(tmpDir, 'app2.log')

    sink.write('before\n', original)
    const old = sink.redirect(redirected)
    sink.write('after\n', redirected)
    if (old) {
      await new Promise((resolve) => setImmediate(resolve))
      try { old.end() } catch { /* ignore */ }
    }
    sink.close()

    await new Promise((resolve) => setTimeout(resolve, 50))
    const afterContent = fs.readFileSync(redirected, 'utf8')
    expect(afterContent).toBe('after\n')
  })

  it('close() is idempotent', () => {
    const sink = createFileSink(tmpDir)
    const filePath = path.join(tmpDir, 'app.log')
    sink.write('x\n', filePath)
    expect(() => {
      sink.close()
      sink.close()
    }).not.toThrow()
  })
})

describe('createStdoutSink', () => {
  it('writes line to process.stdout', () => {
    const sink = createStdoutSink()
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    sink.write('stdout-line\n')
    expect(spy).toHaveBeenCalledWith('stdout-line\n')
    spy.mockRestore()
  })

  it('close() does not throw', () => {
    const sink = createStdoutSink()
    expect(() => sink.close()).not.toThrow()
  })
})

describe('createNoopSink', () => {
  it('write() discards output', () => {
    const sink = createNoopSink()
    const spy = vi.spyOn(process.stdout, 'write')
    sink.write('should-be-discarded\n')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('close() does not throw', () => {
    const sink = createNoopSink()
    expect(() => sink.close()).not.toThrow()
  })

  it('has no redirect method', () => {
    const sink = createNoopSink()
    expect(sink.redirect).toBeUndefined()
  })
})

describe('createSink', () => {
  it('returns file sink for "file"', () => {
    const sink = createSink('file', tmpDir)
    expect(typeof sink.write).toBe('function')
    expect(typeof sink.redirect).toBe('function')
    sink.close()
  })

  it('returns stdout sink for "stdout"', () => {
    const sink = createSink('stdout', tmpDir)
    expect(typeof sink.write).toBe('function')
    expect(sink.redirect).toBeUndefined()
  })

  it('returns noop sink for "noop"', () => {
    const sink = createSink('noop', tmpDir)
    expect(typeof sink.write).toBe('function')
    expect(sink.redirect).toBeUndefined()
  })

  it('defaults to file sink for unknown type', () => {
    const sink = createSink('unknown', tmpDir)
    expect(typeof sink.redirect).toBe('function')
    sink.close()
  })
})
