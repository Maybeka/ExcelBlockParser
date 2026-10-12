import { defineConfig } from '@playwright/test'

const localTestHosts = '127.0.0.1,localhost,::1'
const noProxy = [process.env.NO_PROXY, process.env.no_proxy, localTestHosts]
  .filter(Boolean)
  .join(',')

process.env.NO_PROXY = noProxy
process.env.no_proxy = noProxy

const requestedWorkers = process.env.PLAYWRIGHT_WORKERS
if (requestedWorkers && !/^[1-9]\d*$/.test(requestedWorkers)) throw new Error('PLAYWRIGHT_WORKERS must be a positive integer')

export default defineConfig({
  testDir: './tests',
  workers: requestedWorkers ? Number(requestedWorkers) : undefined,
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1400, height: 900 },
    actionTimeout: 10000,
    launchOptions: process.env.CI ? { args: ['--disable-dev-shm-usage'] } : undefined,
  },
  webServer: {
    command: 'npm run dev:vite -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
