import { defineConfig, devices } from '@playwright/test';

/**
 * Orion Platform - Comprehensive Playwright E2E Test Configuration
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run serially to avoid database race conditions on credit balances and test accounts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Deterministic sequential execution across test suites
  timeout: 30000,
  expect: {
    timeout: 8000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
