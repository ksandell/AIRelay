import { BaseProvider } from './base.js'
import { lookupModelPrice } from './pricing.js'

export class GoogleProvider extends BaseProvider {
  get name() {
    return 'google'
  }

  extractTokens(buffer) {
    let parsed
    try {
      parsed = JSON.parse(buffer.toString('utf8'))
    } catch {
      return null
    }

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

  calculateCost(tokens) {
    if (!tokens?.model) return null
    const price = lookupModelPrice(this._pricing, tokens.model)
    if (!price) return null
    return (
      ((tokens.inputTokens ?? 0) * price.input + (tokens.outputTokens ?? 0) * price.output) /
      1_000_000
    )
  }
}
