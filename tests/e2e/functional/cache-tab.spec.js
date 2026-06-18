import { test, expect } from '@playwright/test'

test.describe('Cache tab — disabled state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=1#cache')
    await page.waitForSelector('#cachePanel:not(.hidden)', { timeout: 5000 })
  })

  test('Cache tab button exists and activates panel', async ({ page }) => {
    const btn = page.locator('.tab[data-tab="cache"]')
    await expect(btn).toBeVisible()
    await expect(page.locator('#cachePanel')).not.toHaveClass(/hidden/)
  })

  test('shows disabled notice when cache is off', async ({ page }) => {
    const notice = page.locator('#cacheDisabledNotice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('CACHE_ENABLED')
  })

  test('recent events card is hidden when disabled', async ({ page }) => {
    await expect(page.locator('#cacheRecentCard')).toBeHidden()
  })

  test('status label shows Disabled', async ({ page }) => {
    await expect(page.locator('#cacheStatus')).toContainText('Disabled')
  })
})

test.describe('Dashboard tab — cache KPI hidden when disabled', () => {
  test('cache KPI tile is hidden', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.waitForSelector('#dashboardPanel:not(.hidden)', { timeout: 5000 })
    await expect(page.locator('#dashKpiCacheCard')).toBeHidden()
  })

  test('cache health row shows Off', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.waitForSelector('#dashboardPanel:not(.hidden)', { timeout: 5000 })
    await expect(page.locator('#dashHealthCacheLabel')).toContainText('Off')
  })
})
