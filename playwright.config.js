import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for AIRelay E2E.
 *
 * Two projects:
 *   - functional: browser-driven flows (Setup tab guided generation, tab
 *     switching, KPI updates after seeded traffic, Compactor on/off).
 *   - visual: pixel-snapshot regression against committed baselines under
 *     tests/e2e/__screenshots__. OS-pinned (Linux baselines in CI).
 *
 * Server: in-process Node bootstrap (tests/e2e/fixtures/test-server.js) that
 * spawns a fake LLM upstream + AIRelay on port 3100. No Docker required.
 */

const PORT = parseInt(process.env.E2E_PORT ?? '3100', 10)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/fixtures/**'],
  fullyParallel: false, // shared in-process server has shared state (metrics ring buffer)
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 5000,
    // Allow tiny rendering differences across runs; OS-pinned baselines.
    toHaveScreenshot: { maxDiffPixelRatio: 0.03, animations: 'disabled' },
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 5000,
  },
  webServer: {
    command: 'node tests/e2e/fixtures/test-server.js',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    // Pin the cache OFF for E2E so the suite is deterministic regardless of the
    // developer's local .env (the dev stack enables CACHE_ENABLED). dotenv does
    // not override env vars already set here, so these win over .env.
    env: { PORT: String(PORT), CACHE_ENABLED: 'false', CACHE_REDIS_URL: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'functional',
      testDir: './tests/e2e/functional',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testDir: './tests/e2e/visual',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
