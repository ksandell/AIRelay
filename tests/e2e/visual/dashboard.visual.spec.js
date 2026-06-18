import { test, expect } from '@playwright/test'
import { seedProxyCalls, seedCompactorTraffic, resetMetrics } from '../fixtures/seed-traffic.js'

test.beforeEach(async ({ baseURL }) => {
  await resetMetrics(baseURL)
})

/**
 * Visual regression. Baselines live under tests/e2e/__screenshots__/ and are
 * OS-pinned (CI uses ubuntu-22.04 — see .github/workflows/e2e.yml). Update
 * baselines with `npm run test:e2e:visual:bless`.
 *
 * Each test:
 *   1. Navigates to a tab with ?testMode=1 (animations off, transitions off)
 *   2. Waits for tab content to settle
 *   3. Takes a full-page screenshot
 */

test.describe('visual: dashboard tabs', () => {
  test('logs tab — empty state', async ({ page }) => {
    await page.goto('/?testMode=1#logs')
    await page.waitForSelector('#logsPanel:not(.hidden)')
    await page.waitForTimeout(300) // let SSE connect indicator settle
    await expect(page).toHaveScreenshot('logs-empty.png', { fullPage: true })
  })

  test('metrics tab — with seeded traffic', async ({ page, baseURL }) => {
    await seedProxyCalls(baseURL, { count: 3 })
    await page.goto('/?testMode=1#metrics')
    await page.waitForSelector('#metricsPanel:not(.hidden)')
    await page.waitForTimeout(800) // let SSE tick deliver aggregate
    await expect(page).toHaveScreenshot('metrics-with-traffic.png', { fullPage: true })
  })

  test('compactor tab — empty state', async ({ page }) => {
    await page.goto('/?testMode=1#compactor')
    await page.waitForSelector('#compactorPanel:not(.hidden)')
    await page.waitForTimeout(300)
    await expect(page).toHaveScreenshot('compactor-empty.png', { fullPage: true })
  })

  test('compactor tab — after compression fires', async ({ page, baseURL }) => {
    await seedCompactorTraffic(baseURL)
    await page.goto('/?testMode=1#compactor')
    await page.locator('#compactorRefreshBtn').click()
    await page.waitForTimeout(500)
    // Mask the recent-events table (timestamps vary between runs).
    await expect(page).toHaveScreenshot('compactor-active.png', {
      fullPage: true,
      mask: [page.locator('#compactorRecentTable')],
    })
  })

  test('setup tab — provider list', async ({ page }) => {
    await page.goto('/?testMode=1#setup')
    await page.waitForSelector('#setupPanel:not(.hidden)')
    await page.waitForTimeout(300)
    await expect(page).toHaveScreenshot('setup.png', { fullPage: true })
  })

  test('dashboard tab — empty state', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.waitForSelector('#dashboardPanel:not(.hidden)')
    await page.waitForTimeout(500) // let SSE connect + KPI zero-state render
    await expect(page).toHaveScreenshot('dashboard-empty.png', { fullPage: true })
  })

  test('settings tab — initial load', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.waitForSelector('#settingsPanel:not(.hidden)')
    await page.waitForTimeout(300) // let settings fetch settle
    await expect(page).toHaveScreenshot('settings-initial.png', { fullPage: true })
  })
})
