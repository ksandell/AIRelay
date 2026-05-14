// ─── E2E test mode ───────────────────────────────────────────
// When the URL carries ?testMode=1 we disable Chart.js animations and any
// CSS transitions/keyframes so Playwright visual snapshots are deterministic.
// No-op for normal users.
const TEST_MODE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('testMode') === '1'
if (TEST_MODE) {
  document.documentElement.setAttribute('data-test-mode', '1')
  if (typeof window.Chart !== 'undefined') {
    window.Chart.defaults.animation = false
    window.Chart.defaults.animations = { colors: false, numbers: false }
    window.Chart.defaults.transitions = { active: { animation: { duration: 0 } } }
  }
}

// ─── Tab routing ─────────────────────────────────────────────
const tabs = document.querySelectorAll('.tab')
const setupTab = document.getElementById('setupTab')
const setupPanel = document.getElementById('setupPanel')
const setupControls = document.getElementById('setupControls')
const logsPanel = document.getElementById('logsPanel')
const metricsPanel = document.getElementById('metricsPanel')
const logsControls = document.getElementById('logsControls')
const metricsControls = document.getElementById('metricsControls')
const compactorPanel = document.getElementById('compactorPanel')
const compactorControls = document.getElementById('compactorControls')

function activateTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name))
  setupPanel.classList.toggle('hidden', name !== 'setup')
  logsPanel.classList.toggle('hidden', name !== 'logs')
  metricsPanel.classList.toggle('hidden', name !== 'metrics')
  if (compactorPanel) compactorPanel.classList.toggle('hidden', name !== 'compactor')
  setupControls.classList.toggle('hidden', name !== 'setup')
  logsControls.classList.toggle('hidden', name !== 'logs')
  metricsControls.classList.toggle('hidden', name !== 'metrics')
  if (compactorControls) compactorControls.classList.toggle('hidden', name !== 'compactor')
  location.hash = name
  if (name === 'compactor') refreshCompactor()
}
tabs.forEach((t) => t.addEventListener('click', () => activateTab(t.dataset.tab)))

// ─── Compactor panel ─────────────────────────────────────────
// Uses the shared `fmtBytes` defined later in the file (hoisted).

async function refreshCompactor() {
  const statusEl = document.getElementById('compactorStatus')
  const enabledPill = document.getElementById('compactorEnabledPill')
  try {
    const [summaryRes, recentRes] = await Promise.all([
      fetch('/api/compactor/summary'),
      fetch('/api/compactor/recent?limit=50'),
    ])
    if (!summaryRes.ok || !recentRes.ok) throw new Error('fetch failed')
    const s = await summaryRes.json()
    const recent = await recentRes.json()
    if (statusEl) {
      statusEl.textContent = 'Live'
      statusEl.className = 'status connected'
    }
    if (enabledPill) {
      enabledPill.textContent = s.enabled ? 'enabled' : 'disabled'
      enabledPill.className = s.enabled ? 'pill ok' : 'pill warn'
    }
    document.getElementById('compactorBytes1m').textContent = fmtBytes(s.windows['1m'].bytesSaved)
    document.getElementById('compactorBytes5m').textContent = fmtBytes(s.windows['5m'].bytesSaved)
    document.getElementById('compactorBytesLifetime').textContent = fmtBytes(s.lifetime.bytesSaved)
    document.getElementById('compactorTokensLifetime').textContent = Math.floor(
      s.lifetime.bytesSaved / 4,
    ).toLocaleString()
    const r = s.windows['5m'].ratio
    document.getElementById('compactorRatio5m').textContent =
      r == null ? '—' : `${Math.round((1 - r) * 100)}%`
    document.getElementById('compactorBypasses').textContent = s.lifetime.requestsBypassed

    const tbody = document.querySelector('#compactorTable tbody')
    tbody.innerHTML = ''
    const activeSet = new Set(s.compressors.active)
    for (const name of s.compressors.all) {
      const agg = s.lifetime.byCompressor[name]
      const tr = document.createElement('tr')
      const fires = agg?.fires ?? 0
      const saved = agg?.bytesSaved ?? 0
      const avgMicros = fires > 0 ? Math.round(agg.durationMicros / fires) : 0
      tr.innerHTML = `<td><code>${name}</code></td>
        <td>${activeSet.has(name) ? '✓' : '—'}</td>
        <td>${fires}</td>
        <td>${fmtBytes(saved)}</td>
        <td>${avgMicros}</td>`
      tbody.appendChild(tr)
    }

    const rbody = document.querySelector('#compactorRecentTable tbody')
    rbody.innerHTML = ''
    for (const ev of recent) {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${new Date(ev.ts).toLocaleTimeString()}</td>
        <td>${ev.scope}</td>
        <td>${ev.filtersFired.join(', ') || '—'}</td>
        <td>${ev.bytesIn} → ${ev.bytesOut}</td>
        <td>${fmtBytes(ev.bytesSaved)}</td>
        <td>${ev.durationMicros}</td>
        <td>${ev.bypassReason ?? ''}</td>`
      rbody.appendChild(tr)
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = 'Error'
      statusEl.className = 'status disconnected'
    }
  }
}

const compactorRefreshBtn = document.getElementById('compactorRefreshBtn')
if (compactorRefreshBtn) compactorRefreshBtn.addEventListener('click', refreshCompactor)
setInterval(() => {
  if (compactorPanel && !compactorPanel.classList.contains('hidden')) refreshCompactor()
}, 5000)

// ─── Setup panel ─────────────────────────────────────────────
// `proxyProvider` is the value of PROXY_PROVIDER for pricing/parser dispatch.
// Most aggregators speak the OpenAI wire format but are priced under their own
// key (see CONFIGURATION.md "OpenAI-compatible ≠ PROXY_PROVIDER=openai").
const oaiSdk = (envVar) => (host, prefix) => `// OpenAI-compatible SDK
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.${envVar},
  baseURL: "${host}${prefix}",
});`

const PROVIDERS = {
  // Frontier
  anthropic: {
    label: 'Anthropic (Claude API)',
    upstream: 'https://api.anthropic.com',
    proxyProvider: 'anthropic',
    sdk: (host, prefix) => `// Anthropic SDK
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "${host}${prefix}",
});`,
  },
  openai: {
    label: 'OpenAI',
    upstream: 'https://api.openai.com/v1',
    proxyProvider: 'openai',
    sdk: oaiSdk('OPENAI_API_KEY'),
  },
  azure: {
    label: 'Azure OpenAI Service',
    // Replace <resource> with your Azure OpenAI resource name. AIRelay auto-
    // appends ?api-version=... when missing — control via AZURE_OPENAI_API_VERSION.
    upstream: 'https://<resource>.openai.azure.com',
    proxyProvider: 'azure',
    sdk: (host, prefix) => `// Azure OpenAI — auth via api-key header.
// AIRelay auto-appends ?api-version when the SDK omits it.
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "placeholder",                              // ignored — see defaultHeaders
  baseURL: "${host}${prefix}/openai/deployments/<deployment>",
  defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
  // No defaultQuery — AIRelay auto-appends ?api-version from server config.
});`,
  },
  gemini: {
    label: 'Google Gemini',
    upstream: 'https://generativelanguage.googleapis.com',
    proxyProvider: 'google',
    sdk: (host, prefix) => `// Plain HTTP — Gemini accepts ?key=… or x-goog-api-key
fetch("${host}${prefix}/v1beta/models/gemini-2.0-flash:generateContent?key=" + process.env.GEMINI_API_KEY, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] }),
});`,
  },
  xai: {
    label: 'xAI (Grok)',
    upstream: 'https://api.x.ai/v1',
    proxyProvider: 'xai',
    sdk: oaiSdk('XAI_API_KEY'),
  },

  // Aggregators / multi-model
  openrouter: {
    label: 'OpenRouter',
    upstream: 'https://openrouter.ai/api/v1',
    proxyProvider: 'openrouter',
    sdk: oaiSdk('OPENROUTER_API_KEY'),
  },
  together: {
    label: 'Together AI',
    upstream: 'https://api.together.xyz/v1',
    proxyProvider: 'together',
    sdk: oaiSdk('TOGETHER_API_KEY'),
  },
  fireworks: {
    label: 'Fireworks AI',
    upstream: 'https://api.fireworks.ai/inference/v1',
    proxyProvider: 'fireworks',
    sdk: oaiSdk('FIREWORKS_API_KEY'),
  },
  anlinkai: {
    label: 'AnLinkAI (private beta — Qwen / DeepSeek)',
    upstream: 'https://api.anlinkai.com/api/v1',
    proxyProvider: 'anlinkai',
    sdk: oaiSdk('ANLINKAI_API_KEY'),
  },

  // Fast / inference-focused
  groq: {
    label: 'Groq',
    upstream: 'https://api.groq.com/openai/v1',
    proxyProvider: 'groq',
    sdk: oaiSdk('GROQ_API_KEY'),
  },
  cerebras: {
    label: 'Cerebras',
    upstream: 'https://api.cerebras.ai/v1',
    proxyProvider: 'cerebras',
    sdk: oaiSdk('CEREBRAS_API_KEY'),
  },
  deepseek: {
    label: 'DeepSeek',
    upstream: 'https://api.deepseek.com/v1',
    proxyProvider: 'deepseek',
    sdk: oaiSdk('DEEPSEEK_API_KEY'),
  },
  perplexity: {
    label: 'Perplexity',
    upstream: 'https://api.perplexity.ai',
    proxyProvider: 'perplexity',
    sdk: oaiSdk('PERPLEXITY_API_KEY'),
  },
  mistral: {
    label: 'Mistral',
    upstream: 'https://api.mistral.ai',
    proxyProvider: 'mistral',
    sdk: oaiSdk('MISTRAL_API_KEY'),
  },
  nvidia: {
    label: 'NVIDIA NIM',
    upstream: 'https://integrate.api.nvidia.com/v1',
    proxyProvider: 'nvidia',
    sdk: oaiSdk('NVIDIA_API_KEY'),
  },
  microsoft: {
    label: 'Microsoft (Azure OpenAI-compatible)',
    upstream: 'https://api.openai.com/v1',
    proxyProvider: 'microsoft',
    sdk: oaiSdk('AZURE_OPENAI_API_KEY'),
  },

  // Self-host / fallback
  ollama: {
    label: 'Ollama (self-hosted)',
    upstream: 'http://ollama-host:11434',
    proxyProvider: 'ollama',
    sdk: oaiSdk('OLLAMA_API_KEY'),
  },
  custom: {
    label: 'Custom / self-hosted',
    upstream: '',
    proxyProvider: 'generic',
    sdk: (host, prefix) => `// Point your SDK or HTTP client at:
//   ${host}${prefix}
// Auth headers from your client are forwarded unchanged.`,
  },
}

const setupProviderEl = document.getElementById('setupProvider')
const providerHintEl = document.getElementById('providerHint')
const customUrlField = document.getElementById('customUrlField')
const setupCustomUrlEl = document.getElementById('setupCustomUrl')
const setupPathPrefixEl = document.getElementById('setupPathPrefix')
const setupPortEl = document.getElementById('setupPort')
const setupHostEl = document.getElementById('setupHost')
const setupTlsEl = document.getElementById('setupTls')
const setupEnvBlockEl = document.getElementById('setupEnvBlock')
const setupSdkSnippetEl = document.getElementById('setupSdkSnippet')
const setupCopyBtnEl = document.getElementById('setupCopyBtn')

function currentUpstream() {
  const provider = setupProviderEl.value
  if (provider === 'custom') return setupCustomUrlEl.value.trim()
  return PROVIDERS[provider].upstream
}

function publicHostBase() {
  const host = setupHostEl.value.trim() || 'airelay.local'
  const port = parseInt(setupPortEl.value, 10) || 3000
  const portPart = port === 80 ? '' : `:${port}`
  return `http://${host}${portPart}`
}

function renderSetup() {
  const provider = setupProviderEl.value
  customUrlField.classList.toggle('hidden', provider !== 'custom')
  providerHintEl.textContent = PROVIDERS[provider].upstream || 'enter your upstream URL below'

  const upstream = currentUpstream()
  const prefix = setupPathPrefixEl.value.trim() || '/proxy'
  const port = parseInt(setupPortEl.value, 10) || 3000
  const host = setupHostEl.value.trim()
  const tls = setupTlsEl.checked

  const lines = [
    '# Generated by AIRelay setup',
    `PORT=${port}`,
    'BIND_HOST=0.0.0.0',
    'NODE_ENV=production',
    '',
    `UPSTREAM_URL=${upstream}`,
    `PROXY_PATH_PREFIX=${prefix}`,
    `PROXY_INSECURE_TLS=${tls ? 'false' : 'true'}`,
    `PROXY_PROVIDER=${PROVIDERS[provider].proxyProvider ?? 'generic'}`,
  ]
  if (host) lines.push(`PUBLIC_BASE_URL=${publicHostBase()}`)
  setupEnvBlockEl.textContent = lines.join('\n') + '\n'

  setupSdkSnippetEl.textContent = PROVIDERS[provider].sdk(publicHostBase(), prefix)
}

setupProviderEl.addEventListener('change', renderSetup)
setupCustomUrlEl.addEventListener('input', renderSetup)
setupPathPrefixEl.addEventListener('input', renderSetup)
setupPortEl.addEventListener('input', renderSetup)
setupHostEl.addEventListener('input', renderSetup)
setupTlsEl.addEventListener('change', renderSetup)

setupCopyBtnEl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(setupEnvBlockEl.textContent)
    setupCopyBtnEl.textContent = 'Copied'
    setupCopyBtnEl.classList.add('ok')
    setTimeout(() => {
      setupCopyBtnEl.textContent = 'Copy'
      setupCopyBtnEl.classList.remove('ok')
    }, 1500)
  } catch {
    setupCopyBtnEl.textContent = 'Copy failed — select and Ctrl+C'
  }
})

renderSetup()

// ─── Logs panel ──────────────────────────────────────────────
const logList = document.getElementById('logList')
const statusEl = document.getElementById('status')
const dateSelect = document.getElementById('dateSelect')
const levelFilter = document.getElementById('levelFilter')
const clearBtn = document.getElementById('clearBtn')
const pauseBtn = document.getElementById('pauseBtn')
const entryCount = document.getElementById('entryCount')
const healthInfo = document.getElementById('healthInfo')

let paused = false
let count = 0

// ─── Log panel state ─────────────────────────────────────────
const LOG_BUFFER_MAX = 2000
const logBuffer = [] // { type: 'proxy'|'internal'|'system', entry: object }

const filterProxy = document.getElementById('filterProxy')
const filterInternal = document.getElementById('filterInternal')
const filterSystem = document.getElementById('filterSystem')

function loadFilterState() {
  const saved = localStorage.getItem('logFilters')
  if (!saved) return
  try {
    const s = JSON.parse(saved)
    filterProxy.checked = s.proxy ?? true
    filterInternal.checked = s.internal ?? false
    filterSystem.checked = s.system ?? false
  } catch {}
}

function saveFilterState() {
  localStorage.setItem(
    'logFilters',
    JSON.stringify({
      proxy: filterProxy.checked,
      internal: filterInternal.checked,
      system: filterSystem.checked,
    }),
  )
}

loadFilterState()
;[filterProxy, filterInternal, filterSystem].forEach((cb) => {
  cb.addEventListener('change', () => {
    saveFilterState()
    rebuildLogList()
  })
})

const escHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const ERROR_LABELS = {
  client_abort: 'ABORT',
  upstream_timeout: 'TIMEOUT',
  upstream_refused: 'REFUSED',
  upstream_reset: 'RESET',
  upstream_dns: 'DNS',
  tls: 'TLS',
}

function errorLabel(err) {
  if (!err) return null
  return ERROR_LABELS[err] ?? 'ERR'
}

function typeForAppEntry(entry) {
  const path = entry.meta?.path ?? entry.meta?.url ?? ''
  if (path.startsWith('/api/')) return 'internal'
  return 'system'
}

function renderProxyRow(ev) {
  const el = document.createElement('div')
  el.className = 'log-entry type-proxy'
  const label = errorLabel(ev.error)
  const status = label ?? ev.status ?? '—'
  const statusClass = label ? 'err' : `s${(ev.status / 100) | 0}`
  const rawPath = ev.path ?? '—'
  const path = rawPath.length > 45 ? rawPath.slice(0, 44) + '…' : rawPath
  const tokens =
    ev.inputTokens || ev.outputTokens
      ? ` <span class="log-meta">${fmtTokens(ev.inputTokens)}↓ ${fmtTokens(ev.outputTokens)}↑ tok</span>`
      : ''
  const cost =
    typeof ev.costUsd === 'number' ? ` <span class="log-meta">${fmtCost(ev.costUsd)}</span>` : ''
  const model = ev.model ? ` <span class="log-meta">${escHtml(ev.model)}</span>` : ''
  const titleAttr = ev.error ? ` title="${escHtml(String(ev.error))}"` : ''
  el.innerHTML = `<span class="log-ts">${fmtTime(ev.ts)}</span><span class="log-level ${statusClass}"${titleAttr}>${escHtml(String(status))}</span><span class="log-msg"><span class="log-method">${escHtml(ev.method ?? '—')}</span> ${escHtml(path)} <span class="log-meta">${ev.durationMs ?? '—'}ms</span> <span class="log-meta">↓${fmtBytes(ev.bytesIn ?? 0)} ↑${fmtBytes(ev.bytesOut ?? 0)}</span>${model}${tokens}${cost}</span>`
  return el
}

function renderLogRow(item) {
  if (item.type === 'proxy') return renderProxyRow(item.entry)
  const { entry } = item
  const level = entry.level ?? 'info'
  const el = document.createElement('div')
  el.className = `log-entry type-${item.type} level-${level}`
  const meta = entry.meta
    ? Object.entries(entry.meta)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ')
    : ''
  const ts = entry.ts ? fmtTime(entry.ts) : ''
  el.innerHTML = `
    <span class="log-ts">${ts}</span>
    <span class="log-level ${level}">${level}</span>
    <span class="log-msg">${escHtml(entry.msg ?? '')}${meta ? `<span class="log-meta"> ${escHtml(meta)}</span>` : ''}</span>
  `
  return el
}

function isVisible(type) {
  if (type === 'proxy') return filterProxy.checked
  if (type === 'internal') return filterInternal.checked
  return filterSystem.checked
}

function rebuildLogList() {
  logList.innerHTML = ''
  count = 0
  for (const item of logBuffer) {
    if (!isVisible(item.type)) continue
    logList.appendChild(renderLogRow(item))
    count++
  }
  entryCount.textContent = `${count} entries`
}

function bufferAndRender(type, entry) {
  if (paused) return
  logBuffer.unshift({ type, entry })
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.pop()
  if (!isVisible(type)) return
  const el = renderLogRow({ type, entry })
  logList.prepend(el)
  count++
  entryCount.textContent = `${count} entries`
}

function renderEntry(entry) {
  if (dateSelect.value) return
  const type = typeForAppEntry(entry)
  bufferAndRender(type, entry)
}

async function loadHistory(date) {
  const r = await fetch(`/api/logs/history?date=${date}`)
  if (!r.ok) return
  const entries = await r.json()
  logBuffer.length = 0
  count = 0
  for (const e of [...entries].reverse()) {
    logBuffer.push({ type: typeForAppEntry(e), entry: e })
    if (logBuffer.length >= LOG_BUFFER_MAX) break
  }
  filterProxy.disabled = true
  filterProxy.parentElement.title = 'Live only — proxy requests not stored on disk'
  rebuildLogList()
}

async function loadLive() {
  // Two-source backfill: the file-backed app log captures internal/system
  // events, but proxied requests never touch the file logger (hot-path
  // invariant — see CLAUDE.md). They live in the metrics ring buffer. Merge
  // both sources so the Logs panel shows historical proxy traffic on first
  // render, not just events that arrive over SSE after the page loads.
  const [logsR, recentR] = await Promise.all([
    fetch('/api/logs?limit=500').catch(() => null),
    fetch('/api/metrics/recent?limit=500').catch(() => null),
  ])
  const appEntries = logsR && logsR.ok ? await logsR.json() : []
  const proxyEntries = recentR && recentR.ok ? await recentR.json() : []

  const merged = []
  for (const e of appEntries) merged.push({ type: typeForAppEntry(e), entry: e, ts: e.ts })
  for (const ev of proxyEntries) merged.push({ type: 'proxy', entry: ev, ts: ev.ts })
  // Newest first — matches the live SSE convention (bufferAndRender unshifts).
  merged.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))

  logBuffer.length = 0
  count = 0
  for (const item of merged) {
    logBuffer.push({ type: item.type, entry: item.entry })
    if (logBuffer.length >= LOG_BUFFER_MAX) break
  }
  rebuildLogList()
}

async function loadAvailable() {
  const r = await fetch('/api/logs/available')
  if (!r.ok) return
  const { rotated } = await r.json()
  dateSelect.innerHTML = '<option value="">Live</option>'
  for (const { date, sizeBytes } of rotated) {
    const opt = document.createElement('option')
    opt.value = date
    opt.textContent = `${date} (${(sizeBytes / 1024).toFixed(1)} KB)`
    dateSelect.appendChild(opt)
  }
}

async function loadHealth() {
  try {
    const r = await fetch('/health')
    const h = await r.json()
    const proxy = h.proxy?.enabled
      ? ` | proxy → ${h.proxy.upstream}${h.proxy.upstreamReachable === false ? ' ⚠ unreachable' : ''}`
      : ' | proxy disabled'
    healthInfo.textContent =
      `${h.publicBaseUrl ?? ''} | log: ${(h.activeLogSizeBytes / 1024).toFixed(1)} KB | ` +
      `inflight: ${h.runtime.inFlight} | loop lag: ${h.runtime.eventLoopLagMs}ms${proxy}`

    // Setup tab visibility — show if proxy not configured.
    const proxyEnabled = Boolean(h.proxy?.enabled)
    setupTab.hidden = proxyEnabled
    if (!proxyEnabled && !location.hash) activateTab('setup')
  } catch {}
}

function connectLogsSSE() {
  const es = new EventSource('/api/logs/stream')
  es.onopen = () => {
    statusEl.textContent = 'Live'
    statusEl.className = 'status connected'
  }
  es.onmessage = (e) => {
    if (paused || dateSelect.value) return
    try {
      renderEntry(JSON.parse(e.data))
    } catch {}
  }
  es.onerror = () => {
    statusEl.textContent = 'Reconnecting…'
    statusEl.className = 'status disconnected'
  }
}

dateSelect.addEventListener('change', () => {
  if (dateSelect.value) {
    loadHistory(dateSelect.value)
  } else {
    filterProxy.disabled = false
    filterProxy.parentElement.title = ''
    loadLive()
  }
})
levelFilter.addEventListener('change', () => {
  if (dateSelect.value) loadHistory(dateSelect.value)
  else loadLive()
})
clearBtn.addEventListener('click', () => {
  logBuffer.length = 0
  logList.innerHTML = ''
  count = 0
  entryCount.textContent = '0 entries'
})
pauseBtn.addEventListener('click', () => {
  paused = !paused
  pauseBtn.textContent = paused ? 'Resume' : 'Pause'
  pauseBtn.classList.toggle('active', paused)
})

// ─── Metrics panel ───────────────────────────────────────────
const metricsStatus = document.getElementById('metricsStatus')
const inFlightPill = document.getElementById('inFlightPill')
const kpiRps = document.getElementById('kpiRps')
const kpiP95 = document.getElementById('kpiP95')
const kpiP99 = document.getElementById('kpiP99')
const kpiErr = document.getElementById('kpiErr')
const kpiTotal = document.getElementById('kpiTotal')
const kpiBytesIn = document.getElementById('kpiBytesIn')
const kpiBytesOut = document.getElementById('kpiBytesOut')
const recentTbody = document.querySelector('#recentTable tbody')
const kpiCostTotal = document.getElementById('kpiCostTotal')
const kpiCostPerMin = document.getElementById('kpiCostPerMin')
const kpiCostPerHr = document.getElementById('kpiCostPerHr')
const kpiTokensIn = document.getElementById('kpiTokensIn')
const kpiTokensOut = document.getElementById('kpiTokensOut')
const kpiToolCalls = document.getElementById('kpiToolCalls')
const kpiCostPerDay = document.getElementById('kpiCostPerDay')
const kpiCostPerMonth = document.getElementById('kpiCostPerMonth')
const kpiAvgCost = document.getElementById('kpiAvgCost')
const kpiAvgTokens = document.getElementById('kpiAvgTokens')
const kpiCacheHit = document.getElementById('kpiCacheHit')
const kpiAvgDur = document.getElementById('kpiAvgDur')
const kpiInFlight = document.getElementById('kpiInFlight')
const kpiTopModel = document.getElementById('kpiTopModel')
const modelsTbody = document.querySelector('#modelsTable tbody')
const modelsTotalReq = document.getElementById('modelsTotalReq')
const modelsTotalIn = document.getElementById('modelsTotalIn')
const modelsTotalOut = document.getElementById('modelsTotalOut')
const modelsTotalCost = document.getElementById('modelsTotalCost')
const topCostTbody = document.querySelector('#topCostTable tbody')

let totalCostSinceBoot = 0
let totalCostSeeded = false

const MAX_TICKS = 300 // 5 minutes at 1Hz
const MAX_TABLE_ROWS = 40

const tickLabels = []
const rpsSeries = []
const p95Series = []
const tokenInSeries = []
const tokenToolInSeries = []
const tokenOutSeries = []
const tokenToolOutSeries = []

const SPARK_TICKS = 60
const sparkSeries = {}
const sparkCharts = {}

function pushSpark(key, value) {
  const arr = (sparkSeries[key] ||= [])
  arr.push(value)
  if (arr.length > SPARK_TICKS) arr.shift()
  const ch = sparkCharts[key]
  if (ch) {
    ch.data.labels = arr.map((_, i) => i)
    ch.data.datasets[0].data = arr
    ch.update('none')
  }
}

function makeSparkline(canvasId, color) {
  const el = document.getElementById(canvasId)
  if (!el) return null
  return new Chart(el, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          borderColor: color,
          backgroundColor: color + '33',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
      elements: { line: { borderJoinStyle: 'round' } },
    },
  })
}

function fmtCost(n) {
  if (n == null || isNaN(n)) return '—'
  if (n === 0) return '$0.00'
  if (n >= 0.01) return `$${n.toFixed(2)}`
  return `$${n.toFixed(6)}`
}

function fmtNum(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—'
  const [int, dec] = n.toFixed(decimals).split('.')
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decimals > 0 ? `${intFormatted}.${dec}` : intFormatted
}

// Browser-local timestamp with millisecond precision: `YYYY-MM-DD HH:MM:SS.mmm`.
// The native `Date` getters already return values in the browser's timezone, so
// there's no need to pull in a library for this — manual zero-padding gives us
// a stable, sortable, copy-pasteable format for log lines + recent-request rows.
function fmtTime(ts) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  )
}

function fmtTokens(n) {
  if (n == null || isNaN(n)) return '—'
  return fmtNum(Math.round(n))
}

// Y-axis tick formatter — kill float-precision noise (e.g. 0.6000000000000001).
// Auto-picks precision from magnitude. Sub-0.01 values fall back to 2
// significant figures so tiny token-rate ranges stay readable instead of
// collapsing to "0.00".
function fmtAxis(v) {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 100) return Math.round(a).toString()
  if (a >= 10) return a.toFixed(0)
  if (a >= 1) return a.toFixed(1)
  if (a >= 0.1) return a.toFixed(2)
  return Number(a.toPrecision(2)).toString()
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function makeLineChart(canvasId, color) {
  return new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: tickLabels,
      datasets: [
        {
          data: [],
          borderColor: color,
          backgroundColor: color + '22',
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: {
          ticks: { color: '#8b949e', maxTicksLimit: 6, font: { size: 10 } },
          grid: { color: '#21262d' },
        },
        y: {
          ticks: { color: '#8b949e', font: { size: 10 } },
          grid: { color: '#21262d' },
          beginAtZero: true,
        },
      },
    },
  })
}

const chartRps = makeLineChart('chartRps', '#58a6ff')
const chartLat = makeLineChart('chartLat', '#d29922')

function makeDualLineChart(canvasId, color1, color2, label1, label2) {
  return new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: tickLabels,
      datasets: [
        {
          label: label1,
          data: [],
          borderColor: color1,
          backgroundColor: color1 + '22',
          fill: false,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
        },
        {
          label: label2,
          data: [],
          borderColor: color2,
          backgroundColor: color2 + '22',
          fill: false,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#8b949e', font: { size: 10 }, boxWidth: 12 },
        },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          ticks: { color: '#8b949e', maxTicksLimit: 6, font: { size: 10 } },
          grid: { color: '#21262d' },
        },
        y: {
          ticks: { color: '#8b949e', font: { size: 10 }, callback: fmtAxis },
          grid: { color: '#21262d' },
          beginAtZero: true,
        },
      },
    },
  })
}

function makeDivergingTokensChart(canvasId) {
  return new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: tickLabels,
      datasets: [
        {
          label: 'IN: prompt tok/s',
          data: [],
          borderColor: '#58a6ff',
          backgroundColor: '#58a6ff44',
          fill: 'origin',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
          stack: 'in',
        },
        {
          label: 'IN: tool tok/s',
          data: [],
          borderColor: '#a371f7',
          backgroundColor: '#a371f744',
          fill: '-1',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
          stack: 'in',
        },
        {
          label: 'OUT: completion tok/s',
          data: [],
          borderColor: '#3fb950',
          backgroundColor: '#3fb95044',
          fill: 'origin',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
          stack: 'out',
        },
        {
          label: 'OUT: tool tok/s',
          data: [],
          borderColor: '#f0b72f',
          backgroundColor: '#f0b72f44',
          fill: '+1',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 1.5,
          stack: 'out',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#8b949e', font: { size: 10 }, boxWidth: 12 },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Math.abs(ctx.parsed.y).toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8b949e', maxTicksLimit: 6, font: { size: 10 } },
          grid: { color: '#21262d' },
        },
        y: {
          stacked: true,
          ticks: {
            color: '#8b949e',
            font: { size: 10 },
            callback: fmtAxis,
          },
          grid: {
            color: (ctx) => (ctx.tick.value === 0 ? '#8b949e' : '#21262d'),
            lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.2 : 1),
          },
        },
      },
    },
  })
}

const chartTokens = makeDivergingTokensChart('chartTokens')

function initSparklines() {
  const specs = [
    ['sparkRps', '#58a6ff', 'rps'],
    ['sparkP95', '#d29922', 'p95'],
    ['sparkErr', '#f85149', 'err'],
    ['sparkCostPerMin', '#bc8cff', 'costPerMin'],
    ['sparkTokensIn', '#58a6ff', 'tokIn'],
    ['sparkTokensOut', '#3fb950', 'tokOut'],
    ['sparkToolCalls', '#f0b72f', 'toolCalls'],
    ['sparkBytesIn', '#58a6ff', 'bytesIn'],
    ['sparkBytesOut', '#3fb950', 'bytesOut'],
    ['sparkInFlight', '#8b949e', 'inFlight'],
  ]
  for (const [id, color, key] of specs) {
    const ch = makeSparkline(id, color)
    if (ch) sparkCharts[key] = ch
  }
}
initSparklines()

function pushTick(tick) {
  const w1 = tick.windows['1m']
  const w5 = tick.windows['5m']

  kpiRps.textContent = w1.rps.toFixed(2)
  kpiP95.textContent = w1.p95
  kpiP99.textContent = w1.p99
  kpiErr.textContent = (w1.errorRate * 100).toFixed(1)
  kpiTotal.textContent = fmtNum(w5.total)
  kpiBytesIn.textContent = fmtBytes(w5.bytesIn)
  kpiBytesOut.textContent = fmtBytes(w5.bytesOut)

  inFlightPill.textContent = `in-flight: ${tick.inFlight}`

  const costPerMin = w1.totalCostUsd ?? 0
  kpiCostPerMin.textContent = fmtCost(costPerMin)
  kpiCostPerHr.textContent = fmtCost(costPerMin * 60)
  if (kpiCostPerDay) kpiCostPerDay.textContent = fmtCost(costPerMin * 1440)
  if (kpiCostPerMonth) kpiCostPerMonth.textContent = fmtCost(costPerMin * 1440 * 30)
  kpiTokensIn.textContent = fmtNum(w1.inputTokensPerSec ?? 0, 2)
  kpiTokensOut.textContent = fmtNum(w1.outputTokensPerSec ?? 0, 2)
  kpiToolCalls.textContent = fmtNum(w1.toolCalls ?? 0)
  kpiCostTotal.textContent = fmtCost(totalCostSinceBoot)

  const w1count = w1.total ?? w1.count ?? 0
  if (kpiAvgCost) kpiAvgCost.textContent = w1count > 0 ? fmtCost(costPerMin / w1count) : '—'
  const inTok = w1.inputTokens ?? (w1.inputTokensPerSec ?? 0) * 60
  const outTok = w1.outputTokens ?? (w1.outputTokensPerSec ?? 0) * 60
  if (kpiAvgTokens)
    kpiAvgTokens.textContent = w1count > 0 ? fmtNum((inTok + outTok) / w1count, 0) : '—'
  const cacheRead = w1.cacheReadTokens ?? 0
  const cacheDenom = cacheRead + (w1.inputTokens ?? inTok)
  if (kpiCacheHit)
    kpiCacheHit.textContent = cacheDenom > 0 ? ((cacheRead / cacheDenom) * 100).toFixed(1) : '—'
  const avgDur = w1.avgDurationMs ?? w1.meanDurationMs
  if (kpiAvgDur) kpiAvgDur.textContent = avgDur != null ? fmtNum(avgDur, 0) : '—'
  if (kpiInFlight) kpiInFlight.textContent = fmtNum(tick.inFlight ?? 0)
  if (kpiTopModel) {
    const byModel = w1.byModel || {}
    let top = null
    for (const [name, v] of Object.entries(byModel)) {
      const c = v?.costUsd ?? v?.totalCostUsd ?? 0
      if (!top || c > top.cost) top = { name, cost: c }
    }
    kpiTopModel.textContent = top ? top.name : '—'
  }

  pushSpark('rps', w1.rps)
  pushSpark('p95', w1.p95)
  pushSpark('err', (w1.errorRate ?? 0) * 100)
  pushSpark('costPerMin', costPerMin)
  pushSpark('tokIn', w1.inputTokensPerSec ?? 0)
  pushSpark('tokOut', w1.outputTokensPerSec ?? 0)
  pushSpark('toolCalls', w1.toolCalls ?? 0)
  pushSpark('bytesIn', w5.bytesIn)
  pushSpark('bytesOut', w5.bytesOut)
  pushSpark('inFlight', tick.inFlight ?? 0)

  const t = fmtTime(tick.ts)
  tickLabels.push(t)
  rpsSeries.push(w1.rps)
  p95Series.push(w1.p95)
  if (tickLabels.length > MAX_TICKS) {
    tickLabels.shift()
    rpsSeries.shift()
    p95Series.shift()
  }
  chartRps.data.datasets[0].data = rpsSeries
  chartRps.update('none')
  chartLat.data.datasets[0].data = p95Series
  chartLat.update('none')

  const toolInRate = w1.toolInputTokensPerSec ?? 0
  const toolOutRate = w1.toolOutputTokensPerSec ?? 0
  const normalInRate = Math.max(0, (w1.inputTokensPerSec ?? 0) - toolInRate)
  const normalOutRate = Math.max(0, (w1.outputTokensPerSec ?? 0) - toolOutRate)
  tokenInSeries.push(normalInRate)
  tokenToolInSeries.push(toolInRate)
  tokenOutSeries.push(-normalOutRate)
  tokenToolOutSeries.push(-toolOutRate)
  if (tokenInSeries.length > MAX_TICKS) {
    tokenInSeries.shift()
    tokenToolInSeries.shift()
    tokenOutSeries.shift()
    tokenToolOutSeries.shift()
  }
  chartTokens.data.datasets[0].data = tokenInSeries
  chartTokens.data.datasets[1].data = tokenToolInSeries
  chartTokens.data.datasets[2].data = tokenOutSeries
  chartTokens.data.datasets[3].data = tokenToolOutSeries
  const allVals = [...tokenInSeries, ...tokenToolInSeries, ...tokenOutSeries, ...tokenToolOutSeries]
  const peak = Math.max(...allVals.map(Math.abs), 0.001)
  chartTokens.options.scales.y.suggestedMin = -peak
  chartTokens.options.scales.y.suggestedMax = peak
  chartTokens.update('none')
}

function rowClass(status, error) {
  if (error) return 'err'
  const s = (status / 100) | 0
  return `s${s}`
}

function appendRequest(ev) {
  const tr = document.createElement('tr')
  tr.className = rowClass(ev.status, ev.error)
  const time = fmtTime(ev.ts)
  tr.innerHTML = `
    <td>${time}</td>
    <td>${escHtml(ev.method)}</td>
    <td>${escHtml(ev.path)}</td>
    <td class="status num" title="${ev.error ? escHtml(String(ev.error)) : ''}">${errorLabel(ev.error) ?? ev.status ?? '—'}</td>
    <td class="num">${ev.durationMs}</td>
    <td class="num">${fmtBytes(ev.bytesIn)}</td>
    <td class="num">${fmtBytes(ev.bytesOut)}</td>
  `
  recentTbody.prepend(tr)
  while (recentTbody.children.length > MAX_TABLE_ROWS) {
    recentTbody.removeChild(recentTbody.lastChild)
  }
}

async function loadRecent() {
  try {
    const r = await fetch('/api/metrics/recent?limit=200')
    if (!r.ok) return
    const events = await r.json()
    recentTbody.innerHTML = ''
    // recent() returns oldest-first; prepend each to display newest at top.
    events.forEach(appendRequest)
  } catch {}
}

async function seedTotalCost() {
  try {
    const r = await fetch('/api/metrics/recent?limit=5000')
    if (!r.ok) return
    const events = await r.json()
    let sum = 0
    for (const ev of events) {
      if (ev && typeof ev.costUsd === 'number') sum += ev.costUsd
    }
    totalCostSinceBoot = sum
    totalCostSeeded = true
    kpiCostTotal.textContent = fmtCost(totalCostSinceBoot)
  } catch {}
}

async function loadModels() {
  const r = await fetch('/api/metrics/models')
  if (!r.ok) return
  const rows = await r.json()
  modelsTbody.innerHTML = ''
  let totReq = 0,
    totIn = 0,
    totOut = 0,
    totCost = 0
  for (const row of rows) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${escHtml(row.model)}</td>
      <td>${escHtml(row.provider ?? '—')}</td>
      <td class="num">${fmtNum(row.requests)}</td>
      <td class="num">${fmtTokens(row.inputTokens)}</td>
      <td class="num">${fmtTokens(row.outputTokens)}</td>
      <td class="num">${fmtCost(row.costUsd)}</td>
    `
    modelsTbody.appendChild(tr)
    totReq += row.requests
    totIn += row.inputTokens
    totOut += row.outputTokens
    totCost += row.costUsd
  }
  modelsTotalReq.textContent = fmtNum(totReq)
  modelsTotalIn.textContent = fmtTokens(totIn)
  modelsTotalOut.textContent = fmtTokens(totOut)
  modelsTotalCost.textContent = fmtCost(totCost)
}

async function loadTopCost() {
  const r = await fetch('/api/metrics/recent?limit=200')
  if (!r.ok) return
  const events = await r.json()
  const top = events
    .filter((ev) => ev && typeof ev.costUsd === 'number' && ev.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10)
  topCostTbody.innerHTML = ''
  for (const ev of top) {
    const tr = document.createElement('tr')
    const time = fmtTime(ev.ts)
    tr.innerHTML = `
      <td>${time}</td>
      <td>${escHtml(ev.model ?? '—')}</td>
      <td class="num">${fmtTokens(ev.inputTokens ?? 0)}</td>
      <td class="num">${fmtTokens(ev.outputTokens ?? 0)}</td>
      <td class="num">${fmtCost(ev.costUsd)}</td>
      <td class="num">${ev.durationMs ?? '—'}</td>
    `
    topCostTbody.appendChild(tr)
  }
}

function connectMetricsSSE() {
  const es = new EventSource('/api/metrics/stream')
  es.onopen = () => {
    metricsStatus.textContent = 'Live'
    metricsStatus.className = 'status connected'
    document.querySelector('.recent-header')?.classList.add('icon-live')
  }
  es.onerror = () => {
    metricsStatus.textContent = 'Reconnecting…'
    metricsStatus.className = 'status disconnected'
    document.querySelector('.recent-header')?.classList.remove('icon-live')
  }
  es.addEventListener('tick', (e) => {
    try {
      pushTick(JSON.parse(e.data))
    } catch {}
  })
  es.addEventListener('request', (e) => {
    try {
      const ev = JSON.parse(e.data)
      appendRequest(ev)
      bufferAndRender('proxy', ev)
      if (ev && typeof ev.costUsd === 'number') {
        totalCostSinceBoot += ev.costUsd
        kpiCostTotal.textContent = fmtCost(totalCostSinceBoot)
      }
    } catch {}
  })
  es.addEventListener('tick', () => {
    loadModels().catch(() => {})
    loadTopCost().catch(() => {})
  })
  es.addEventListener('evicted', () => {
    metricsStatus.textContent = 'Evicted (cap)'
    metricsStatus.className = 'status disconnected'
    document.querySelector('.recent-header')?.classList.remove('icon-live')
  })
}

document.getElementById('metricsClearBtn').addEventListener('click', () => {
  recentTbody.innerHTML = ''
})

// ─── Boot ────────────────────────────────────────────────────
const HASH_TO_TAB = {
  '#metrics': 'metrics',
  '#setup': 'setup',
  '#compactor': 'compactor',
  '#logs': 'logs',
}
const initialTab = HASH_TO_TAB[location.hash] ?? 'logs'
activateTab(initialTab)

loadAvailable()
loadLive()
loadHealth()
loadRecent()
seedTotalCost().catch(() => {})
loadModels().catch(() => {})
loadTopCost().catch(() => {})
connectLogsSSE()
connectMetricsSSE()
setInterval(loadHealth, 10_000)
setInterval(() => {
  loadModels().catch(() => {})
  loadTopCost().catch(() => {})
}, 5000)
