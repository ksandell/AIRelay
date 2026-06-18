/* eslint-disable no-undef -- page.evaluate callbacks run in the browser, where `window` is defined. */
import { test, expect } from '@playwright/test'
import { seedProxyCalls } from '../fixtures/seed-traffic.js'

// Verifies that:
//   1. The #historyWindow dropdown actually drives the charts (not just the
//      recent table) — selecting any non-live value flips chartMode to
//      'history' and replaces the label/data arrays.
//   2. New finer-grained windows (10m, 15m, 30m) exist as options.
//   3. X-axis labels are formatted HH:MM:SS (with DD.MM.YYYY only on day
//      rollover) instead of the full ISO-ish `YYYY-MM-DD HH:MM:SS.mmm`.
//   4. Switching back to 'live' restores live tick behavior.
//
// METRICS_DB_PATH is not set in the e2e test server, so /api/metrics/history
// returns 503; the client treats that as an empty event list and still
// rebuilds chart buckets — which is exactly what we want to assert.

const WINDOWS = ['5m', '10m', '15m', '30m', '1h', '3h', '6h', '12h', '24h', '7d']
const TIME_ONLY_RE = /^\d{2}:\d{2}:\d{2}$/
const DATE_TIME_RE = /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/

test.describe('History window dropdown', () => {
  test('dropdown exposes 5m/10m/15m/30m/1h/.../7d', async ({ page }) => {
    await page.goto('/?testMode=1#metrics')
    const values = await page.$$eval('#historyWindow option', (opts) => opts.map((o) => o.value))
    expect(values).toEqual(['live', ...WINDOWS])
  })

  test('selecting each window rebuilds chart labels with HH:MM:SS format', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/?testMode=1#metrics')
    await expect(page.locator('#metricsPanel canvas').first()).toBeVisible({ timeout: 10_000 })
    await seedProxyCalls(baseURL, { count: 3 })

    for (const win of WINDOWS) {
      await page.selectOption('#historyWindow', win)
      // Wait for the change handler to flip chartMode and rebuild labels.
      await expect
        .poll(() => page.evaluate(() => window.getChartMode()), { timeout: 5000 })
        .toBe('history')

      const labels = await page.evaluate(() => window.chartRps.data.labels.slice())
      expect(labels.length).toBeGreaterThan(0)

      // Every label must match either HH:MM:SS or DD.MM.YYYY HH:MM:SS.
      const bad = labels.filter((l) => !TIME_ONLY_RE.test(l) && !DATE_TIME_RE.test(l))
      expect(bad, `window=${win} has malformed labels: ${bad.slice(0, 3).join(', ')}`).toEqual([])

      // The 7d view should produce at least one date-prefixed label
      // (bucket-zero label always gets the date since prevTs is null).
      if (win === '7d') {
        const dated = labels.filter((l) => DATE_TIME_RE.test(l))
        expect(dated.length).toBeGreaterThan(0)
      }

      const data = await page.evaluate(() => window.chartRps.data.datasets[0].data.slice())
      expect(data.length).toBe(labels.length)
    }
  })

  test('returning to live resumes SSE-driven ticks', async ({ page, baseURL }) => {
    await page.goto('/?testMode=1#metrics')
    await page.selectOption('#historyWindow', '5m')
    await expect
      .poll(() => page.evaluate(() => window.getChartMode()), { timeout: 5000 })
      .toBe('history')

    await page.selectOption('#historyWindow', 'live')
    await expect
      .poll(() => page.evaluate(() => window.getChartMode()), { timeout: 5000 })
      .toBe('live')

    // Seed traffic and wait for the SSE tick stream to populate at least one
    // label (testMode uses a 500 ms tick interval).
    await seedProxyCalls(baseURL, { count: 2 })
    await expect
      .poll(() => page.evaluate(() => window.chartRps.data.labels.length), { timeout: 15_000 })
      .toBeGreaterThan(0)

    const labels = await page.evaluate(() => window.chartRps.data.labels.slice())
    const bad = labels.filter((l) => !TIME_ONLY_RE.test(l) && !DATE_TIME_RE.test(l))
    expect(bad).toEqual([])
  })

  test('fmtAxisTime: HH:MM:SS when prev same day, dated when different day', async ({ page }) => {
    await page.goto('/?testMode=1#metrics')
    const result = await page.evaluate(() => {
      const t1 = new Date('2026-01-15T08:30:45Z').getTime()
      const t2 = new Date('2026-01-15T08:30:50Z').getTime()
      const t3 = new Date('2026-01-16T00:00:01Z').getTime()
      return {
        first: window.fmtAxisTime(t1, null),
        sameDay: window.fmtAxisTime(t2, t1),
        rollover: window.fmtAxisTime(t3, t2),
      }
    })
    expect(result.first).toMatch(TIME_ONLY_RE)
    expect(result.sameDay).toMatch(TIME_ONLY_RE)
    expect(result.rollover).toMatch(DATE_TIME_RE)
  })
})
