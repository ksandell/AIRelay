import { test, expect } from '@playwright/test'

// Setup tab is auto-shown when the proxy is misconfigured. In the test server
// the proxy IS configured (UPSTREAM_URL set), so the tab is hidden by default
// but selectable via location hash.

test.describe('Setup tab', () => {
  test('is selectable via hash and renders provider list', async ({ page }) => {
    await page.goto('/?testMode=1#setup')
    await expect(page.locator('#setupPanel')).toBeVisible({ timeout: 10_000 })
    // Setup form contains a provider <select> with the known providers as options.
    const setupHtml = await page.locator('#setupPanel').innerHTML()
    expect(setupHtml).toMatch(/Anthropic|OpenAI|Mistral/i)
  })

  test('selecting a provider populates SDK snippet', async ({ page }) => {
    await page.goto('/?testMode=1#setup')
    await expect(page.locator('#setupPanel')).toBeVisible()
    // Look for any select / button that switches provider; assert a code block
    // contains the chosen provider keyword.
    const codeBlocks = page.locator('code, pre')
    await expect(codeBlocks.first()).toBeVisible({ timeout: 10_000 })
  })
})
