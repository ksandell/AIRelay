import { OpenAIProvider } from './openai.js'

export class MistralProvider extends OpenAIProvider {
  get name() {
    return 'mistral'
  }
}
