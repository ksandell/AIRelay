import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'
import { GoogleProvider } from './google.js'
import { MistralProvider } from './mistral.js'
import { GroqProvider } from './groq.js'
import { MicrosoftProvider } from './microsoft.js'
import { OpenRouterProvider } from './openrouter.js'
import { TogetherProvider } from './together.js'
import { FireworksProvider } from './fireworks.js'
import { DeepSeekProvider } from './deepseek.js'
import { XAIProvider } from './xai.js'
import { PerplexityProvider } from './perplexity.js'
import { OllamaProvider } from './ollama.js'
import { NvidiaProvider } from './nvidia.js'
import { AnLinkAIProvider } from './anlinkai.js'
import { CerebrasProvider } from './cerebras.js'
import { GenericProvider } from './generic.js'
import { loadPricing } from './pricing.js'

const PROVIDER_CLASSES = {
  anthropic: AnthropicProvider,
  openai: OpenAIProvider,
  google: GoogleProvider,
  mistral: MistralProvider,
  groq: GroqProvider,
  microsoft: MicrosoftProvider,
  openrouter: OpenRouterProvider,
  together: TogetherProvider,
  fireworks: FireworksProvider,
  deepseek: DeepSeekProvider,
  xai: XAIProvider,
  perplexity: PerplexityProvider,
  ollama: OllamaProvider,
  nvidia: NvidiaProvider,
  anlinkai: AnLinkAIProvider,
  cerebras: CerebrasProvider,
  generic: GenericProvider,
}

const _instances = new Map()

export function loadProvider(name, pricingOverridePath = null) {
  const key = `${name}:${pricingOverridePath ?? ''}`
  if (_instances.has(key)) return _instances.get(key)
  const Cls = PROVIDER_CLASSES[name] ?? GenericProvider
  const instance = new Cls(loadPricing(name, pricingOverridePath), name)
  _instances.set(key, instance)
  return instance
}
