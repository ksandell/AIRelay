import { OpenAIProvider } from './openai.js'

// Cerebras (https://cerebras.ai) runs inference on dedicated wafer-scale
// hardware. Wire format is OpenAI-compatible; pricing keyed under "cerebras"
// so calls report actual rates rather than a generic OpenAI fallback.
export class CerebrasProvider extends OpenAIProvider {
  get name() {
    return 'cerebras'
  }
}
