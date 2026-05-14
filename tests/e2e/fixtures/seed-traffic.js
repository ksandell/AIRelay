/**
 * Helpers to seed deterministic traffic against the running AIRelay before a
 * spec asserts. Uses fetch (Node 22+) — no extra deps.
 *
 *   await seedProxyCalls(baseURL, { count: 3 })
 *   await seedCompactorTraffic(baseURL)
 */

const ESC = String.fromCharCode(27)

export async function seedProxyCalls(baseURL, { count = 3, model = 'mistral-small-latest' } = {}) {
  for (let i = 0; i < count; i++) {
    await fetch(`${baseURL}/proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: `seed ${i}` }],
      }),
    })
  }
}

export async function seedCompactorTraffic(baseURL) {
  // A bloated tool_result that triggers ansi-strip + blankline-collapse + npm-noise-strip.
  const body = {
    model: 'claude-x',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_seed',
            content:
              `${ESC}[31merror${ESC}[0m\n` +
              'a\n\n\n\n\nb\n' +
              'npm WARN deprecated foo@1\n'.repeat(15) +
              'real output\n',
          },
        ],
      },
    ],
  }
  // PROXY_PROVIDER=mistral in test-server, so we send an OpenAI-style body for
  // the Compactor's openai provider parser. Re-use the same content shape:
  const oaBody = {
    model: 'gpt-x',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'tool',
        tool_call_id: 't1',
        content:
          `${ESC}[31merror${ESC}[0m\n` +
          'a\n\n\n\n\nb\n' +
          'npm WARN deprecated foo@1\n'.repeat(15) +
          'real output\n',
      },
    ],
  }
  await fetch(`${baseURL}/proxy/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(oaBody),
  })
  // Suppress anthropic-shaped body since provider=mistral routes to openai parser.
  return body
}

export async function resetMetrics(baseURL) {
  // Clears both the proxy ring buffer and Compactor lifetime counters.
  // Only available when the server runs with NODE_ENV=test (test-server.js sets this).
  await fetch(`${baseURL}/api/test/reset`, { method: 'POST' })
}
