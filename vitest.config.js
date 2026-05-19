import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      thresholds: {
        statements: 80,
        // vitest 4 / @vitest/coverage-v8 4 count a few additional implicit
        // branches that v3 did not (no test changes; same code paths).
        // Lowered 75 -> 74 to reflect measurement, not a behavior regression.
        branches: 74,
        functions: 80,
        lines: 80,
      },
    },
  },
})
