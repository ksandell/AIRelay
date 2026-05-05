import { BaseProvider } from './base.js'

export class GenericProvider extends BaseProvider {
  get name() {
    return 'generic'
  }
  extractTokens(_buffer) {
    return null
  }
  calculateCost(_tokens) {
    return null
  }
}
