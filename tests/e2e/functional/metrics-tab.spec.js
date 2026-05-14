import { test, expect } from '@playwright/test'
import { seedProxyCalls, seedCompactorTraffic, resetMetrics } from '../fixtures/seed-traffic.js'

test.describe('Metrics tab', () => {
  test('renders KPIs and charts', async ({ page }) => {
    await page.goto('/?testMode=1#metrics')
    await expect(page.locator('#metricsPanel')).toBeVisible()
    // KPI sections present
    await expect(page.locator('.kpis').first()).toBeVisible()
    // Chart canvases exist
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 })
  })

  test('in-flight pill updates and seeded traffic flows into recent table', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/?testMode=1#metrics')
    await expect(page.locator('#inFlightPill')).toBeVisible()
    await seedProxyCalls(baseURL, { count: 3 })
    // The tick interval is 500 ms in test mode; recent table should refresh shortly.
    await expect(page.locator('#recentTable tbody tr').first()).toBeVisible({ timeout: 10_000 })
  })

  test('models endpoint returns aggregated data after traffic', async ({ baseURL }) => {
    await seedProxyCalls(baseURL, { count: 2 })
    const res = await fetch(`${baseURL}/api/metrics/models`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
  })

  test('renders Compactor KPIs (bytes saved, ratio, fires)', async ({ page, baseURL }) => {
    await resetMetrics(baseURL)
    await page.goto('/?testMode=1#metrics')
    // Tiles must exist regardless of Compactor state.
    await expect(page.locator('[data-testid="compactor-bytes-5m"]')).toBeVisible()
    await expect(page.locator('[data-testid="compactor-ratio-5m"]')).toBeVisible()
    await expect(page.locator('[data-testid="compactor-fires-5m"]')).toBeVisible()

    // Probe whether Compactor is enabled in this test run.
    const summary = await (await fetch(`${baseURL}/api/compactor/summary`)).json()
    if (!summary.enabled) {
      // Disabled: all three tiles should show the em-dash placeholder.
      await expect(page.locator('[data-testid="compactor-bytes-5m"]')).toHaveText('—', {
        timeout: 10_000,
      })
      await expect(page.locator('[data-testid="compactor-ratio-5m"]')).toHaveText('—')
      await expect(page.locator('[data-testid="compactor-fires-5m"]')).toHaveText('—')
      return
    }

    await seedCompactorTraffic(baseURL)
    // Wait for the 5s poll to pick up the seeded fires.
    await expect(page.locator('[data-testid="compactor-bytes-5m"]')).not.toHaveText(/^(—|0 B)$/, {
      timeout: 15_000,
    })
    await expect(page.locator('[data-testid="compactor-fires-5m"]')).not.toHaveText(/^(—|0)$/, {
      timeout: 15_000,
    })
  })

  test('Compactor KPI tiles show — when COMPACTOR_ENABLED is false', async ({ page, baseURL }) => {
    // Test infrastructure does not toggle env per-test (server is shared across
    // the run). When Compactor is enabled this assertion is moot, so we
    // probe the live state and skip otherwise — the previous test covers the
    // enabled path. This documents the spec intent without requiring a
    // server-restart harness.
    const summary = await (await fetch(`${baseURL}/api/compactor/summary`)).json()
    test.skip(
      summary.enabled,
      'Compactor is enabled in this test run — disabled-state covered statically by the render check.',
    )
    await page.goto('/?testMode=1#metrics')
    await expect(page.locator('[data-testid="compactor-bytes-5m"]')).toHaveText('—', {
      timeout: 10_000,
    })
    await expect(page.locator('[data-testid="compactor-ratio-5m"]')).toHaveText('—')
    await expect(page.locator('[data-testid="compactor-fires-5m"]')).toHaveText('—')
  })
})
