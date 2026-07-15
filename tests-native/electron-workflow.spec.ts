import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = process.cwd()
const workbookPath = resolve(root, 'examples', 'test_data.xlsx')
const sessionPath = resolve(root, 'examples', 'session.json')

async function launch(extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve(root, 'out', 'main', 'index.js')],
    env: { ...process.env, ELECTRON_E2E: '1', ...extraEnv },
  })
  const page = await app.firstWindow()
  await page.getByText('Excel Block Parser').waitFor()
  return { app, page }
}

test.describe('Electron native workflow', () => {
  test('opens and reads a real workbook through native IPC', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Workspace navigator' }).getByText('Sheet1', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('imports configuration and exports JSON through native IPC', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-e2e-'))
    const output = resolve(directory, 'session.json')
    const { app, page } = await launch({ ELECTRON_E2E_IMPORT_PATH: sessionPath, ELECTRON_E2E_SAVE_PATH: output })
    try {
      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('textbox', { name: 'Block 1' })).toBeVisible()
      await page.getByRole('button', { name: 'Export' }).click()
      await page.getByRole('button', { name: 'Export anyway' }).click()
      await expect.poll(async () => { try { await access(output); return true } catch { return false } }).toBe(true)
      expect(JSON.parse(await readFile(output, 'utf8')).version).toBe(2)
    } finally {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('opens the native preview window through its IPC contract', async () => {
    const { app, page } = await launch()
    try {
      await page.evaluate(async () => {
        const api = (window as any).electronAPI
        await api.setPreviewData('native-preview', {
          blockId: 'native-preview', label: 'Native preview', columns: ['name'], rawColIndices: [0], rawRows: [['Alice']], parsedRows: [{ name: 'Alice' }], headerRows: [0],
        })
      })
      const previewPromise = app.waitForEvent('window')
      await page.evaluate(async () => (window as any).electronAPI.openPreviewWindow('native-preview'))
      const preview = await previewPromise
      await expect(preview.getByRole('cell', { name: 'Alice', exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('handles native dialog cancellation without mutating the workspace', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_CANCEL_DIALOGS: '1' })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByText('Open an XLSX file to get started')).toBeVisible()
      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
