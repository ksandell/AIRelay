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

  // @param {{ model: string, inputTokens: number|null, outputTokens: number|null,
  //           cacheReadTokens: number|null, cacheWriteTokens: number|null }} tokens
  // @returns {number | null} cost in USD
  calculateCost(_tokens) {
    throw new Error('not implemented')
  }
}
