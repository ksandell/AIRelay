import { config } from '../../config.js'
import { runPipeline } from '../pipeline.js'

/**
 * Walk an OpenAI Chat Completions / Responses API request body and apply
 * the compactor. Targets `role: "tool"` messages always, and other text
 * content when COMPACTOR_TOOL_RESULT_ONLY=false.
 */
export function compactOpenai(body) {
  if (!body || typeof body !== 'object') {
    return { body, fires: [], bytesIn: 0, bytesOut: 0 }
  }
  const messages = body.messages ?? body.input
  if (!Array.isArray(messages)) {
    return { body, fires: [], bytesIn: 0, bytesOut: 0 }
  }
  const toolResultOnly = config.compactorToolResultOnly
  const allowRisky = config.compactorAllowRisky
  const nextMessages = new Array(messages.length)
  const allFires = []
  let bytesIn = 0
  let bytesOut = 0

  const process = (text) => {
    const r = runPipeline(text)
    bytesIn += r.bytesBefore
    bytesOut += r.bytesAfter
    allFires.push(...r.fires)
    return r.text
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || (msg.role === 'system' && !allowRisky)) {
      nextMessages[i] = msg
      continue
    }
    const isTool = msg.role === 'tool' || msg.role === 'function'
    const eligible = isTool || !toolResultOnly
    if (!eligible) {
      nextMessages[i] = msg
      continue
    }
    if (typeof msg.content === 'string') {
      nextMessages[i] = { ...msg, content: process(msg.content) }
    } else if (Array.isArray(msg.content)) {
      const nextContent = msg.content.map((part) => {
        if (
          part &&
          (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') &&
          typeof part.text === 'string'
        ) {
          return { ...part, text: process(part.text) }
        }
        return part
      })
      nextMessages[i] = { ...msg, content: nextContent }
    } else {
      nextMessages[i] = msg
    }
  }
  const next = body.messages
    ? { ...body, messages: nextMessages }
    : { ...body, input: nextMessages }
  return { body: next, fires: allFires, bytesIn, bytesOut }
}
