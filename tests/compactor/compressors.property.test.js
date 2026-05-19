import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { ansiStrip } from '../../src/compactor/compressors/ansi-strip.js'
import { blanklineCollapse } from '../../src/compactor/compressors/blankline-collapse.js'
import { diffCollapse } from '../../src/compactor/compressors/diff-collapse.js'
import { lockfileDrop } from '../../src/compactor/compressors/lockfile-drop.js'
import { lsLongShrink } from '../../src/compactor/compressors/ls-long-shrink.js'
import { npmNoiseStrip } from '../../src/compactor/compressors/npm-noise-strip.js'
import { repeatLineDedupe } from '../../src/compactor/compressors/repeat-line-dedupe.js'
import { stacktraceDedupe } from '../../src/compactor/compressors/stacktrace-dedupe.js'
import { longFileElide } from '../../src/compactor/compressors/long-file-elide.js'
import { base64Truncate } from '../../src/compactor/compressors/base64-truncate.js'

const ALL = [
  ansiStrip,
  blanklineCollapse,
  diffCollapse,
  lockfileDrop,
  lsLongShrink,
  npmNoiseStrip,
  repeatLineDedupe,
  stacktraceDedupe,
  longFileElide,
  base64Truncate,
]

// Arbitrary that biases toward text shapes compressors care about: lines with
// diff markers, npm warnings, ANSI escapes, repeated lines, lockfile names.
const interestingString = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc
    .array(
      fc.constantFrom(
        '',
        '\n',
        '\n\n',
        '\n\n\n',
        '@@ -1,3 +1,3 @@',
        ' context line',
        '+added',
        '-removed',
        'npm WARN deprecated foo@1.0.0',
        'npm notice created a lockfile',
        'found 3 vulnerabilities',
        'diff --git a/package-lock.json b/package-lock.json',
        '--- a/package-lock.json',
        '+++ b/package-lock.json',
        '\x1b[31mred\x1b[0m',
        '-rw-r--r--  1 u g 12 May 10 12:34 file.txt',
        'total 4',
        '    at foo (file.js:1:1)',
        'same line',
        'AAAABBBBCCCC' + 'X'.repeat(300),
      ),
      { maxLength: 30 },
    )
    .map((parts) => parts.join('\n')),
)

describe('compressor invariants (property-based)', () => {
  for (const c of ALL) {
    describe(c.name, () => {
      it('never grows the input', () => {
        fc.assert(
          fc.property(interestingString, (s) => {
            if (!c.appliesTo(s)) return true
            const r = c.transform(s)
            return r.text.length <= s.length
          }),
          { numRuns: 100 },
        )
      })

      it('is idempotent', () => {
        fc.assert(
          fc.property(interestingString, (s) => {
            if (!c.appliesTo(s)) return true
            const r1 = c.transform(s)
            if (!c.appliesTo(r1.text)) return true
            const r2 = c.transform(r1.text)
            return r2.text === r1.text
          }),
          { numRuns: 100 },
        )
      })

      it('returns a valid result shape', () => {
        fc.assert(
          fc.property(interestingString, (s) => {
            const r = c.transform(s)
            return (
              typeof r.text === 'string' &&
              typeof r.bytesBefore === 'number' &&
              typeof r.bytesAfter === 'number' &&
              typeof r.fired === 'boolean'
            )
          }),
          { numRuns: 50 },
        )
      })
    })
  }
})

describe('compressor fixtures (empirical shrinkage)', () => {
  it('ansi-strip removes color codes', () => {
    const ESC = String.fromCharCode(27)
    const input = `${ESC}[31merror${ESC}[0m: ${ESC}[1mbold${ESC}[0m text`
    const r = ansiStrip.transform(input)
    expect(r.text).toBe('error: bold text')
    expect(r.fired).toBe(true)
  })

  it('blankline-collapse reduces 5 newlines to 2', () => {
    const r = blanklineCollapse.transform('a\n\n\n\n\nb')
    expect(r.text).toBe('a\n\nb')
  })

  it('diff-collapse keeps @@ headers and change lines', () => {
    const hunk = ['@@ -1,20 +1,20 @@']
    for (let i = 0; i < 15; i++) hunk.push(' unchanged line')
    hunk.push('-removed')
    hunk.push('+added')
    for (let i = 0; i < 15; i++) hunk.push(' more unchanged')
    const input = hunk.join('\n')
    const r = diffCollapse.transform(input)
    expect(r.text).toContain('@@ -1,20 +1,20 @@')
    expect(r.text).toContain('-removed')
    expect(r.text).toContain('+added')
    expect(r.text).toMatch(/\.{3} \d+ lines unchanged \.{3}/)
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore)
  })

  it('lockfile-drop elides package-lock.json diff body', () => {
    const lines = [
      'diff --git a/package-lock.json b/package-lock.json',
      'index abc..def 100644',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
    ]
    for (let i = 0; i < 50; i++) lines.push(`+    "version": "1.0.${i}"`)
    const r = lockfileDrop.transform(lines.join('\n'))
    expect(r.text).toContain('lockfile diff omitted')
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore)
  })

  it('ls-long-shrink keeps only filename column', () => {
    const input = [
      'total 24',
      '-rw-r--r--  1 alice group  1234 May 10 12:34 alpha.txt',
      '-rw-r--r--  1 alice group  5678 May 10 12:35 beta.txt',
      '-rwxr-xr-x  1 alice group  9999 May 10 12:36 gamma.sh',
    ].join('\n')
    const r = lsLongShrink.transform(input)
    expect(r.text).toBe('alpha.txt\nbeta.txt\ngamma.sh')
  })

  it('npm-noise-strip removes WARN deprecated but keeps ERR!', () => {
    const input = [
      'npm WARN deprecated old@1.0.0: use new@2',
      'npm notice created a lockfile',
      'found 2 vulnerabilities',
      'npm ERR! something exploded',
    ].join('\n')
    const r = npmNoiseStrip.transform(input)
    expect(r.text).toContain('npm ERR! something exploded')
    expect(r.text).not.toContain('npm WARN')
    expect(r.text).not.toContain('npm notice')
    expect(r.text).not.toContain('found 2 vulnerabilities')
  })

  it('repeat-line-dedupe collapses runs', () => {
    const longLine = 'connection reset by peer at 192.168.1.42 retrying...'
    const lines = [longLine, longLine, longLine, longLine, longLine, longLine, longLine, 'OK']
    const r = repeatLineDedupe.transform(lines.join('\n'))
    expect(r.text).toContain('<line repeated 6 more times>')
    expect(r.text).toContain('OK')
  })

  it('stacktrace-dedupe collapses 5 identical frames', () => {
    const frame = '    at recurse (file.js:1:1)'
    const input = [frame, frame, frame, frame, frame, 'caused by error'].join('\n')
    const r = stacktraceDedupe.transform(input)
    expect(r.text).toContain('frame repeated')
  })

  it('long-file-elide keeps head/tail and elides middle', () => {
    const lines = []
    for (let i = 0; i < 500; i++) lines.push(`line ${i}`)
    const r = longFileElide.transform(lines.join('\n'))
    expect(r.text).toContain('line 0')
    expect(r.text).toContain('line 499')
    expect(r.text).toMatch(/<\d+ lines elided>/)
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore)
  })

  it('base64-truncate summarizes long blobs', () => {
    const b64 = 'A'.repeat(400)
    const r = base64Truncate.transform(`prefix ${b64} suffix`)
    expect(r.text).toMatch(/<base64: \d+ bytes, sha256:[a-f0-9]+>/)
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore)
  })
})

describe('safe-substring preservation', () => {
  it('diff-collapse never drops + or - lines', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ctx', '+add', '-rem', '@@ -1,1 +1,1 @@'), {
          minLength: 5,
          maxLength: 50,
        }),
        (lines) => {
          const input = lines.join('\n')
          if (!diffCollapse.appliesTo(input)) return true
          const out = diffCollapse.transform(input).text
          const addRemBefore = lines.filter((l) => l.startsWith('+') || l.startsWith('-')).length
          const addRemAfter = out
            .split('\n')
            .filter((l) => l.startsWith('+') || l.startsWith('-')).length
          return addRemAfter >= addRemBefore
        },
      ),
      { numRuns: 50 },
    )
  })

  it('npm-noise-strip never strips npm ERR! lines', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            'npm WARN deprecated foo',
            'npm ERR! code ELIFECYCLE',
            'npm ERR! Error: command failed',
            'npm notice created a lockfile',
          ),
          { minLength: 1, maxLength: 30 },
        ),
        (lines) => {
          const input = lines.join('\n')
          const out = npmNoiseStrip.transform(input).text
          for (const l of lines) {
            if (l.startsWith('npm ERR!') && !out.includes(l)) return false
          }
          return true
        },
      ),
      { numRuns: 50 },
    )
  })
})
