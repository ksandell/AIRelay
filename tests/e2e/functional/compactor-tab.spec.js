import { test, expect } from '@playwright/test'
import { seedCompactorTraffic, resetMetrics } from '../fixtures/seed-traffic.js'

test.beforeEach(async ({ baseURL }) => {
  await resetMetrics(baseURL)
})

test.describe('Compactor tab', () => {
  test('renders with master switch state', async ({ page }) => {
    await page.goto('/?testMode=1#compactor')
    await expect(page.locator('#compactorPanel')).toBeVisible()
    await expect(page.locator('#compactorEnabledPill')).toHaveText(/enabled|disabled/i, {
      timeout: 10_000,
    })
  })

  test('shows the 10-compressor catalog', async ({ page }) => {
    await page.goto('/?testMode=1#compactor')
    const rows = page.locator('#compactorTable tbody tr')
    await expect(rows).toHaveCount(10, { timeout: 10_000 })
    // First column lists known compressor names
    const text = await page.locator('#compactorTable tbody').innerText()
    for (const name of [
      'ansi-strip',
      'blankline-collapse',
      'diff-collapse',
      'lockfile-drop',
      'ls-long-shrink',
      'npm-noise-strip',
      'repeat-line-dedupe',
      'stacktrace-dedupe',
      'long-file-elide',
      'base64-truncate',
    ]) {
      expect(text).toContain(name)
    }
  })

  test('seeded traffic increments fires + bytes-saved', async ({ page, baseURL }) => {
    await page.goto('/?testMode=1#compactor')
    await seedCompactorTraffic(baseURL)
    // Force a refresh tick
    await page.locator('#compactorRefreshBtn').click()
    // At least one compressor fires — lifetime bytes saved should be > 0
    await expect(page.locator('#compactorBytesLifetime')).not.toHaveText(/^0 B$/, {
      timeout: 10_000,
    })
  })

  test('summary endpoint exposes the lifetime snapshot', async ({ baseURL }) => {
    await seedCompactorTraffic(baseURL)
    const res = await fetch(`${baseURL}/api/compactor/summary`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.compressors.all.length).toBe(10)
    expect(json.windows['1m']).toBeDefined()
    expect(json.lifetime.requestsCompressed).toBeGreaterThan(0)
  })

  test('X-Compactor: off forces byte-identical passthrough', async ({ baseURL }) => {
    const body = JSON.stringify({
      model: 'gpt-x',
      messages: [{ role: 'tool', content: '\n\n\n\n\nbloat' }],
    })
    const res = await fetch(`${baseURL}/proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Compactor': 'off' },
      body,
    })
    expect(res.status).toBe(200)
    // No applied header should be set when bypassed
    expect(res.headers.get('x-compactor-applied')).toBeNull()
  })
})
