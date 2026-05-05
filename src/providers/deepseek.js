import { OpenAIProvider } from './openai.js'

export class DeepSeekProvider extends OpenAIProvider {
  get name() {
    return 'deepseek'
  }
}
