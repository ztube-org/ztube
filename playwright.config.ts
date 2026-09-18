import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5187',
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
