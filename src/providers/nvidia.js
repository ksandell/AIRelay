import { OpenAIProvider } from './openai.js'

export class NvidiaProvider extends OpenAIProvider {
  get name() {
    return 'nvidia'
  }
}
