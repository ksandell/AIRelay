import { OpenAIProvider } from './openai.js'

export class FireworksProvider extends OpenAIProvider {
  get name() {
    return 'fireworks'
  }
}
