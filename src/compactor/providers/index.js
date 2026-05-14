import { compactAnthropic } from './anthropic.js'
import { compactOpenai } from './openai.js'
import { compactPassthrough } from './passthrough.js'

const ANTHROPIC = new Set(['anthropic', 'claude'])
const OPENAI = new Set([
  'openai',
  'azure',
  'azure-openai',
  'mistral',
  'groq',
  'cerebras',
  'deepseek',
  'xai',
  'fireworks',
  'together',
  'openrouter',
])

export function selectCompactor(providerName) {
  const lower = String(providerName ?? '').toLowerCase()
  if (ANTHROPIC.has(lower)) return { kind: 'anthropic', compact: compactAnthropic }
  if (OPENAI.has(lower)) return { kind: 'openai', compact: compactOpenai }
  return { kind: 'passthrough', compact: compactPassthrough }
}
