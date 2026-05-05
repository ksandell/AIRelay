import { OpenAIProvider } from './openai.js'

export class GroqProvider extends OpenAIProvider {
  get name() {
    return 'groq'
  }

  extractTokens(buffer) {
    try {
      for (const line of buffer.toString('utf8').split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        const chunk = JSON.parse(payload)
        if (chunk.x_groq?.usage) {
          const u = chunk.x_groq.usage
          return {
            model: chunk.model ?? null,
            inputTokens: u.prompt_tokens ?? null,
            outputTokens: u.completion_tokens ?? null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
          }
        }
      }
    } catch {
      // fall through to OpenAI shape
    }
    return super.extractTokens(buffer)
  }
}
