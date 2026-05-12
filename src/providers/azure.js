import { OpenAIProvider } from './openai.js'

// Azure OpenAI Service is OpenAI's wire format with two quirks: auth is via the
// `api-key: <key>` header (SDK already sends this — we just forward), and every
// request needs `?api-version=YYYY-MM-DD`. The proxy auto-appends the latter
// when missing — see the `proxyReq` listener in src/proxy/proxy.js. Pricing is
// keyed under "azure" so cost reporting is distinct from raw OpenAI.
export class AzureOpenAIProvider extends OpenAIProvider {
  get name() {
    return 'azure'
  }
}
