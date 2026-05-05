import { OpenAIProvider } from './openai.js'

export class TogetherProvider extends OpenAIProvider {
  get name() {
    return 'together'
  }
}
