import { OpenAIProvider } from './openai.js'

// AnLinkAI (https://anlinkai.com) is an OpenAI-compatible aggregator fronting
// Qwen + DeepSeek. Wire format identical to OpenAI; pricing keyed under
// "anlinkai" so calls report the aggregator's published rates rather than the
// underlying vendor's.
export class AnLinkAIProvider extends OpenAIProvider {
  get name() {
    return 'anlinkai'
  }
}
