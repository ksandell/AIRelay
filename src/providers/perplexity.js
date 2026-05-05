import { OpenAIProvider } from './openai.js'

export class PerplexityProvider extends OpenAIProvider {
  get name() {
    return 'perplexity'
  }
}
