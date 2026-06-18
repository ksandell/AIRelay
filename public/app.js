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
const guardrailsPanel = document.getElementById('guardrailsPanel')
const guardrailsControls = document.getElementById('guardrailsControls')

function activateTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name))
  setupPanel.classList.toggle('hidden', name !== 'setup')
  logsPanel.classList.toggle('hidden', name !== 'logs')
  metricsPanel.classList.toggle('hidden', name !== 'metrics')
  if (compactorPanel) compactorPanel.classList.toggle('hidden', name !== 'compactor')
  if (guardrailsPanel) guardrailsPanel.classList.toggle('hidden', name !== 'guardrails')
  const cachePanel = document.getElementById('cachePanel')
  const cacheControls = document.getElementById('cacheControls')
  if (cachePanel) cachePanel.classList.toggle('hidden', name !== 'cache')
  if (cacheControls) cacheControls.classList.toggle('hidden', name !== 'cache')
  setupControls.classList.toggle('hidden', name !== 'setup')
  logsControls.classList.toggle('hidden', name !== 'logs')
  metricsControls.classList.toggle('hidden', name !== 'metrics')
  if (compactorControls) compactorControls.classList.toggle('hidden', name !== 'compactor')
  if (guardrailsControls) guardrailsControls.classList.toggle('hidden', name !== 'guardrails')
  const dashboardPanel = document.getElementById('dashboardPanel')
  const dashboardControls = document.getElementById('dashboardControls')
  const settingsPanel = document.getElementById('settingsPanel')
  const settingsControls = document.getElementById('settingsControls')
  if (dashboardPanel) dashboardPanel.classList.toggle('hidden', name !== 'dashboard')
  if (dashboardControls) dashboardControls.classList.toggle('hidden', name !== 'dashboard')
  if (settingsPanel) settingsPanel.classList.toggle('hidden', name !== 'settings')
  if (settingsControls) settingsControls.classList.toggle('hidden', name !== 'settings')
  location.hash = name
  if (name === 'compactor') refreshCompactor()
  if (name === 'guardrails') refreshGuardrails()
  // Re-pull ring-buffer data when the user lands on Logs/Metrics so tables
  // populate even if the tab was hidden when the proxy traffic arrived.
  // Only reload on first visit; SSE stream handles incremental updates after that.
  if (name === 'logs' && typeof loadLive === 'function' && !dateSelect?.value && logBuffer.length === 0) {
    loadLive().catch(() => {})
  }
  if (name === 'metrics' && typeof loadRecent === 'function') {
    loadRecent().catch(() => {})
    if (currentHistoryWindow() !== 'live') {
      lastHistoryChartRefresh = Date.now()
      refreshChartsForWindow().catch(() => {})
    }
  }
  if (name === 'dashboard') refreshDashboard().catch(() => {})
  if (name === 'settings') refreshSettings().catch(() => {})
  if (name === 'cache') refreshCacheAuto().catch(() => {})
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
      fetch('/api/compactor/recent?limit=500'),
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

    pushSpark('compactorBytes1m', s.windows['1m'].bytesSaved)
    pushSpark('compactorBytes5m', s.windows['5m'].bytesSaved)
    pushSpark('compactorBytesLifetime', s.lifetime.bytesSaved)
    pushSpark('compactorTokensLifetime', Math.floor(s.lifetime.bytesSaved / 4))
    pushSpark('compactorRatio5m', r == null ? 0 : Math.round((1 - r) * 100))
    pushSpark('compactorBypasses', s.lifetime.requestsBypassed)

    const tbody = document.querySelector('#compactorTable tbody')
    tbody.innerHTML = ''
    const activeSet = new Set(s.compressors.active)
    for (const name of s.compressors.all) {
      const agg = s.lifetime.byCompressor[name]
      const tr = document.createElement('tr')
      const fires = agg?.fires ?? 0
      const saved = agg?.bytesSaved ?? 0
      const avgMicros = fires > 0 ? Math.round(agg.durationMicros / fires) : 0
      tr.innerHTML = `<td><code>${escHtml(name)}</code></td>
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
      tr.innerHTML = `<td>${fmtTimeShort(ev.ts)}</td>
        <td>${escHtml(ev.scope)}</td>
        <td>${escHtml(ev.filtersFired.join(', ') || '—')}</td>
        <td>${ev.bytesIn} → ${ev.bytesOut}</td>
        <td>${fmtBytes(ev.bytesSaved)}</td>
        <td>${ev.durationMicros}</td>
        <td>${escHtml(ev.bypassReason ?? '')}</td>`
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
if (compactorRefreshBtn) compactorRefreshBtn.addEventListener('click', refreshCompactorAuto)
setInterval(() => {
  if (compactorPanel && !compactorPanel.classList.contains('hidden')) refreshCompactorAuto()
}, 5000)

// Keep the Cache tab's KPIs + sparklines live while it's the active panel.
setInterval(() => {
  const cp = document.getElementById('cachePanel')
  if (cp && !cp.classList.contains('hidden')) refreshCacheAuto().catch(() => {})
}, 5000)

// Keep the Dashboard live while it's the active panel. Without this the activity
// sparkline only ever receives a single data point (taken on tab-open) and
// renders as a flat line; periodic refresh feeds pushDashPoint over time.
setInterval(() => {
  const dp = document.getElementById('dashboardPanel')
  if (dp && !dp.classList.contains('hidden')) refreshDashboard().catch(() => {})
}, 5000)

const compactorHistoryWindowEl = document.getElementById('compactorHistoryWindow')
if (compactorHistoryWindowEl) {
  compactorHistoryWindowEl.addEventListener('change', refreshCompactorAuto)
}

async function refreshCompactorAuto() {
  const win = compactorHistoryWindowEl?.value || 'live'
  if (win === 'live') return refreshCompactor()
  const range = windowToRange(win)
  if (!range) return refreshCompactor()
  await refreshCompactor() // get status/enabled pills from live summary
  const params = new URLSearchParams({ from: range.from, to: range.to, limit: '5000' })
  try {
    const [compHistRes, metHistRes] = await Promise.all([
      fetch('/api/compactor/history?' + params),
      fetch('/api/metrics/history?' + params),
    ])
    if (compHistRes.ok) {
      const body = await compHistRes.json()
      const rbody = document.querySelector('#compactorRecentTable tbody')
      if (rbody) {
        rbody.innerHTML = ''
        for (const ev of body.events ?? []) {
          const tr = document.createElement('tr')
          const filters = ev.compactorCompressors || '—'
          tr.innerHTML = `<td>${fmtTimeShort(ev.ts)}</td>
            <td>request</td>
            <td>${filters}</td>
            <td>${ev.bytesIn ?? 0} → ${ev.bytesOut ?? 0}</td>
            <td>${fmtBytes(ev.compactorSavedBytes ?? 0)}</td>
            <td>—</td>
            <td>${ev.compactorBypass ? 'header' : ''}</td>`
          rbody.appendChild(tr)
        }
      }
    }
    if (metHistRes.ok) {
      const body = await metHistRes.json()
      renderCompactorHistoryKpis(body.events ?? [], win)
    }
  } catch {
    // ignore
  }
}

// ─── Guardrails panel ────────────────────────────────────────
async function refreshGuardrails() {
  const statusEl = document.getElementById('guardrailsStatus')
  const enabledPill = document.getElementById('guardrailsEnabledPill')
  try {
    const [summaryRes, recentRes] = await Promise.all([
      fetch('/api/guardrails/summary'),
      fetch('/api/guardrails/recent?limit=500'),
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

    const scanned1m = s.windows['1m'].requestsScanned
    const hits1m = s.windows['1m'].hits
    document.getElementById('guardrailsScanned1m').textContent = scanned1m
    document.getElementById('guardrailsHits1m').textContent = hits1m
    document.getElementById('guardrailsBlockedLifetime').textContent = s.lifetime.requestsBlocked
    document.getElementById('guardrailsRedactedLifetime').textContent = s.lifetime.requestsRedacted
    document.getElementById('guardrailsAlertedLifetime').textContent = s.lifetime.requestsAlerted
    document.getElementById('guardrailsBypassesLifetime').textContent = s.lifetime.requestsBypassed

    pushSpark('guardrailsScanned1m', scanned1m)
    pushSpark('guardrailsHits1m', hits1m)
    pushSpark('guardrailsBlockedLifetime', s.lifetime.requestsBlocked)
    pushSpark('guardrailsRedactedLifetime', s.lifetime.requestsRedacted)
    pushSpark('guardrailsAlertedLifetime', s.lifetime.requestsAlerted)
    pushSpark('guardrailsBypassesLifetime', s.lifetime.requestsBypassed)

    const tbody = document.querySelector('#guardrailsTable tbody')
    tbody.innerHTML = ''
    const activeMap = new Map(s.detectors.active.map((d) => [d.name, d]))
    for (const name of s.detectors.all) {
      const active = activeMap.get(name)
      const agg = s.lifetime.byDetector[name]
      const tr = document.createElement('tr')
      const fires = agg?.fires ?? 0
      const hits = agg?.hits ?? 0
      const bytesRedacted = agg?.bytesRedacted ?? 0
      tr.innerHTML = `<td><code>${escHtml(name)}</code></td>
        <td>${escHtml(active ? active.category : '—')}</td>
        <td>${escHtml(active ? active.mode : 'off')}</td>
        <td>${fires}</td>
        <td>${hits}</td>
        <td>${fmtBytes(bytesRedacted)}</td>`
      tbody.appendChild(tr)
    }

    const rbody = document.querySelector('#guardrailsRecentTable tbody')
    rbody.innerHTML = ''
    for (const ev of recent) {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${fmtTimeShort(ev.ts)}</td>
        <td>${escHtml(ev.mode)}</td>
        <td>${escHtml(ev.detectorsFired.join(', ') || '—')}</td>
        <td>${ev.hits}</td>
        <td>${ev.bytesIn} → ${ev.bytesOut}</td>
        <td>${ev.blocked ? '✓' : ''}</td>
        <td>${escHtml(ev.bypassReason ?? '')}</td>`
      rbody.appendChild(tr)
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = 'Error'
      statusEl.className = 'status disconnected'
    }
  }
}

const guardrailsRefreshBtn = document.getElementById('guardrailsRefreshBtn')
if (guardrailsRefreshBtn) guardrailsRefreshBtn.addEventListener('click', refreshGuardrailsAuto)
setInterval(() => {
  if (guardrailsPanel && !guardrailsPanel.classList.contains('hidden')) refreshGuardrailsAuto()
}, 5000)

const guardrailsHistoryWindowEl = document.getElementById('guardrailsHistoryWindow')
if (guardrailsHistoryWindowEl) {
  guardrailsHistoryWindowEl.addEventListener('change', refreshGuardrailsAuto)
}

async function refreshGuardrailsAuto() {
  const win = guardrailsHistoryWindowEl?.value || 'live'
  if (win === 'live') return refreshGuardrails()
  const range = windowToRange(win)
  if (!range) return refreshGuardrails()
  await refreshGuardrails() // get status/enabled pills from live summary
  const params = new URLSearchParams({ from: range.from, to: range.to, limit: '5000' })
  try {
    const [grHistRes, metHistRes] = await Promise.all([
      fetch('/api/guardrails/history?' + params),
      fetch('/api/metrics/history?' + params),
    ])
    if (grHistRes.ok) {
      const body = await grHistRes.json()
      const rbody = document.querySelector('#guardrailsRecentTable tbody')
      if (rbody) {
        rbody.innerHTML = ''
        for (const ev of body.events ?? []) {
          const tr = document.createElement('tr')
          const det = ev.guardrailsDetectors || '—'
          tr.innerHTML = `<td>${fmtTimeShort(ev.ts)}</td>
            <td>${ev.guardrailsAction ?? '—'}</td>
            <td>${det}</td>
            <td>${ev.guardrailsHits ?? 0}</td>
            <td>${ev.bytesIn ?? 0} → ${ev.bytesOut ?? 0}</td>
            <td>${ev.guardrailsAction === 'block' ? '✓' : ''}</td>
            <td>${ev.guardrailsAction === 'bypass' ? 'header' : ''}</td>`
          rbody.appendChild(tr)
        }
      }
    }
    if (metHistRes.ok) {
      const body = await metHistRes.json()
      renderGuardrailsHistoryKpis(body.events ?? [], win)
    }
  } catch {
    // ignore
  }
}

// ─── Dashboard panel ─────────────────────────────────────────
let dashSparklineChart = null
let dashRpsHistory = []
let dashP95History = []
const DASH_SPARKLINE_POINTS = 30

function pushDashPoint(rps, p95) {
  dashRpsHistory = [...dashRpsHistory, rps].slice(-DASH_SPARKLINE_POINTS)
  dashP95History = [...dashP95History, p95].slice(-DASH_SPARKLINE_POINTS)
  if (dashSparklineChart) {
    dashSparklineChart.data.labels = dashRpsHistory.map((_, i) => i)
    dashSparklineChart.data.datasets[0].data = [...dashRpsHistory]
    dashSparklineChart.data.datasets[1].data = [...dashP95History]
    dashSparklineChart.update('none')
  }
}

function initDashSparkline() {
  const canvas = document.getElementById('dashSparkline')
  if (!canvas || dashSparklineChart) return
  dashSparklineChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'RPS',
          data: [],
          borderColor: '#6366f1',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'p95 (ms)',
          data: [],
          borderColor: '#f59e0b',
          borderWidth: 2,
          borderDash: [4, 3],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      animation: TEST_MODE ? false : { duration: 200 },
      plugins: { legend: { display: true, position: 'bottom' } },
      scales: {
        x: { display: false },
        y: { beginAtZero: true, position: 'left', title: { display: true, text: 'RPS' } },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'ms' },
        },
      },
      responsive: true,
      maintainAspectRatio: false,
    },
  })
}

function setHealthDot(id, state) {
  const el = document.getElementById(id)
  if (!el) return
  el.className = `health-dot dot-${state}`
}

function buildRecommendations(health, compactorSummary, guardrailsSummary, cacheData) {
  const recs = []
  if (!guardrailsSummary?.enabled) {
    recs.push({ text: '⚠ Guardrails disabled — enable at least alert mode', tab: 'settings' })
  }
  if (compactorSummary?.enabled && compactorSummary?.settings?.toolResultOnly === false) {
    recs.push({ text: 'ℹ Tool-result-only off — tighter scope available', tab: 'settings' })
  }
  if (health && !health.proxy?.enabled) {
    recs.push({ text: '✕ No upstream configured', tab: 'settings' })
  }
  if (health && health.status !== 'ok') {
    recs.push({ text: '✕ Proxy health check failing — check upstream URL', tab: null })
  }
  if (cacheData?.enabled && !cacheData?.connected) {
    recs.push({
      text: '✕ Cache enabled but Dragonfly disconnected — check CACHE_REDIS_URL',
      tab: null,
    })
  }
  return recs
}

function renderKpiRow(summary, compactor) {
  // Ring-buffer count since boot (snapshot().count) is the most reliable
  // "total" we have without a persistent DB. Label reflects "session" scope.
  const total = summary?.count
  document.getElementById('dashKpiRequests').textContent =
    typeof total === 'number' ? total.toLocaleString() : '—'
  // Cost: use the SSE-accumulated running total (seeded from ring buffer on boot).
  document.getElementById('dashKpiCost').textContent = fmtCost(totalCostSinceBoot)
  const p95 = summary?.windows?.['1m']?.p95 ?? summary?.window_1m?.p95
  document.getElementById('dashKpiP95').textContent = typeof p95 === 'number' ? p95 + ' ms' : '—'
  const bytesSavedCard = document.getElementById('dashKpiBytesSavedCard')
  if (compactor?.enabled && bytesSavedCard) {
    bytesSavedCard.hidden = false
    const saved = compactor.lifetime?.bytesSaved ?? 0
    const bytesIn = compactor.lifetime?.bytesIn ?? 0
    const pct = bytesIn > 0 ? Math.round((saved / bytesIn) * 100) : 0
    document.getElementById('dashKpiBytesSaved').textContent = pct + '%'
  } else if (bytesSavedCard) {
    bytesSavedCard.hidden = true
  }
  return p95
}

function renderCacheKpi(cacheData) {
  const cacheKpiCard = document.getElementById('dashKpiCacheCard')
  if (!cacheKpiCard) return
  if (cacheData?.enabled) {
    cacheKpiCard.hidden = false
    const rate = cacheData.lifetime?.hitRate ?? 0
    document.getElementById('dashKpiCacheHitRate').textContent = (rate * 100).toFixed(1) + '%'
  } else {
    cacheKpiCard.hidden = true
  }
}

function dashRecentRow(ev) {
  const tr = document.createElement('tr')
  const tokens = (ev.inputTokens ?? ev.tokensIn ?? 0) + (ev.outputTokens ?? ev.tokensOut ?? 0)
  tr.innerHTML = `<td>${fmtTimeShort(ev.ts)}</td>
    <td><code>${escHtml(ev.model ?? '—')}</code></td>
    <td>${tokens}</td>
    <td>${ev.costUsd != null ? '$' + ev.costUsd.toFixed(5) : '—'}</td>
    <td>${ev.durationMs != null ? ev.durationMs + ' ms' : '—'}</td>`
  return tr
}

function renderRecentTable(recent) {
  const tbody = document.querySelector('#dashRecentTable tbody')
  if (!tbody) return
  tbody.innerHTML = ''
  // API returns oldest-first; reverse so newest appears at top (matches updateDashRecent).
  const src = Array.isArray(recent) ? recent : (recent.events ?? [])
  const rows = src.slice().reverse().slice(0, 5)
  for (const ev of rows) tbody.appendChild(dashRecentRow(ev))
}

// Called from SSE request handler to keep the dashboard recent table live.
function updateDashRecent(ev) {
  const tbody = document.querySelector('#dashRecentTable tbody')
  if (!tbody) return
  tbody.prepend(dashRecentRow(ev))
  while (tbody.children.length > 5) tbody.removeChild(tbody.lastChild)
}

function renderHealthSidebar(health, compactor, guardrails, cacheData) {
  const proxyOk = health.status === 'ok'
  setHealthDot('dashHealthProxy', proxyOk ? 'ok' : 'error')
  document.getElementById('dashHealthProxyLabel').textContent = proxyOk
    ? 'OK'
    : (health.status ?? 'Unknown')

  const compEnabled = compactor?.enabled ?? false
  const compActive = compactor?.compressors?.active?.length ?? 0
  const compAll = compactor?.compressors?.all?.length ?? 0
  setHealthDot('dashHealthCompactor', compEnabled ? 'ok' : 'neutral')
  document.getElementById('dashHealthCompactorLabel').textContent = compEnabled
    ? `On (${compActive}/${compAll} active)`
    : 'Off'

  const grEnabled = guardrails?.enabled ?? false
  const grActive = guardrails?.detectors?.active?.length ?? 0
  const grAll = guardrails?.detectors?.all?.length ?? 0
  setHealthDot('dashHealthGuardrails', grEnabled ? 'ok' : 'warn')
  document.getElementById('dashHealthGuardrailsLabel').textContent = grEnabled
    ? `On (${grActive}/${grAll} active)`
    : 'Off'

  const cacheEnabled = cacheData?.enabled ?? false
  const cacheConnected = cacheData?.connected ?? false
  const cacheState = !cacheEnabled ? 'neutral' : cacheConnected ? 'ok' : 'error'
  setHealthDot('dashHealthCache', cacheState)
  const cacheLabel = document.getElementById('dashHealthCacheLabel')
  if (cacheLabel) {
    cacheLabel.textContent = !cacheEnabled
      ? 'Off'
      : cacheConnected
        ? `Connected (${cacheData.keyCount ?? 0} keys)`
        : 'Disconnected'
  }
}

function renderRecommendations(health, compactor, guardrails, cacheData) {
  const recs = buildRecommendations(health, compactor, guardrails, cacheData)
  const recCard = document.getElementById('dashRecommendationsCard')
  const recList = document.getElementById('dashRecommendationsList')
  if (!recCard || !recList) return
  recCard.hidden = recs.length === 0
  recList.innerHTML = ''
  for (const rec of recs) {
    const li = document.createElement('li')
    if (rec.tab) {
      const btn = document.createElement('button')
      btn.className = 'rec-link'
      btn.textContent = rec.text + ' →'
      btn.addEventListener('click', () => activateTab(rec.tab))
      li.appendChild(btn)
    } else {
      li.textContent = rec.text
    }
    recList.appendChild(li)
  }
}

async function refreshDashboard() {
  const statusEl = document.getElementById('dashboardStatus')
  try {
    initDashSparkline()
    const [healthRes, summaryRes, recentRes, compactorRes, guardrailsRes, cacheRes] =
      await Promise.all([
        fetch('/health'),
        fetch('/api/metrics/summary'),
        fetch('/api/metrics/recent?limit=5'),
        fetch('/api/compactor/summary'),
        fetch('/api/guardrails/summary'),
        fetch('/api/cache/summary'),
      ])
    if (!healthRes.ok) throw new Error('health fetch failed')
    const health = await healthRes.json()
    if (!summaryRes.ok) console.warn('refreshDashboard: summary fetch failed', summaryRes.status)
    if (!recentRes.ok) console.warn('refreshDashboard: recent fetch failed', recentRes.status)
    if (!compactorRes.ok)
      console.warn('refreshDashboard: compactor fetch failed', compactorRes.status)
    if (!guardrailsRes.ok)
      console.warn('refreshDashboard: guardrails fetch failed', guardrailsRes.status)
    const summary = summaryRes.ok ? await summaryRes.json() : null
    const recent = recentRes.ok ? await recentRes.json() : []
    const compactor = compactorRes.ok ? await compactorRes.json() : null
    const guardrails = guardrailsRes.ok ? await guardrailsRes.json() : null
    const cacheData = cacheRes.ok ? await cacheRes.json() : null

    if (statusEl) {
      statusEl.textContent = 'Live'
      statusEl.className = 'status connected'
    }

    const p95 = renderKpiRow(summary, compactor)
    renderCacheKpi(cacheData)
    pushDashPoint(summary?.window_1m?.rps ?? 0, p95 ?? 0)
    renderRecentTable(recent)
    renderHealthSidebar(health, compactor, guardrails, cacheData)
    renderRecommendations(health, compactor, guardrails, cacheData)
    // Override KPIs with history aggregates when a window is selected
    const dashWin = currentHistoryWindow()
    if (dashWin !== 'live') {
      const range = windowToRange(dashWin)
      if (range) {
        const params = new URLSearchParams({ from: range.from, to: range.to, limit: '5000' })
        fetch('/api/metrics/history?' + params)
          .then(r => r.ok ? r.json() : null)
          .then(body => { if (body) renderDashboardHistoryKpis(body.events ?? [], dashWin) })
          .catch(() => {})
      }
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = 'Error'
      statusEl.className = 'status disconnected'
    }
  }
}

// ─── Cache tab ────────────────────────────────────────
function cacheFmt(n) {
  return n == null ? '—' : n.toLocaleString()
}
function cacheFmtPct(r) {
  return r == null ? '—' : (r * 100).toFixed(1) + '%'
}
function cacheFmtBytes(b) {
  if (b == null) return '—'
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + ' MB'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}

async function refreshCache() {
  const statusEl = document.getElementById('cacheStatus')
  try {
    const [summaryRes, recentRes] = await Promise.all([
      fetch('/api/cache/summary'),
      fetch('/api/cache/recent?limit=500'),
    ])
    if (!summaryRes.ok) throw new Error('cache summary fetch failed')
    const s = await summaryRes.json()
    const recent = recentRes.ok ? await recentRes.json() : []

    const enabled = s.enabled
    const connected = s.connected

    if (statusEl) {
      statusEl.textContent = !enabled ? 'Disabled' : connected ? 'Connected' : 'Disconnected'
      statusEl.className =
        'status ' + (!enabled ? 'disconnected' : connected ? 'connected' : 'disconnected')
    }

    const dot = document.getElementById('cacheConnDot')
    const label = document.getElementById('cacheConnLabel')
    if (dot)
      dot.className =
        'health-dot ' + (!enabled ? 'dot-neutral' : connected ? 'dot-ok' : 'dot-error')
    if (label)
      label.textContent = !enabled
        ? 'Cache disabled'
        : connected
          ? `Connected (${s.keyCount ?? 0} keys)`
          : 'Disconnected — check CACHE_REDIS_URL'

    const setPill = (id, on, text) => {
      const el = document.getElementById(id)
      if (!el) return
      el.textContent = text
      el.className = 'cache-status-pill ' + (on ? 'pill-on' : 'pill-off')
    }
    setPill(
      'cacheExactPill',
      s.exactMatch?.enabled,
      `Exact ${s.exactMatch?.enabled ? 'on' : 'off'}`,
    )
    setPill('cacheDedupPill', s.dedup?.enabled, `Dedup ${s.dedup?.enabled ? 'on' : 'off'}`)
    setPill('cacheSpendPill', s.spend?.enabled, `Spend limits ${s.spend?.enabled ? 'on' : 'off'}`)

    document.getElementById('cacheKpiHits1m').textContent = cacheFmt(s.window_1m?.exactHits)
    document.getElementById('cacheKpiHitRate').textContent = cacheFmtPct(s.window_1m?.hitRate)
    document.getElementById('cacheKpiBytesFromCache').textContent = cacheFmtBytes(
      s.window_1m?.bytesFromCache,
    )
    document.getElementById('cacheKpiDedup').textContent = cacheFmt(s.window_1m?.dedupCoalesced)
    document.getElementById('cacheKpiSpendRejects').textContent = cacheFmt(
      s.window_1m?.spendRejected,
    )
    document.getElementById('cacheKpiHitsLifetime').textContent = cacheFmt(s.lifetime?.exactHits)
    document.getElementById('cacheKpiHitRateLifetime').textContent = cacheFmtPct(
      s.lifetime?.hitRate,
    )
    document.getElementById('cacheKpiKeyCount').textContent = cacheFmt(s.keyCount)
    document.getElementById('cacheKpiInflight').textContent = cacheFmt(s.dedup?.inflight)

    // Feed the 1-minute sparklines (same live-accumulation pattern as the other tabs).
    pushSpark('cacheHits1m', s.window_1m?.exactHits ?? 0)
    pushSpark('cacheHitRate', Math.round((s.window_1m?.hitRate ?? 0) * 100))
    pushSpark('cacheBytesFromCache', s.window_1m?.bytesFromCache ?? 0)
    pushSpark('cacheDedup1m', s.window_1m?.dedupCoalesced ?? 0)
    pushSpark('cacheSpendRejects1m', s.window_1m?.spendRejected ?? 0)

    const notice = document.getElementById('cacheDisabledNotice')
    const recentCard = document.getElementById('cacheRecentCard')
    if (notice) notice.hidden = enabled
    if (recentCard) recentCard.hidden = !enabled

    const tbody = document.querySelector('#cacheRecentTable tbody')
    if (tbody) {
      tbody.innerHTML = ''
      for (const ev of recent) {
        const tr = document.createElement('tr')
        const type = ev.type ?? '—'
        tr.innerHTML = `<td>${fmtTimeShort(ev.ts)}</td>
          <td><span class="cache-type-badge cache-${String(type).toLowerCase()}">${escHtml(type)}</span></td>
          <td><code>${escHtml(ev.keyPrefix ?? '—')}</code></td>
          <td>${ev.keyAgeS ?? '—'}</td>
          <td>${ev.bytes != null ? cacheFmtBytes(ev.bytes) : '—'}</td>`
        tbody.appendChild(tr)
      }
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = 'Error'
      statusEl.className = 'status disconnected'
    }
  }
}

const cacheHistoryWindowEl = document.getElementById('cacheHistoryWindow')
const cacheRefreshBtn = document.getElementById('cacheRefreshBtn')

async function refreshCacheAuto() {
  const win = cacheHistoryWindowEl?.value || 'live'
  if (win === 'live') {
    // Resize sparklines now that the panel is visible — Chart.js may have
    // created them at zero size while the panel was hidden.
    requestAnimationFrame(() => {
      for (const k of [
        'cacheHits1m',
        'cacheHitRate',
        'cacheBytesFromCache',
        'cacheDedup1m',
        'cacheSpendRejects1m',
      ]) {
        sparkCharts[k]?.resize()
      }
    })
    return refreshCache()
  }
  const range = windowToRange(win)
  if (!range) return refreshCache()
  await refreshCache() // get status/enabled pills from live summary
  const params = new URLSearchParams({ from: range.from, to: range.to, limit: '5000' })
  try {
    const [cacheHistRes, metHistRes] = await Promise.all([
      fetch('/api/cache/history?' + params),
      fetch('/api/metrics/history?' + params),
    ])
    if (cacheHistRes.ok) {
      const body = await cacheHistRes.json()
      const tbody = document.querySelector('#cacheRecentTable tbody')
      if (tbody) {
        tbody.innerHTML = ''
        for (const ev of body.events ?? []) {
          const tr = document.createElement('tr')
          const type = ev.type ?? ev.cacheEventType ?? '—'
          tr.innerHTML = `<td>${fmtTimeShort(ev.ts)}</td>
            <td><span class="cache-type-badge cache-${String(type).toLowerCase()}">${escHtml(type)}</span></td>
            <td><code>${escHtml(ev.keyPrefix ?? ev.cacheKey?.slice(0, 16) ?? '—')}</code></td>
            <td>${ev.keyAgeS ?? '—'}</td>
            <td>${ev.bytes != null ? cacheFmtBytes(ev.bytes) : '—'}</td>`
          tbody.appendChild(tr)
        }
      }
    }
    if (metHistRes.ok) {
      const body = await metHistRes.json()
      renderCacheHistoryKpis(body.events ?? [], win)
    }
  } catch {
    // ignore
  }
}

if (cacheHistoryWindowEl)
  cacheHistoryWindowEl.addEventListener('change', () =>
    syncHistoryWindow(cacheHistoryWindowEl.value),
  )
if (cacheRefreshBtn) cacheRefreshBtn.addEventListener('click', refreshCacheAuto)

// Wire "View all in Logs →" link
document.getElementById('dashLogsLink')?.addEventListener('click', (e) => {
  e.preventDefault()
  activateTab('logs')
})
// Wire Quick links
document.querySelectorAll('.tab-link[data-tab]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault()
    activateTab(a.dataset.tab)
  })
})

// ─── Settings tab ─────────────────────────────────────────────
let _serverSettings = {}
let _pendingChanges = {}

function settingsIsDirty() {
  return Object.keys(_pendingChanges).length > 0
}

function updateDirtyBanner() {
  const pill = document.getElementById('settingsDirtyPill')
  const save = document.getElementById('settingsSaveBtn')
  const discard = document.getElementById('settingsDiscardBtn')
  const dirty = settingsIsDirty()
  if (pill) pill.hidden = !dirty
  if (save) save.hidden = !dirty
  if (discard) discard.hidden = !dirty
}

function applySettingsToUI(effective) {
  // Checkboxes
  for (const input of document.querySelectorAll(
    '#settingsPanel input[type="checkbox"][data-key]',
  )) {
    const key = input.dataset.key
    if (key in effective) input.checked = effective[key]
  }
  // Mode pills
  for (const group of document.querySelectorAll('#settingsPanel .mode-pills[data-key]')) {
    const key = group.dataset.key
    const val = effective[key]
    for (const pill of group.querySelectorAll('.mode-pill')) {
      pill.classList.toggle('active', pill.dataset.mode === val)
    }
    const card = group.closest('.category-card')
    if (card) card.className = `category-card mode-${val ?? 'off'}`
  }
  // Dim compressor cards
  for (const card of document.querySelectorAll('#compressorGrid .compressor-card')) {
    const key = card.dataset.key
    if (key in effective) card.classList.toggle('off', !effective[key])
  }
  // Dim detector cards
  for (const card of document.querySelectorAll('#detectorGrid .compressor-card')) {
    const key = card.dataset.key
    if (key in effective) card.classList.toggle('off', !effective[key])
  }
  // Compactor subsection dimming
  const compSub = document.getElementById('compactorSubsection')
  if (compSub) compSub.style.opacity = effective.compactorEnabled ? '1' : '0.5'
  // Guardrails subsection dimming
  const grSub = document.getElementById('guardrailsSubsection')
  if (grSub) grSub.style.opacity = effective.guardrailsEnabled ? '1' : '0.5'
}

async function refreshSettings() {
  try {
    const res = await fetch('/api/settings')
    if (!res.ok) throw new Error('settings fetch failed')
    const data = await res.json()
    _serverSettings = { ...data.effective }
    _pendingChanges = {}
    applySettingsToUI(data.effective)
    updateDirtyBanner()
  } catch (err) {
    console.error('refreshSettings failed:', err)
    // retain current UI state on error
  }
}

// Wire checkbox changes
document.querySelectorAll('#settingsPanel input[type="checkbox"][data-key]').forEach((input) => {
  input.addEventListener('change', () => {
    const key = input.dataset.key
    _pendingChanges[key] = input.checked
    applySettingsToUI({ ..._serverSettings, ..._pendingChanges })
    updateDirtyBanner()
  })
})

// Wire mode pill clicks
document.querySelectorAll('#settingsPanel .mode-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const group = pill.closest('.mode-pills')
    if (!group) return
    const key = group.dataset.key
    const mode = pill.dataset.mode
    _pendingChanges[key] = mode
    applySettingsToUI({ ..._serverSettings, ..._pendingChanges })
    updateDirtyBanner()
  })
})

// Save button
document.getElementById('settingsSaveBtn')?.addEventListener('click', async () => {
  if (!settingsIsDirty()) return
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_pendingChanges),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert('Save failed: ' + (err.error ?? 'unknown error'))
      return
    }
    const data = await res.json()
    _serverSettings = { ...data.effective }
    _pendingChanges = {}
    applySettingsToUI(data.effective)
    updateDirtyBanner()
  } catch {
    alert('Save failed: network error')
  }
})

// Discard button
document.getElementById('settingsDiscardBtn')?.addEventListener('click', () => {
  _pendingChanges = {}
  applySettingsToUI(_serverSettings)
  updateDirtyBanner()
})

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
const LOG_BUFFER_MAX = 100
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

// When entering history mode we stash the user's live-mode filter selection
// so we can restore it on the way back. Historical log files only contain
// internal + system events (proxied requests are never written to disk —
// hot-path invariant), so we force those filters on; otherwise the buffer
// loads but every row is filtered out and the user sees an empty table.
let preHistoryFilters = null

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
  if (preHistoryFilters === null) {
    preHistoryFilters = {
      proxy: filterProxy.checked,
      internal: filterInternal.checked,
      system: filterSystem.checked,
    }
  }
  filterProxy.disabled = true
  filterProxy.parentElement.title = 'Live only — proxy requests not stored on disk'
  filterInternal.checked = true
  filterSystem.checked = true
  rebuildLogList()
}

async function loadLive() {
  // Two-source backfill: the file-backed app log captures internal/system
  // events, but proxied requests never touch the file logger (hot-path
  // invariant — see CLAUDE.md). They live in the metrics ring buffer. Merge
  // both sources so the Logs panel shows historical proxy traffic on first
  // render, not just events that arrive over SSE after the page loads.
  const [logsR, recentR] = await Promise.all([
    fetch('/api/logs?limit=100').catch(() => null),
    fetch('/api/metrics/recent?limit=100').catch(() => null),
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
    if (preHistoryFilters) {
      filterProxy.checked = preHistoryFilters.proxy
      filterInternal.checked = preHistoryFilters.internal
      filterSystem.checked = preHistoryFilters.system
      preHistoryFilters = null
    }
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
const MAX_TABLE_ROWS = 500

const tickLabels = []
const tickTimestamps = []
let chartMode = 'live'
let lastHistoryChartRefresh = 0
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

// UTC timestamp with millisecond precision: `YYYY-MM-DD HH:MM:SS.mmm UTC`.
// All timestamps in the UI are UTC, 24-hour format.
function fmtTime(ts) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)} UTC`
  )
}

// Short UTC time for table cells: `HH:MM:SS`.
function fmtTimeShort(ts) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

// Chart-only x-axis formatter (UTC). Outputs `HH:MM:SS`, with a `DD.MM.YYYY ` prefix
// when the date differs from the previous label (or when no previous label is
// given). Keeps tick labels short for live charts while still disambiguating
// day rollovers in long-range views (7d).
function fmtAxisTime(ts, prevTs) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const hhmmss = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  const dateStr = `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
  if (prevTs == null) return hhmmss
  const prev = new Date(prevTs)
  if (isNaN(prev.getTime())) return hhmmss
  return prev.toDateString() === d.toDateString() ? hhmmss : `${dateStr} ${hhmmss}`
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
    ['sparkCompactorBytes1m', '#3fb950', 'compactorBytes1m'],
    ['sparkCompactorBytes5m', '#3fb950', 'compactorBytes5m'],
    ['sparkCompactorBytesLifetime', '#3fb950', 'compactorBytesLifetime'],
    ['sparkCompactorTokensLifetime', '#a371f7', 'compactorTokensLifetime'],
    ['sparkCompactorRatio5m', '#58a6ff', 'compactorRatio5m'],
    ['sparkCompactorBypasses', '#d29922', 'compactorBypasses'],
    ['sparkMetricsCompactorBytes5m', '#3fb950', 'metricsCompactorBytes5m'],
    ['sparkMetricsCompactorRatio5m', '#58a6ff', 'metricsCompactorRatio5m'],
    ['sparkMetricsCompactorFires5m', '#f0b72f', 'metricsCompactorFires5m'],
    ['sparkGuardrailsScanned1m', '#58a6ff', 'guardrailsScanned1m'],
    ['sparkGuardrailsHits1m', '#f0b72f', 'guardrailsHits1m'],
    ['sparkGuardrailsBlockedLifetime', '#f85149', 'guardrailsBlockedLifetime'],
    ['sparkGuardrailsRedactedLifetime', '#a371f7', 'guardrailsRedactedLifetime'],
    ['sparkGuardrailsAlertedLifetime', '#f0b72f', 'guardrailsAlertedLifetime'],
    ['sparkGuardrailsBypassesLifetime', '#d29922', 'guardrailsBypassesLifetime'],
    ['sparkCacheHits1m', '#3fb950', 'cacheHits1m'],
    ['sparkCacheHitRate', '#58a6ff', 'cacheHitRate'],
    ['sparkCacheBytesFromCache', '#3fb950', 'cacheBytesFromCache'],
    ['sparkCacheDedup1m', '#a371f7', 'cacheDedup1m'],
    ['sparkCacheSpendRejects1m', '#d29922', 'cacheSpendRejects1m'],
  ]
  for (const [id, color, key] of specs) {
    const ch = makeSparkline(id, color)
    if (ch) sparkCharts[key] = ch
  }
}
initSparklines()

function pushTick(tick) {
  // In history mode KPI tiles are owned by renderXHistoryKpis — only the
  // instantaneous in-flight counter stays live.
  if (currentHistoryWindow() !== 'live') {
    inFlightPill.textContent = `in-flight: ${tick.inFlight}`
    if (kpiInFlight) kpiInFlight.textContent = fmtNum(tick.inFlight ?? 0)
    return
  }
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

  // Chart series only stream in live mode; history mode owns the arrays.
  if (chartMode !== 'live') return

  const prevTs = tickTimestamps.length ? tickTimestamps[tickTimestamps.length - 1] : null
  tickTimestamps.push(tick.ts)
  tickLabels.push(fmtAxisTime(tick.ts, prevTs))
  rpsSeries.push(w1.rps)
  p95Series.push(w1.p95)
  if (tickLabels.length > MAX_TICKS) {
    tickLabels.shift()
    tickTimestamps.shift()
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
    const r = await fetch('/api/metrics/recent?limit=500')
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
      const tick = JSON.parse(e.data)
      pushTick(tick)
      // History mode: charts don't update via pushTick, so re-fetch on a 30s throttle.
      if (chartMode === 'history') {
        const now = Date.now()
        if (now - lastHistoryChartRefresh >= 30_000) {
          lastHistoryChartRefresh = now
          refreshChartsForWindow().catch(() => {})
        }
      }
      const dashPanel = document.getElementById('dashboardPanel')
      if (!dashPanel?.classList.contains('hidden')) {
        const p95 = tick.windows?.['1m']?.p95 ?? tick.p95 ?? tick.window_1m?.p95 ?? 0
        const rps = tick.windows?.['1m']?.rps ?? tick.rps ?? tick.window_1m?.rps ?? 0
        pushDashPoint(rps, p95)
        if (typeof p95 === 'number') {
          const p95El = document.getElementById('dashKpiP95')
          if (p95El) p95El.textContent = p95 + ' ms'
        }
        const infEl = document.getElementById('dashInFlight')
        if (infEl) infEl.textContent = tick.inFlight ?? '0'
      }
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
      // Keep dashboard live: update recent table and KPI values in real time.
      const dashPanel = document.getElementById('dashboardPanel')
      if (!dashPanel?.classList.contains('hidden')) {
        updateDashRecent(ev)
        // Refresh the cost KPI immediately so "Cost (session)" stays current.
        const costEl = document.getElementById('dashKpiCost')
        if (costEl) costEl.textContent = fmtCost(totalCostSinceBoot)
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

// ─── Metrics-tab Compactor KPIs ──────────────────────────────
// Piggybacks on the 5s metrics refresh interval. Reads the same
// /api/compactor/summary endpoint the Compressors tab consumes.
// When Compactor is disabled at the server level (COMPACTOR_ENABLED=false),
// tiles render `—` to distinguish "off" from "on but zero traffic".
const kpiCompactorBytesSaved5m = document.getElementById('kpiCompactorBytesSaved5m')
const kpiCompactorRatio5m = document.getElementById('kpiCompactorRatio5m')
const kpiCompactorFires5m = document.getElementById('kpiCompactorFires5m')

async function refreshMetricsCompactorKpis() {
  if (!kpiCompactorBytesSaved5m) return
  try {
    const r = await fetch('/api/compactor/summary')
    if (!r.ok) return
    const s = await r.json()
    if (!s.enabled) {
      kpiCompactorBytesSaved5m.textContent = '—'
      kpiCompactorRatio5m.textContent = '—'
      kpiCompactorFires5m.textContent = '—'
      pushSpark('metricsCompactorBytes5m', 0)
      pushSpark('metricsCompactorRatio5m', 0)
      pushSpark('metricsCompactorFires5m', 0)
      return
    }
    const w5 = s.windows['5m']
    const bytesSaved = w5.bytesSaved ?? 0
    const ratio = w5.ratio
    const ratioPct = ratio == null ? 0 : Math.round((1 - ratio) * 100)
    let fires = 0
    for (const name of Object.keys(w5.byCompressor ?? {})) {
      fires += w5.byCompressor[name] ?? 0
    }
    kpiCompactorBytesSaved5m.textContent = fmtBytes(bytesSaved)
    kpiCompactorRatio5m.textContent = ratio == null ? '—' : String(ratioPct)
    kpiCompactorFires5m.textContent = fmtNum(fires)
    pushSpark('metricsCompactorBytes5m', bytesSaved)
    pushSpark('metricsCompactorRatio5m', ratioPct)
    pushSpark('metricsCompactorFires5m', fires)
  } catch {}
}

// ─── Routes filter + history window + CSV (v0.4.0) ──────────
// Multi-upstream support: the routeFilter <select> is populated from
// /api/metrics/routes. Filter applies to recent / models / topCost. The
// historyWindow <select> switches between live (ring buffer) and SQLite-
// backed time ranges. CSV button downloads the current window with filters.

const routeFilterEl = document.getElementById('routeFilter')
const historyWindowEl = document.getElementById('historyWindow')
const csvBtn = document.getElementById('metricsCsvBtn')

const HISTORY_WINDOW_SECONDS = {
  '5m': 5 * 60,
  '10m': 10 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 3600,
  '3h': 3 * 3600,
  '6h': 6 * 3600,
  '12h': 12 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
}

function windowToRange(value) {
  const sec = HISTORY_WINDOW_SECONDS[value]
  if (!sec) return null
  return {
    from: new Date(Date.now() - sec * 1000).toISOString(),
    to: new Date().toISOString(),
  }
}

const HISTORY_WINDOWS = Object.fromEntries(
  Object.keys(HISTORY_WINDOW_SECONDS).map((k) => [k, () => windowToRange(k)]),
)

function currentRouteFilter() {
  return routeFilterEl?.value || ''
}

function currentHistoryWindow() {
  return historyWindowEl?.value || 'live'
}

async function loadRoutesIntoFilter() {
  if (!routeFilterEl) return
  try {
    const r = await fetch('/api/metrics/routes')
    if (!r.ok) return
    const routes = await r.json()
    const current = routeFilterEl.value
    routeFilterEl.innerHTML = '<option value="">All routes</option>'
    for (const route of routes) {
      const opt = document.createElement('option')
      opt.value = route.prefix
      opt.textContent = `${route.prefix} → ${route.upstream}`
      routeFilterEl.appendChild(opt)
    }
    if (current && routes.some((r) => r.prefix === current)) routeFilterEl.value = current
    // Hide the route filter when there's only one route (no meaningful choice).
    routeFilterEl.hidden = routes.length <= 1
  } catch {
    // ignore
  }
}

async function loadHistoryEvents() {
  const win = currentHistoryWindow()
  if (win === 'live') return null
  const range = HISTORY_WINDOWS[win]()
  const params = new URLSearchParams({ from: range.from, to: range.to, limit: '5000' })
  const route = currentRouteFilter()
  if (route) params.set('route', route)
  try {
    const r = await fetch('/api/metrics/history?' + params)
    if (r.status === 503) {
      // Persistence not configured — fall back to the in-memory ring buffer and
      // filter it to the requested time window so the charts still show data.
      const rb = await fetch('/api/metrics/recent?limit=5000')
      if (!rb.ok) return []
      const all = await rb.json()
      const fromMs = new Date(range.from).getTime()
      const toMs = new Date(range.to).getTime()
      return all.filter((ev) => {
        const t = new Date(ev.ts).getTime()
        return t >= fromMs && t <= toMs
      })
    }
    if (!r.ok) return []
    const body = await r.json()
    return body.events ?? []
  } catch {
    return []
  }
}

async function refreshRecentForWindow() {
  const events = await loadHistoryEvents()
  if (events === null) {
    // live mode — fall back to the existing ring-buffer fetch
    loadRecent()
    return
  }
  recentTbody.innerHTML = ''
  // events are newest-first; take most recent MAX_TABLE_ROWS then render oldest-first
  const slice = events.slice(0, MAX_TABLE_ROWS)
  for (let i = slice.length - 1; i >= 0; i--) appendRequest(slice[i])
}

// Bucket size (seconds) chosen so we render ~60–120 points regardless of window
// size — Chart.js stays snappy and the x-axis stays readable.
function bucketSecondsFor(windowSec) {
  if (windowSec <= 30 * 60) return 10 // ≤30m → 10s
  if (windowSec <= 6 * 3600) return 60 // ≤6h → 1min
  if (windowSec <= 24 * 3600) return 5 * 60 // ≤24h → 5min
  return 60 * 60 // 7d → 1h
}

// Build bucketed RPS / p95 / token-rate series from a flat events array
// (newest-first as returned by /api/metrics/history) and push the result into
// the live chart instances. `events` may be empty — in that case we render
// empty buckets so the user sees a blank chart, not stale live data.
function rebuildChartsFromHistory(events, windowKey) {
  const winSec = HISTORY_WINDOW_SECONDS[windowKey]
  if (!winSec) return
  const bucketSec = bucketSecondsFor(winSec)
  const bucketMs = bucketSec * 1000
  const nowMs = Date.now()
  const startMs = nowMs - winSec * 1000
  const numBuckets = Math.max(1, Math.ceil(winSec / bucketSec))

  const counts = new Array(numBuckets).fill(0)
  const durations = Array.from({ length: numBuckets }, () => [])
  const inTok = new Array(numBuckets).fill(0)
  const outTok = new Array(numBuckets).fill(0)
  const toolIn = new Array(numBuckets).fill(0)
  const toolOut = new Array(numBuckets).fill(0)
  const costs = new Array(numBuckets).fill(0)
  const errCounts = new Array(numBuckets).fill(0)
  const bytesInBucket = new Array(numBuckets).fill(0)
  const bytesOutBucket = new Array(numBuckets).fill(0)

  for (const ev of events) {
    const t = new Date(ev.ts).getTime()
    if (isNaN(t)) continue
    const idx = Math.floor((t - startMs) / bucketMs)
    if (idx < 0 || idx >= numBuckets) continue
    counts[idx]++
    if (typeof ev.durationMs === 'number') durations[idx].push(ev.durationMs)
    inTok[idx] += ev.inputTokens ?? 0
    outTok[idx] += ev.outputTokens ?? 0
    costs[idx] += ev.costUsd ?? 0
    if (ev.error || (ev.status != null && ev.status >= 400)) errCounts[idx]++
    bytesInBucket[idx] += ev.bytesIn ?? 0
    bytesOutBucket[idx] += ev.bytesOut ?? 0
  }

  const labels = []
  const rps = []
  const p95 = []
  const tokInRate = []
  const tokToolInRate = []
  const tokOutRate = []
  const tokToolOutRate = []
  let prevTs = null
  for (let i = 0; i < numBuckets; i++) {
    const bucketStartMs = startMs + i * bucketMs
    labels.push(fmtAxisTime(bucketStartMs, prevTs))
    prevTs = bucketStartMs
    rps.push(counts[i] / bucketSec)
    if (durations[i].length) {
      const sorted = durations[i].slice().sort((a, b) => a - b)
      const p = Math.floor(sorted.length * 0.95)
      p95.push(sorted[Math.min(p, sorted.length - 1)])
    } else {
      p95.push(0)
    }
    tokInRate.push(inTok[i] / bucketSec)
    tokToolInRate.push(0) // no per-event tool-token field
    tokOutRate.push(-(outTok[i] / bucketSec))
    tokToolOutRate.push(0)
  }

  // Mutate the shared label array in place so all three charts pick up the
  // change (they all reference the same `tickLabels` instance).
  tickLabels.length = 0
  tickTimestamps.length = 0
  for (let i = 0; i < labels.length; i++) {
    tickLabels.push(labels[i])
    tickTimestamps.push(startMs + i * bucketMs)
  }
  rpsSeries.length = 0
  rpsSeries.push(...rps)
  p95Series.length = 0
  p95Series.push(...p95)
  tokenInSeries.length = 0
  tokenInSeries.push(...tokInRate)
  tokenToolInSeries.length = 0
  tokenToolInSeries.push(...tokToolInRate)
  tokenOutSeries.length = 0
  tokenOutSeries.push(...tokOutRate)
  tokenToolOutSeries.length = 0
  tokenToolOutSeries.push(...tokToolOutRate)

  chartRps.data.datasets[0].data = rpsSeries
  chartRps.update('none')
  chartLat.data.datasets[0].data = p95Series
  chartLat.update('none')
  chartTokens.data.datasets[0].data = tokenInSeries
  chartTokens.data.datasets[1].data = tokenToolInSeries
  chartTokens.data.datasets[2].data = tokenOutSeries
  chartTokens.data.datasets[3].data = tokenToolOutSeries
  const allVals = [...tokenInSeries, ...tokenToolInSeries, ...tokenOutSeries, ...tokenToolOutSeries]
  const peak = Math.max(...allVals.map(Math.abs), 0.001)
  chartTokens.options.scales.y.suggestedMin = -peak
  chartTokens.options.scales.y.suggestedMax = peak
  chartTokens.update('none')

  // Push bucketed history data into KPI sparklines so they match the charts.
  const overwriteSpark = (key, data) => {
    const slice = data.slice(-SPARK_TICKS)
    sparkSeries[key] = slice.slice()
    const ch = sparkCharts[key]
    if (!ch) return
    ch.data.labels = slice.map((_, i) => i)
    ch.data.datasets[0].data = slice
    ch.update('none')
  }
  overwriteSpark('rps', rps)
  overwriteSpark('p95', p95)
  overwriteSpark('tokIn', tokInRate)
  overwriteSpark('tokOut', tokOutRate.map(Math.abs))
  overwriteSpark(
    'costPerMin',
    costs.map((c) => (c / bucketSec) * 60),
  )
  overwriteSpark('bytesIn', bytesInBucket)
  overwriteSpark('bytesOut', bytesOutBucket)
  overwriteSpark(
    'err',
    counts.map((n, i) => (n > 0 ? (errCounts[i] / n) * 100 : 0)),
  )
}

async function refreshChartsForWindow() {
  const win = currentHistoryWindow()
  if (win === 'live') {
    chartMode = 'live'
    // Repopulate charts from the in-memory ring buffer so switching back to
    // Live doesn't show blank charts. Use recent events (~5 min window) to
    // seed the series; the SSE tick stream then appends from here.
    try {
      const rb = await fetch('/api/metrics/recent?limit=5000')
      if (rb.ok) {
        const all = await rb.json()
        const fiveMinAgo = Date.now() - 5 * 60 * 1000
        const recent5m = all.filter((ev) => new Date(ev.ts).getTime() >= fiveMinAgo)
        if (recent5m.length > 0) {
          rebuildChartsFromHistory(recent5m, '5m')
        } else {
          tickLabels.length = 0
          tickTimestamps.length = 0
          rpsSeries.length = 0
          p95Series.length = 0
          tokenInSeries.length = 0
          tokenToolInSeries.length = 0
          tokenOutSeries.length = 0
          tokenToolOutSeries.length = 0
          chartRps.update('none')
          chartLat.update('none')
          chartTokens.update('none')
        }
      }
    } catch {
      // fallback: clear arrays
      tickLabels.length = 0
      tickTimestamps.length = 0
      rpsSeries.length = 0
      p95Series.length = 0
      tokenInSeries.length = 0
      tokenToolInSeries.length = 0
      tokenOutSeries.length = 0
      tokenToolOutSeries.length = 0
      chartRps.update('none')
      chartLat.update('none')
      chartTokens.update('none')
    }
    return
  }
  chartMode = 'history'
  const events = await loadHistoryEvents()
  rebuildChartsFromHistory(events ?? [], win)
  renderMetricsHistoryKpis(events ?? [], win)
}

// ─── Window-aware KPI computation ────────────────────────────
// Aggregates a flat metrics-history events array (from /api/metrics/history)
// into scalars used by all the per-page renderXHistoryKpis helpers.
function computeWindowKpis(events, winSec) {
  const empty = {
    total: 0, rps: 0, p95: 0, p99: 0, errorRate: 0,
    bytesIn: 0, bytesOut: 0, costTotal: 0, costPerMin: 0,
    tokInPerSec: 0, tokOutPerSec: 0, toolCalls: 0,
    avgCost: 0, avgTokens: 0, avgDur: 0, topModel: null,
    compactorBytesSaved: 0, compactorFires: 0, compactorBytesIn: 0,
    guardrailsScanned: 0, guardrailsHits: 0,
    guardrailsBlocked: 0, guardrailsRedacted: 0,
    guardrailsAlerted: 0, guardrailsBypassed: 0,
    cacheHits: 0, cacheDenom: 0, cacheHitRate: 0, cacheBytesFromCache: 0,
  }
  if (!events.length) return empty
  const ws = winSec || 1
  let sumBytesIn = 0, sumBytesOut = 0, sumCost = 0
  let sumTokIn = 0, sumTokOut = 0, sumToolCalls = 0, sumDur = 0
  let errCount = 0
  const durations = [], modelCost = {}
  let compFires = 0, compBytesSaved = 0, compBytesIn = 0
  let grScanned = 0, grHits = 0, grBlocked = 0, grRedacted = 0, grAlerted = 0, grBypassed = 0
  let cacheHits = 0, cacheDenom = 0, cacheBytesFromCache = 0

  for (const ev of events) {
    sumBytesIn += ev.bytesIn ?? 0
    sumBytesOut += ev.bytesOut ?? 0
    sumCost += ev.costUsd ?? 0
    sumTokIn += ev.inputTokens ?? 0
    sumTokOut += ev.outputTokens ?? 0
    sumToolCalls += ev.toolCalls ?? 0
    if (typeof ev.durationMs === 'number') { durations.push(ev.durationMs); sumDur += ev.durationMs }
    if (ev.error || (ev.status != null && ev.status >= 400)) errCount++
    if (ev.model) modelCost[ev.model] = (modelCost[ev.model] ?? 0) + (ev.costUsd ?? 0)
    if (ev.compactorActive) {
      compFires++; compBytesSaved += ev.compactorSavedBytes ?? 0; compBytesIn += ev.bytesIn ?? 0
    }
    if (ev.guardrailsAction) {
      grScanned++; grHits += ev.guardrailsHits ?? 0
      if (ev.guardrailsAction === 'block') grBlocked++
      else if (ev.guardrailsAction === 'redact') grRedacted++
      else if (ev.guardrailsAction === 'alert') grAlerted++
      else if (ev.guardrailsAction === 'bypass') grBypassed++
    }
    if (ev.cacheStatus != null) {
      cacheDenom++
      if (ev.cacheStatus === 'hit') cacheHits++
      cacheBytesFromCache += ev.bytesFromCache ?? 0
    }
  }

  durations.sort((a, b) => a - b)
  const total = events.length
  const p95 = durations.length ? (durations[Math.floor(durations.length * 0.95)] ?? 0) : 0
  const p99 = durations.length ? (durations[Math.floor(durations.length * 0.99)] ?? 0) : 0
  let topModel = null
  for (const [name, cost] of Object.entries(modelCost)) {
    if (!topModel || cost > topModel.cost) topModel = { name, cost }
  }
  return {
    total, rps: total / ws, p95, p99,
    errorRate: total > 0 ? errCount / total : 0,
    bytesIn: sumBytesIn, bytesOut: sumBytesOut,
    costTotal: sumCost, costPerMin: sumCost / (ws / 60),
    tokInPerSec: sumTokIn / ws, tokOutPerSec: sumTokOut / ws,
    toolCalls: sumToolCalls,
    avgCost: total > 0 ? sumCost / total : 0,
    avgTokens: total > 0 ? (sumTokIn + sumTokOut) / total : 0,
    avgDur: durations.length > 0 ? sumDur / durations.length : 0,
    topModel: topModel?.name ?? null,
    compactorBytesSaved: compBytesSaved, compactorFires: compFires, compactorBytesIn: compBytesIn,
    guardrailsScanned: grScanned, guardrailsHits: grHits,
    guardrailsBlocked: grBlocked, guardrailsRedacted: grRedacted,
    guardrailsAlerted: grAlerted, guardrailsBypassed: grBypassed,
    cacheHits, cacheDenom, cacheHitRate: cacheDenom > 0 ? cacheHits / cacheDenom : 0,
    cacheBytesFromCache,
  }
}

function renderMetricsHistoryKpis(events, win) {
  const k = computeWindowKpis(events, HISTORY_WINDOW_SECONDS[win] ?? 60)
  kpiRps.textContent = k.rps.toFixed(2)
  kpiP95.textContent = Math.round(k.p95)
  kpiP99.textContent = Math.round(k.p99)
  kpiErr.textContent = (k.errorRate * 100).toFixed(1)
  kpiTotal.textContent = fmtNum(k.total)
  kpiBytesIn.textContent = fmtBytes(k.bytesIn)
  kpiBytesOut.textContent = fmtBytes(k.bytesOut)
  kpiCostPerMin.textContent = fmtCost(k.costPerMin)
  kpiCostPerHr.textContent = fmtCost(k.costPerMin * 60)
  if (kpiCostPerDay) kpiCostPerDay.textContent = fmtCost(k.costPerMin * 1440)
  if (kpiCostPerMonth) kpiCostPerMonth.textContent = fmtCost(k.costPerMin * 1440 * 30)
  kpiTokensIn.textContent = fmtNum(k.tokInPerSec, 2)
  kpiTokensOut.textContent = fmtNum(k.tokOutPerSec, 2)
  kpiToolCalls.textContent = fmtNum(k.toolCalls)
  kpiCostTotal.textContent = fmtCost(k.costTotal)
  if (kpiAvgCost) kpiAvgCost.textContent = k.total > 0 ? fmtCost(k.avgCost) : '—'
  if (kpiAvgTokens) kpiAvgTokens.textContent = k.total > 0 ? fmtNum(k.avgTokens, 0) : '—'
  if (kpiCacheHit) kpiCacheHit.textContent = k.cacheDenom > 0 ? (k.cacheHitRate * 100).toFixed(1) : '—'
  if (kpiAvgDur) kpiAvgDur.textContent = k.total > 0 ? fmtNum(k.avgDur, 0) : '—'
  if (kpiTopModel) kpiTopModel.textContent = k.topModel ?? '—'
  const compBytesEl = document.getElementById('kpiCompactorBytesSaved5m')
  const compFiresEl = document.getElementById('kpiCompactorFires5m')
  const compRatioEl = document.getElementById('kpiCompactorRatio5m')
  if (compBytesEl) compBytesEl.textContent = fmtBytes(k.compactorBytesSaved)
  if (compFiresEl) compFiresEl.textContent = fmtNum(k.compactorFires)
  if (compRatioEl) {
    const pct = k.compactorBytesIn > 0 ? Math.round((k.compactorBytesSaved / k.compactorBytesIn) * 100) : 0
    compRatioEl.textContent = pct + '%'
  }
}

function renderCompactorHistoryKpis(metricEvents, win) {
  const k = computeWindowKpis(metricEvents, HISTORY_WINDOW_SECONDS[win] ?? 60)
  const el = (id) => document.getElementById(id)
  if (el('compactorBytes1m')) el('compactorBytes1m').textContent = fmtBytes(k.compactorBytesSaved)
  if (el('compactorBytes5m')) el('compactorBytes5m').textContent = fmtBytes(k.compactorBytesSaved)
  if (el('compactorBytesLifetime')) el('compactorBytesLifetime').textContent = fmtBytes(k.compactorBytesSaved)
  if (el('compactorTokensLifetime')) el('compactorTokensLifetime').textContent = Math.floor(k.compactorBytesSaved / 4).toLocaleString()
  if (el('compactorRatio5m')) {
    const r = k.compactorBytesIn > 0 ? k.compactorBytesSaved / k.compactorBytesIn : 0
    el('compactorRatio5m').textContent = k.compactorBytesIn > 0 ? `${Math.round(r * 100)}%` : '—'
  }
  if (el('compactorBypasses')) el('compactorBypasses').textContent = metricEvents.filter(ev => ev.compactorBypass).length
  // Per-compressor table: group fires + bytes from compactorCompressors field
  const byComp = {}
  for (const ev of metricEvents) {
    if (!ev.compactorActive || !ev.compactorCompressors) continue
    for (const name of String(ev.compactorCompressors).split(',').map(s => s.trim()).filter(Boolean)) {
      if (!byComp[name]) byComp[name] = { fires: 0, saved: 0 }
      byComp[name].fires++; byComp[name].saved += ev.compactorSavedBytes ?? 0
    }
  }
  const tbody = document.querySelector('#compactorTable tbody')
  if (tbody) {
    for (const tr of tbody.querySelectorAll('tr')) {
      const code = tr.querySelector('td:first-child code')
      if (!code) continue
      const agg = byComp[code.textContent] ?? { fires: 0, saved: 0 }
      const cells = tr.querySelectorAll('td')
      if (cells[2]) cells[2].textContent = agg.fires
      if (cells[3]) cells[3].textContent = fmtBytes(agg.saved)
      if (cells[4]) cells[4].textContent = '—'
    }
  }
}

function renderGuardrailsHistoryKpis(metricEvents, win) {
  const k = computeWindowKpis(metricEvents, HISTORY_WINDOW_SECONDS[win] ?? 60)
  const el = (id) => document.getElementById(id)
  if (el('guardrailsScanned1m')) el('guardrailsScanned1m').textContent = k.guardrailsScanned
  if (el('guardrailsHits1m')) el('guardrailsHits1m').textContent = k.guardrailsHits
  if (el('guardrailsBlockedLifetime')) el('guardrailsBlockedLifetime').textContent = k.guardrailsBlocked
  if (el('guardrailsRedactedLifetime')) el('guardrailsRedactedLifetime').textContent = k.guardrailsRedacted
  if (el('guardrailsAlertedLifetime')) el('guardrailsAlertedLifetime').textContent = k.guardrailsAlerted
  if (el('guardrailsBypassesLifetime')) el('guardrailsBypassesLifetime').textContent = k.guardrailsBypassed
  // Per-detector table
  const byDet = {}
  for (const ev of metricEvents) {
    if (!ev.guardrailsDetectors) continue
    for (const name of String(ev.guardrailsDetectors).split(',').map(s => s.trim()).filter(Boolean)) {
      if (!byDet[name]) byDet[name] = { fires: 0, hits: 0 }
      byDet[name].fires++; byDet[name].hits += ev.guardrailsHits ?? 0
    }
  }
  const tbody = document.querySelector('#guardrailsTable tbody')
  if (tbody) {
    for (const tr of tbody.querySelectorAll('tr')) {
      const code = tr.querySelector('td:first-child code')
      if (!code) continue
      const agg = byDet[code.textContent] ?? { fires: 0, hits: 0 }
      const cells = tr.querySelectorAll('td')
      if (cells[3]) cells[3].textContent = agg.fires
      if (cells[4]) cells[4].textContent = agg.hits
      if (cells[5]) cells[5].textContent = '—'
    }
  }
}

function renderCacheHistoryKpis(metricEvents, win) {
  const k = computeWindowKpis(metricEvents, HISTORY_WINDOW_SECONDS[win] ?? 60)
  const el = (id) => document.getElementById(id)
  if (el('cacheKpiHits1m')) el('cacheKpiHits1m').textContent = cacheFmt(k.cacheHits)
  if (el('cacheKpiHitRate')) el('cacheKpiHitRate').textContent = cacheFmtPct(k.cacheHitRate)
  if (el('cacheKpiBytesFromCache')) el('cacheKpiBytesFromCache').textContent = cacheFmtBytes(k.cacheBytesFromCache)
  if (el('cacheKpiDedup')) el('cacheKpiDedup').textContent = '—'
  if (el('cacheKpiSpendRejects')) el('cacheKpiSpendRejects').textContent = '—'
  if (el('cacheKpiHitsLifetime')) el('cacheKpiHitsLifetime').textContent = cacheFmt(k.cacheHits)
  if (el('cacheKpiHitRateLifetime')) el('cacheKpiHitRateLifetime').textContent = cacheFmtPct(k.cacheHitRate)
}

function renderDashboardHistoryKpis(metricEvents, win) {
  const k = computeWindowKpis(metricEvents, HISTORY_WINDOW_SECONDS[win] ?? 60)
  document.getElementById('dashKpiRequests').textContent = k.total.toLocaleString()
  document.getElementById('dashKpiCost').textContent = fmtCost(k.costTotal)
  document.getElementById('dashKpiP95').textContent = k.p95 > 0 ? Math.round(k.p95) + ' ms' : '—'
  const bytesSavedCard = document.getElementById('dashKpiBytesSavedCard')
  if (bytesSavedCard && !bytesSavedCard.hidden && k.compactorBytesIn > 0) {
    const pct = Math.round((k.compactorBytesSaved / k.compactorBytesIn) * 100)
    document.getElementById('dashKpiBytesSaved').textContent = pct + '%'
  }
  const cacheKpiCard = document.getElementById('dashKpiCacheCard')
  if (cacheKpiCard && !cacheKpiCard.hidden) {
    document.getElementById('dashKpiCacheHitRate').textContent = cacheFmtPct(k.cacheHitRate)
  }
}

// ─── History-window persistence + cross-tab sync ─────────────
// All [data-history-window] selects share one value, stored in localStorage.
// Changing any one syncs the others and triggers the current tab's refresh.
const HW_STORAGE_KEY = 'airelay_historyWindow'

function applyHistoryWindowToAll(value) {
  for (const sel of document.querySelectorAll('[data-history-window]')) {
    if (sel.value !== value) sel.value = value
  }
}

function updateKpiWindowLabels(win) {
  const disp = win === 'live' ? null : win
  for (const el of document.querySelectorAll('#metricsPanel .kpi-label')) {
    const orig = (el.dataset.origLabel ||= el.textContent)
    el.textContent = disp ? orig.replace(/\(\d+ min\)/g, `(${disp})`) : orig
  }
}

function updateChartWindowLabels(win) {
  const disp = win === 'live' ? null : win
  for (const el of document.querySelectorAll('#metricsPanel .chart-title')) {
    const orig = (el.dataset.origTitle ||= el.textContent)
    el.textContent = disp ? orig.replace(/last \d+ min/g, `last ${disp}`) : orig
  }
}

function syncHistoryWindow(value) {
  localStorage.setItem(HW_STORAGE_KEY, value)
  applyHistoryWindowToAll(value)
  updateKpiWindowLabels(value)
  updateChartWindowLabels(value)
  const tab = location.hash.replace('#', '') || 'dashboard'
  if (tab === 'dashboard') {
    refreshDashboard().catch(() => {})
  } else if (tab === 'metrics') {
    refreshChartsForWindow()
      .then(() => refreshRecentForWindow())
      .catch(() => {})
  } else if (tab === 'compactor') {
    refreshCompactorAuto().catch(() => {})
  } else if (tab === 'guardrails') {
    refreshGuardrailsAuto().catch(() => {})
  } else if (tab === 'cache') {
    refreshCacheAuto().catch(() => {})
  }
}

if (routeFilterEl) {
  routeFilterEl.addEventListener('change', () => {
    refreshRecentForWindow()
    if (chartMode === 'history') refreshChartsForWindow()
  })
}
if (historyWindowEl) {
  historyWindowEl.addEventListener('change', () => syncHistoryWindow(historyWindowEl.value))
}
const dashHistoryWindowEl = document.getElementById('dashHistoryWindow')
if (dashHistoryWindowEl) {
  dashHistoryWindowEl.addEventListener('change', () => syncHistoryWindow(dashHistoryWindowEl.value))
}
if (compactorHistoryWindowEl) {
  compactorHistoryWindowEl.removeEventListener('change', refreshCompactorAuto)
  compactorHistoryWindowEl.addEventListener('change', () =>
    syncHistoryWindow(compactorHistoryWindowEl.value),
  )
}
if (guardrailsHistoryWindowEl) {
  guardrailsHistoryWindowEl.removeEventListener('change', refreshGuardrailsAuto)
  guardrailsHistoryWindowEl.addEventListener('change', () =>
    syncHistoryWindow(guardrailsHistoryWindowEl.value),
  )
}
if (csvBtn) {
  csvBtn.addEventListener('click', () => {
    const params = new URLSearchParams()
    const route = currentRouteFilter()
    if (route) params.set('route', route)
    const win = currentHistoryWindow()
    if (win !== 'live') {
      const range = HISTORY_WINDOWS[win]()
      params.set('from', range.from)
      params.set('to', range.to)
    } else {
      // Live mode CSV — give a 24h window to keep the file scoped.
      const r = HISTORY_WINDOWS['24h']()
      params.set('from', r.from)
      params.set('to', r.to)
    }
    window.location.href = '/api/metrics/export.csv?' + params
  })
}

// ─── Boot ────────────────────────────────────────────────────
// Restore saved history-window choice before activating the initial tab so
// the first refresh uses the persisted window instead of defaulting to Live.
;(function restoreHistoryWindow() {
  const saved = localStorage.getItem(HW_STORAGE_KEY)
  if (saved) applyHistoryWindowToAll(saved)
})()

const HASH_TO_TAB = {
  '#dashboard': 'dashboard',
  '#metrics': 'metrics',
  '#setup': 'setup',
  '#compactor': 'compactor',
  '#guardrails': 'guardrails',
  '#cache': 'cache',
  '#logs': 'logs',
  '#settings': 'settings',
}
const initialTab = HASH_TO_TAB[location.hash] ?? 'dashboard'
activateTab(initialTab)

// Hash navigation (deep links, back/forward, programmatic location.hash) must
// also flip the active panel — clicking tabs only covers one entry path.
window.addEventListener('hashchange', () => {
  const next = HASH_TO_TAB[location.hash]
  if (next) activateTab(next)
})

loadAvailable()
loadLive()
loadHealth()
loadRoutesIntoFilter()
loadRecent()
seedTotalCost().catch(() => {})
loadModels().catch(() => {})
loadTopCost().catch(() => {})
refreshMetricsCompactorKpis().catch(() => {})
connectLogsSSE()
connectMetricsSSE()
setInterval(loadHealth, 10_000)
setInterval(() => {
  loadModels().catch(() => {})
  loadTopCost().catch(() => {})
  refreshMetricsCompactorKpis().catch(() => {})
}, 5000)
// Refresh dashboard KPIs periodically so "session requests" counter stays current.
setInterval(() => {
  const dashPanel = document.getElementById('dashboardPanel')
  if (!dashPanel?.classList.contains('hidden')) refreshDashboard().catch(() => {})
}, 30_000)

// Expose chart instances and chartMode so Playwright specs (under ?testMode=1)
// can verify dropdown-driven label/data changes without poking at internals.
if (TEST_MODE) {
  Object.assign(window, {
    chartRps,
    chartLat,
    chartTokens,
    tickLabels,
    tickTimestamps,
    getChartMode: () => chartMode,
    fmtAxisTime,
  })
}
