import { BaseProvider } from './base.js'
import { lookupModelPrice } from './pricing.js'

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
    const sync = this._parseJson(buffer)
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

  // OpenAI / Mistral / OpenRouter share schema:
  //   request:  messages[].tool_calls[]  +  messages[].role === 'tool'
  //   response: choices[].message.tool_calls[]  (sync) or choices[].delta.tool_calls[] (stream)
  extractToolCalls(reqBuffer, respBuffer) {
    let toolCalls = 0
    let toolBytesIn = 0
    let toolBytesOut = 0

    const req = reqBuffer ? this._parseJson(reqBuffer) : null
    if (req?.messages && Array.isArray(req.messages)) {
      for (const m of req.messages) {
        if (m.role === 'tool') {
          toolCalls++
          toolBytesIn += Buffer.byteLength(JSON.stringify(m), 'utf8')
        }
        if (Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            toolCalls++
            toolBytesIn += Buffer.byteLength(JSON.stringify(tc), 'utf8')
          }
        }
      }
    }

    const resp = respBuffer ? this._parseJson(respBuffer) : null
    if (resp?.choices && Array.isArray(resp.choices)) {
      for (const c of resp.choices) {
        const tcs = c.message?.tool_calls
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            toolCalls++
            toolBytesOut += Buffer.byteLength(JSON.stringify(tc), 'utf8')
          }
        }
      }
    } else if (respBuffer) {
      // streaming SSE — scan for delta.tool_calls
      const text = respBuffer.toString('utf8')
      const seen = new Set()
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const chunk = JSON.parse(payload)
          for (const c of chunk.choices ?? []) {
            const tcs = c.delta?.tool_calls
            if (Array.isArray(tcs)) {
              for (const tc of tcs) {
                if (tc.id && !seen.has(tc.id)) {
                  seen.add(tc.id)
                  toolCalls++
                }
                toolBytesOut += Buffer.byteLength(JSON.stringify(tc), 'utf8')
              }
            }
          }
        } catch {
          /* skip */
        }
      }
    }

    if (toolCalls === 0 && toolBytesIn === 0 && toolBytesOut === 0) return null
    return { toolCalls, toolBytesIn, toolBytesOut }
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
