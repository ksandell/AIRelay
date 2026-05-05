import { OpenAIProvider } from './openai.js'
import { lookupModelPrice } from './pricing.js'

export class OllamaProvider extends OpenAIProvider {
  get name() {
    return 'ollama'
  }

  calculateCost(tokens) {
    if (!tokens?.model) return null
    const price = lookupModelPrice(this._pricing, tokens.model)
    if (!price) return null
    return 0
  }
}
