import { defineConfig } from '@playwright/test'

const remoteBaseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '')
const baseURL = remoteBaseURL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  ...(remoteBaseURL
    ? {}
    : {
        webServer: {
          command: 'npm start',
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
})
