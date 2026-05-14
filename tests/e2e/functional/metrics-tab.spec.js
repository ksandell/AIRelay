import { test, expect } from '@playwright/test'
import { seedProxyCalls } from '../fixtures/seed-traffic.js'

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
})
