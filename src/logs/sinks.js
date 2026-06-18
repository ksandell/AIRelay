import fs from 'node:fs'
import path from 'node:path'

/**
 * Each sink: { write(line: string): void, close(): void, redirect?(newPath: string): void }
 */

export function createFileSink(logDir) {
  let _stream = null
  let _streamPath = null

  function openStream(filePath) {
    const s = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })
    s.on('error', (err) => {
      process.stderr.write(`[logger] stream error: ${err.message}\n`)
    })
    return s
  }

  function ensureStream(filePath) {
    if (!_stream || _streamPath !== filePath) {
      if (_stream) {
        try {
          _stream.end()
        } catch {
          /* ignore */
        }
      }
      fs.mkdirSync(logDir, { recursive: true })
      _stream = openStream(filePath)
      _streamPath = filePath
    }
    return _stream
  }

  return {
    write(line, filePath) {
      try {
        const s = ensureStream(filePath)
        s.cork()
        s.write(line)
        process.nextTick(() => s.uncork())
      } catch (err) {
        process.stderr.write(`[logger] write failed: ${err.message}\n`)
      }
    },

    redirect(newPath) {
      const old = _stream
      fs.mkdirSync(path.dirname(newPath), { recursive: true })
      _stream = openStream(newPath)
      _streamPath = newPath
      return old
    },

    close() {
      if (_stream) {
        try {
          _stream.uncork()
          _stream.end()
        } catch {
          /* ignore */
        }
        _stream = null
        _streamPath = null
      }
    },

    // Async close — awaits the stream's 'close' event so the underlying fd
    // is fully released. Required on Windows before renaming the active log
    // file (open write handle blocks rename).
    async closeAsync() {
      if (!_stream) return
      const s = _stream
      _stream = null
      _streamPath = null
      await new Promise((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          resolve()
        }
        s.once('close', finish)
        s.once('error', finish)
        try {
          s.end(finish)
        } catch {
          finish()
        }
      })
    },
  }
}

export function createStdoutSink() {
  return {
    write(line) {
      process.stdout.write(line)
    },
    close() {
      // stdout is not closeable
    },
  }
}

export function createNoopSink() {
  return {
    write() {},
    close() {},
  }
}

export function createSink(type, logDir) {
  switch (type) {
    case 'stdout':
      return createStdoutSink()
    case 'noop':
      return createNoopSink()
    case 'file':
    default:
      return createFileSink(logDir)
  }
}
