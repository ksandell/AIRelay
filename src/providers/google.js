import { BaseProvider } from './base.js'
import { lookupModelPrice } from './pricing.js'

export class GoogleProvider extends BaseProvider {
  get name() {
    return 'google'
  }

  extractTokens(buffer) {
    const parsed = this._parseJson(buffer)
    if (!parsed) return null

    const usage = parsed.usageMetadata
    if (!usage) return null

    return {
      model: parsed.modelVersion ?? null,
      inputTokens: usage.promptTokenCount ?? null,
      outputTokens: usage.candidatesTokenCount ?? null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens:
        usage.totalTokenCount ?? (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
    }
  }

  // Google Gemini schema:
  //   request:  contents[].parts[] where part.functionResponse exists
  //   response: candidates[].content.parts[] where part.functionCall exists
  extractToolCalls(reqBuffer, respBuffer) {
    let toolCalls = 0
    let toolBytesIn = 0
    let toolBytesOut = 0
    const req = reqBuffer ? this._parseJson(reqBuffer) : null
    if (req?.contents && Array.isArray(req.contents)) {
      for (const c of req.contents) {
        if (!Array.isArray(c.parts)) continue
        for (const p of c.parts) {
          if (p?.functionResponse) {
            toolCalls++
            toolBytesIn += Buffer.byteLength(JSON.stringify(p.functionResponse), 'utf8')
          }
        }
      }
    }

    const resp = respBuffer ? this._parseJson(respBuffer) : null
    if (resp?.candidates && Array.isArray(resp.candidates)) {
      for (const cand of resp.candidates) {
        const parts = cand.content?.parts
        if (!Array.isArray(parts)) continue
        for (const p of parts) {
          if (p?.functionCall) {
            toolCalls++
            toolBytesOut += Buffer.byteLength(JSON.stringify(p.functionCall), 'utf8')
          }
        }
      }
    }

    if (toolCalls === 0 && toolBytesIn === 0 && toolBytesOut === 0) return null
    return { toolCalls, toolBytesIn, toolBytesOut }
  }

  calculateCost(tokens) {
    if (!tokens?.model) return null
    const price = lookupModelPrice(this._pricing, tokens.model, this._providerName)
    if (!price) return null
    return (
      ((tokens.inputTokens ?? 0) * price.input + (tokens.outputTokens ?? 0) * price.output) /
      1_000_000
    )
  }
}
