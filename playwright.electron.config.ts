import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests-native',
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
