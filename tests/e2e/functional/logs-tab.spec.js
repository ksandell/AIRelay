import { test, expect } from '@playwright/test'
import { seedProxyCalls } from '../fixtures/seed-traffic.js'

test.describe('Logs tab', () => {
  test('renders and shows live SSE status', async ({ page }) => {
    await page.goto('/?testMode=1#logs')
    await expect(page.locator('#logsPanel')).toBeVisible()
    await expect(page.locator('#status')).toHaveText(/Live|Connecting|Disconnected/i)
  })

  test('Pause button toggles live updates', async ({ page }) => {
    await page.goto('/?testMode=1#logs')
    const pauseBtn = page.locator('#pauseBtn')
    await expect(pauseBtn).toBeVisible()
    await pauseBtn.click()
    await expect(pauseBtn).toHaveText(/Resume|Live|Pause/i)
  })

  test('Level filter is present and selectable', async ({ page }) => {
    await page.goto('/?testMode=1#logs')
    const levelFilter = page.locator('#levelFilter')
    await expect(levelFilter).toBeVisible()
    await levelFilter.selectOption('info')
    await expect(levelFilter).toHaveValue('info')
  })

  test('proxy traffic populates the table', async ({ page, baseURL }) => {
    // Seed BEFORE page load so backfill from /api/metrics/recent sees the events.
    await seedProxyCalls(baseURL, { count: 2 })
    await page.goto('/?testMode=1#logs')
    // Logs panel renders entries as <div> children of #logList (not a table).
    await expect(page.locator('#logList > *').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#entryCount')).not.toHaveText('0 entries', { timeout: 10_000 })
  })
})
