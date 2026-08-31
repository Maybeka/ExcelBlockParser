import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'

const root = process.cwd()

export function electronTestEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ELECTRON_E2E: '1', ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

export async function launchElectronApp(
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.ELECTRON_E2E_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [resolve(root, 'out', 'main', 'index.js')] }),
    env: electronTestEnv(extraEnv),
  })
  const page = await app.firstWindow()
  return { app, page }
}

export async function closeElectronApp(app: ElectronApplication, page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener('beforeunload', event => {
      event.stopImmediatePropagation()
    }, true)
  }).catch(() => undefined)
  const child = app.process()
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Electron close timed out')), 3000)
      }),
    ])
  } catch {
    child?.kill()
  }
}
