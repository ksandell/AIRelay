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

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload)
      if (chunk.model) model = chunk.model
      if (chunk.usage?.prompt_tokens !== undefined) {
        inputTokens = chunk.usage.prompt_tokens ?? null
        outputTokens = chunk.usage.completion_tokens ?? null
      }
    } catch {
      /* skip */
    }
  }

  if (inputTokens === null) return null
  return { model, inputTokens, outputTokens }
}

export class OpenAIProvider extends BaseProvider {
  get name() {
    return 'openai'
  }

  extractTokens(buffer) {
    const sync = parseSync(buffer)
    if (sync?.usage?.prompt_tokens !== undefined) {
      return {
        model: sync.model ?? null,
        inputTokens: sync.usage.prompt_tokens ?? null,
        outputTokens: sync.usage.completion_tokens ?? null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        totalTokens:
          sync.usage.total_tokens ??
          (sync.usage.prompt_tokens ?? 0) + (sync.usage.completion_tokens ?? 0),
      }
    }

    const streamed = parseStreaming(buffer)
    if (!streamed) return null
    return {
      ...streamed,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: (streamed.inputTokens ?? 0) + (streamed.outputTokens ?? 0),
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
