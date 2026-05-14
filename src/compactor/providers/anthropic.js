import { config } from '../../config.js'
import { runPipeline } from '../pipeline.js'

/**
 * Walk an Anthropic Messages API request body and apply the compactor to
 * `tool_result` content (always) and to other text blocks (when
 * COMPACTOR_TOOL_RESULT_ONLY=false). Returns the mutated body and aggregated
 * fire stats. Pure function — does not mutate input.
 */
export function compactAnthropic(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
    return { body, fires: [], bytesIn: 0, bytesOut: 0 }
  }
  const toolResultOnly = config.compactorToolResultOnly
  const allowRisky = config.compactorAllowRisky
  const next = { ...body, messages: new Array(body.messages.length) }
  const allFires = []
  let bytesIn = 0
  let bytesOut = 0

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i]
    if (!msg || (msg.role === 'system' && !allowRisky)) {
      next.messages[i] = msg
      continue
    }
    if (typeof msg.content === 'string' && !toolResultOnly && msg.role !== 'system') {
      const r = runPipeline(msg.content)
      bytesIn += r.bytesBefore
      bytesOut += r.bytesAfter
      allFires.push(...r.fires)
      next.messages[i] = { ...msg, content: r.text }
      continue
    }
    if (Array.isArray(msg.content)) {
      const nextContent = new Array(msg.content.length)
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j]
        if (!block || typeof block !== 'object') {
          nextContent[j] = block
          continue
        }
        if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            const r = runPipeline(block.content)
            bytesIn += r.bytesBefore
            bytesOut += r.bytesAfter
            allFires.push(...r.fires)
            nextContent[j] = { ...block, content: r.text }
          } else if (Array.isArray(block.content)) {
            const innerNext = new Array(block.content.length)
            for (let k = 0; k < block.content.length; k++) {
              const inner = block.content[k]
              if (inner && inner.type === 'text' && typeof inner.text === 'string') {
                const r = runPipeline(inner.text)
                bytesIn += r.bytesBefore
                bytesOut += r.bytesAfter
                allFires.push(...r.fires)
                innerNext[k] = { ...inner, text: r.text }
              } else {
                innerNext[k] = inner
              }
            }
            nextContent[j] = { ...block, content: innerNext }
          } else {
            nextContent[j] = block
          }
        } else if (!toolResultOnly && block.type === 'text' && typeof block.text === 'string') {
          const r = runPipeline(block.text)
          bytesIn += r.bytesBefore
          bytesOut += r.bytesAfter
          allFires.push(...r.fires)
          nextContent[j] = { ...block, text: r.text }
        } else {
          nextContent[j] = block
        }
      }
      next.messages[i] = { ...msg, content: nextContent }
    } else {
      next.messages[i] = msg
    }
  }
  return { body: next, fires: allFires, bytesIn, bytesOut }
}
