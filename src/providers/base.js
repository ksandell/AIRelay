import { config } from '../config.js'

export class BaseProvider {
  constructor(pricing, providerName = null) {
    this._pricing = pricing
    this._providerName = providerName
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

  // Safe JSON parse — returns null if buffer too large or invalid JSON
  _parseJson(buffer) {
    if (!buffer) return null
    const maxBytes = config.maxBodyParseMb * 1024 * 1024
    if (buffer.length > maxBytes) return null
    try {
      return JSON.parse(buffer.toString('utf8'))
    } catch {
      return null
    }
  }
}
