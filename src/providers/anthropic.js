import { BaseProvider } from './base.js'
import { lookupModelPrice } from './pricing.js'

function parseSync(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    return null
  }
}

function parseStreaming(buffer) {
  const text = buffer.toString('utf8')
  let model = null,
    inputTokens = null,
    outputTokens = null
  let cacheReadTokens = null,
    cacheWriteTokens = null

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const event = JSON.parse(line.slice(6))
      if (event.type === 'message_start' && event.message) {
        model = event.message.model ?? null
        const u = event.message.usage ?? {}
        inputTokens = u.input_tokens ?? null
        cacheReadTokens = u.cache_read_input_tokens ?? null
        cacheWriteTokens = u.cache_creation_input_tokens ?? null
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens ?? null
      }
    } catch {
      /* skip malformed lines */
    }
  }

  if (model === null && inputTokens === null) return null
  return { model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}

export class AnthropicProvider extends BaseProvider {
  get name() {
    return 'anthropic'
  }

  extractTokens(buffer) {
    const sync = parseSync(buffer)
    if (sync?.usage) {
      return {
        model: sync.model ?? null,
        inputTokens: sync.usage.input_tokens ?? null,
        outputTokens: sync.usage.output_tokens ?? null,
        cacheReadTokens: sync.usage.cache_read_input_tokens ?? null,
        cacheWriteTokens: sync.usage.cache_creation_input_tokens ?? null,
        totalTokens: (sync.usage.input_tokens ?? 0) + (sync.usage.output_tokens ?? 0),
      }
    }

    const streamed = parseStreaming(buffer)
    if (!streamed) return null
    return { ...streamed, totalTokens: (streamed.inputTokens ?? 0) + (streamed.outputTokens ?? 0) }
  }

  calculateCost(tokens) {
    if (!tokens?.model) return null
    const price = lookupModelPrice(this._pricing, tokens.model)
    if (!price) return null
    const input = ((tokens.inputTokens ?? 0) * price.input) / 1_000_000
    const output = ((tokens.outputTokens ?? 0) * price.output) / 1_000_000
    const cacheRead = ((tokens.cacheReadTokens ?? 0) * (price.cacheRead ?? 0)) / 1_000_000
    const cacheWrite = ((tokens.cacheWriteTokens ?? 0) * (price.cacheWrite ?? 0)) / 1_000_000
    return input + output + cacheRead + cacheWrite
  }
}
