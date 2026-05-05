import { OpenAIProvider } from './openai.js'

export class OpenRouterProvider extends OpenAIProvider {
  get name() {
    return 'openrouter'
  }
}
