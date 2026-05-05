import { OpenAIProvider } from './openai.js'

export class XAIProvider extends OpenAIProvider {
  get name() {
    return 'xai'
  }
}
