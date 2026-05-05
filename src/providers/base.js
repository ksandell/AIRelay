export class BaseProvider {
  constructor(pricing) {
    this._pricing = pricing
  }

  get name() {
    throw new Error('not implemented')
  }

  // @param {Buffer} buffer — full response body (may be SSE stream)
  // @returns {{ model: string|null, inputTokens: number|null, outputTokens: number|null,
  //             cacheReadTokens: number|null, cacheWriteTokens: number|null,
  //             totalTokens: number|null } | null}
  extractTokens(_buffer) {
    throw new Error('not implemented')
  }

  // @param {Buffer|null} reqBuffer — full request body (JSON or null)
  // @param {Buffer|null} respBuffer — full response body (JSON or SSE)
  // @returns {{ toolCalls: number, toolBytesIn: number, toolBytesOut: number } | null}
  // Default no-op; providers override.
  extractToolCalls(_reqBuffer, _respBuffer) {
    return null
  }

  // @param {{ model: string, inputTokens: number|null, outputTokens: number|null,
  //           cacheReadTokens: number|null, cacheWriteTokens: number|null }} tokens
  // @returns {number | null} cost in USD
  calculateCost(_tokens) {
    throw new Error('not implemented')
  }
}
