import { OpenAIProvider } from './openai.js'

export class MicrosoftProvider extends OpenAIProvider {
  get name() {
    return 'microsoft'
  }
}
