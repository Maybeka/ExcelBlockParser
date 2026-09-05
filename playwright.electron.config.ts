import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests-native',
  timeout: 45_000,
  // Electron renderer reloads can transiently lose their file:// document on
  // macOS during test startup. A single retry preserves regression coverage
  // without masking a reproducible native failure.
  retries: 1,
  workers: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
