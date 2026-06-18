import { test, expect } from '@playwright/test'

test.describe('Settings tab', () => {
  test('Settings tab button visible and clickable', async ({ page }) => {
    await page.goto('/?testMode=1')
    const settingsTab = page.locator('.tab[data-tab="settings"]')
    await expect(settingsTab).toBeVisible()
    await settingsTab.click()
    await expect(page.locator('#settingsPanel')).toBeVisible()
  })

  test('clicking Settings tab shows settings panel', async ({ page }) => {
    await page.goto('/?testMode=1#dashboard')
    await page.locator('.tab[data-tab="settings"]').click()
    await expect(page.locator('#settingsPanel')).toBeVisible()
    await expect(page.locator('#dashboardPanel')).not.toBeVisible()
  })

  test('Compactors section exists', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await expect(page.locator('#settingCompactorEnabled')).toBeAttached()
    await expect(page.locator('#compactorSubsection')).toBeAttached()
    await expect(page.locator('#compressorGrid')).toBeVisible()
  })

  test('Guardrails section exists', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await expect(page.locator('#settingGuardrailsEnabled')).toBeAttached()
    await expect(page.locator('#guardrailsSubsection')).toBeAttached()
    await expect(page.locator('#detectorGrid')).toBeVisible()
  })

  test('settings footer text present', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await expect(page.locator('.settings-footer')).toContainText('No restart required')
  })

  test('toggling a checkbox marks settings as dirty', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    // Toggle the Compactors master switch to trigger dirty state
    await page.locator('#settingCompactorEnabled').click()
    await expect(page.locator('#settingsDirtyPill')).toBeVisible()
  })

  test('Discard button clears the dirty state', async ({ page }) => {
    await page.goto('/?testMode=1#settings')
    await page.locator('#settingCompactorEnabled').click()
    await expect(page.locator('#settingsDiscardBtn')).toBeVisible()
    await page.locator('#settingsDiscardBtn').click()
    await expect(page.locator('#settingsDirtyPill')).not.toBeVisible()
  })

  test('Save button triggers POST /api/settings', async ({ page }) => {
    let savedBody = null
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'POST') {
        savedBody = route.request().postDataJSON()
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      } else {
        await route.continue()
      }
    })

    await page.goto('/?testMode=1#settings')
    // Make a change to enable the Save button
    await page.locator('#settingCompactorEnabled').click()
    await expect(page.locator('#settingsSaveBtn')).toBeVisible()
    await page.locator('#settingsSaveBtn').click()
    // POST should have been intercepted
    expect(savedBody).not.toBeNull()
  })
})
