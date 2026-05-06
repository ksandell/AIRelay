import { OpenAIProvider } from './openai.js'

export class CerebrasProvider extends OpenAIProvider {
  get name() {
    return 'cerebras'
  }
}
