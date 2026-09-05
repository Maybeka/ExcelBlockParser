import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

const root = process.cwd()

export function electronTestEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  Object.assign(env, { ELECTRON_E2E: '1' }, extra)
  // Cursor injects this and makes Electron start as Node. Windows CI must keep the
  // unmodified host environment that previously launched the GUI successfully.
  if (process.platform === 'darwin') delete env.ELECTRON_RUN_AS_NODE
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

export function waitForElectronExit(app: ElectronApplication, timeoutMs = 8000): Promise<void> {
  return waitForProcessExit(app.process(), timeoutMs)
}

function waitForProcessExit(child: ChildProcess | undefined, timeoutMs = 8000): Promise<void> {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron process did not exit')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function closeElectronApp(app: ElectronApplication, page: Page): Promise<void> {
  // The app owns its close confirmation in the renderer. Bypass that prompt
  // during test teardown so every Electron child exits deterministically.
  await page.evaluate(() => (window as any).electronAPI?.confirmCloseWindow?.()).catch(() => undefined)
  const child = app.process()
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Electron close timed out')), 3000)
      }),
    ])
    await waitForProcessExit(child, 3000)
  } catch {
    child?.kill()
    await waitForProcessExit(child, 3000).catch(() => undefined)
  }
}
