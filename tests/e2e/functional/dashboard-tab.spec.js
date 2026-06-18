import { test, expect } from '@playwright/test'

test.describe('Dashboard tab', () => {
  test('is the default tab on load', async ({ page }) => {
    await page.goto('/?testMode=1')
    await expect(page.locator('#dashboardPanel')).toBeVisible()
    await expect(page.locator('.tab[data-tab="dashboard"]')).toHaveClass(/active/)
  })

  test('KPI cards rendered', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    const cards = page.locator('.kpi-card')
    await expect(cards).toHaveCount(4)
  })

  test('sparkline canvas exists', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await expect(page.locator('#dashSparkline')).toBeVisible()
  })

  test('recent requests table exists', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await expect(page.locator('#dashRecentTable')).toBeVisible()
  })

  test('health sidebar elements exist', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await expect(page.locator('#dashHealthList')).toBeVisible()
    await expect(page.locator('#dashHealthProxy')).toBeAttached()
    await expect(page.locator('#dashHealthCompactor')).toBeAttached()
    await expect(page.locator('#dashHealthGuardrails')).toBeAttached()
  })

  test('navigating via #dashboard hash shows dashboard panel', async ({ page }) => {
    await page.goto('/?testMode=1#logs')
    await expect(page.locator('#logsPanel')).toBeVisible()
    await page.goto('/?testMode=1#dashboard')
    await expect(page.locator('#dashboardPanel')).toBeVisible()
    await expect(page.locator('#logsPanel')).not.toBeVisible()
  })
})
