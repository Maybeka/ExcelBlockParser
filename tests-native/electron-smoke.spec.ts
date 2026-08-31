import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = process.cwd()
const workbookPath = resolve(root, 'examples', 'test_data.xlsx')

test('opens a real workbook through the Electron host bridge', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-smoke-'))
  const app = await electron.launch({
    args: [resolve(root, 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      ELECTRON_E2E: '1',
      ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
      ELECTRON_E2E_OPEN_PATH: workbookPath,
    },
  })

  try {
    const page = await app.firstWindow()
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(() => localStorage.setItem('excel-block-parser.locale', 'en-US'))
    await page.reload()
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(async () => (window as any).electronAPI.clearRecovery())

    await page.getByRole('button', { name: 'Project actions' }).click()
    await page.getByRole('menuitem', { name: 'Project settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Project settings' })
    await settings.getByRole('button', { name: 'Add workbook source' }).click()
    await expect(page.getByRole('tab', { name: 'test_data.xlsx' })).toBeVisible()
    await settings.getByRole('button', { name: 'Done' }).click()

    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByText('Sheet1', { exact: true })).toBeVisible()
  } finally {
    await app.close()
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
