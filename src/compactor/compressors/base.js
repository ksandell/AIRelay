/**
 * Compressor contract.
 *
 *   name        unique identifier, kebab-case (matches env var stem)
 *   risky       true => mutates user-authored content; gated behind COMPACTOR_ALLOW_RISKY
 *   appliesTo   cheap predicate (string -> bool). Skip work when false.
 *   transform   pure function (string -> string). Must:
 *                 - never produce a longer output than the input
 *                 - be idempotent: transform(transform(x)) === transform(x)
 *                 - preserve declared "safe substrings" (per-compressor)
 *
 * Compressors are sync and do no I/O. They run on the request (and optionally
 * response) hot path only when the master switch is enabled and the request
 * has been opted in.
 */

export function makeResult(textIn, textOut) {
  const bytesBefore = Buffer.byteLength(textIn, 'utf8')
  const bytesAfter = Buffer.byteLength(textOut, 'utf8')
  return {
    text: textOut,
    bytesBefore,
    bytesAfter,
    fired: textOut !== textIn,
  }
}
