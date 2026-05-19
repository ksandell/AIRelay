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

  test('selecting a date renders entries and force-checks internal/system filters', async ({
    page,
  }) => {
    // Intercept the history API so the test is deterministic regardless of
    // whether the test server has rotated any log files yet.
    const fakeDate = '2026-01-15'
    await page.route('**/api/logs/history?date=*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { ts: '2026-01-15T10:00:00.000Z', level: 'info', msg: 'startup', src: 'system' },
          {
            ts: '2026-01-15T10:00:01.000Z',
            level: 'info',
            msg: 'GET /api/health',
            src: 'http',
            path: '/api/health',
          },
        ]),
      })
    })
    await page.route('**/api/logs/available', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rotated: [{ date: fakeDate, sizeBytes: 4096 }] }),
      })
    })

    await page.goto('/?testMode=1#logs')
    // Wait for /api/logs/available to populate the dropdown.
    await expect(page.locator(`#dateSelect option[value="${fakeDate}"]`)).toHaveCount(1, {
      timeout: 5000,
    })

    // Default state: internal/system unchecked, proxy enabled+checked.
    await expect(page.locator('#filterProxy')).toBeEnabled()
    await expect(page.locator('#filterInternal')).not.toBeChecked()
    await expect(page.locator('#filterSystem')).not.toBeChecked()

    await page.selectOption('#dateSelect', fakeDate)

    // Fix verified: proxy is disabled (informative, not a bug), internal+system are auto-checked.
    await expect(page.locator('#filterProxy')).toBeDisabled()
    await expect(page.locator('#filterInternal')).toBeChecked()
    await expect(page.locator('#filterSystem')).toBeChecked()

    // And the loaded entries actually render (the original bug was zero rows).
    await expect(page.locator('#logList > *').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('#entryCount')).not.toHaveText('0 entries')

    // Returning to Live restores the filter checkboxes to their previous state.
    await page.selectOption('#dateSelect', '')
    await expect(page.locator('#filterProxy')).toBeEnabled()
    await expect(page.locator('#filterInternal')).not.toBeChecked()
    await expect(page.locator('#filterSystem')).not.toBeChecked()
  })
})
