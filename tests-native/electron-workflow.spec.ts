import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = process.cwd()
const workbookPath = resolve(root, 'examples', 'test_data.xlsx')
const multiSheetWorkbookPath = resolve(root, 'examples', 'multi_sheet.xlsx')
const sessionPath = resolve(root, 'examples', 'session.json')

async function launch(extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.ELECTRON_E2E_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [resolve(root, 'out', 'main', 'index.js')] }),
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
      await page.getByRole('button', { name: 'Show workspace navigation' }).click()
      await expect(page.getByRole('navigation', { name: 'Workspace navigator' }).getByText('Sheet1', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('keeps workspace navigation in sync with Univer sheet activation', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: multiSheetWorkbookPath })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByRole('banner').getByText('multi_sheet.xlsx')).toBeVisible()
      await page.getByRole('button', { name: 'Show workspace navigation' }).click()
      const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })
      const orders = navigator.locator('.workspace-item').filter({ hasText: 'Orders' })
      await expect(orders).toBeVisible()

      await page.getByRole('tab', { name: 'Orders', exact: true }).click()
      await expect(orders).toHaveClass(/is-active/)
    } finally {
      await app.close()
    }
  })

  test('parses an imported workbook configuration and opens the preview', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath, ELECTRON_E2E_IMPORT_PATH: sessionPath })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('textbox', { name: 'Block 1' })).toBeVisible()

      await page.getByRole('button', { name: 'Parse & Preview' }).click()
      await expect(page.getByText('PARSE REVIEW', { exact: true })).toBeVisible()
      await expect(page.getByText('Block 1', { exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Close preview' }).click()
      await expect(page.getByText('PARSE REVIEW', { exact: true })).not.toBeVisible()

      await page.getByRole('button', { name: 'Parse & Preview' }).click()
      await expect(page.getByText('PARSE REVIEW', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('confirms before switching an already open workbook', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByRole('button', { name: 'Open Excel' }).click()
      const dialog = page.getByRole('dialog', { name: 'Switch workbook?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Switch workbook' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('confirms closing and clears the workspace navigator', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByRole('button', { name: 'Show workspace navigation' }).click()
      const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })
      await expect(navigator.getByText('Sheet1', { exact: true })).toBeVisible()

      await page.getByLabel('Close workbook', { exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Close workbook?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByLabel('Close workbook', { exact: true }).click()
      await dialog.getByRole('button', { name: 'Close workbook' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).not.toBeVisible()
      await expect(navigator.getByText('No workbook open', { exact: true })).toBeVisible()
      await expect(navigator.getByText('Open a workbook to see its sheets.', { exact: true })).toBeVisible()
      await expect(navigator.getByText('Sheet1', { exact: true })).not.toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('requires discard confirmation before closing imported unsaved work', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath, ELECTRON_E2E_IMPORT_PATH: sessionPath })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('textbox', { name: 'Block 1' })).toBeVisible()

      await page.getByLabel('Close workbook', { exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByLabel('Close workbook', { exact: true }).click()
      await dialog.getByRole('button', { name: 'Discard' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).not.toBeVisible()
      await expect(page.getByText('Open a workbook to see its sheets.', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('requires discard confirmation before switching imported unsaved work', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath, ELECTRON_E2E_IMPORT_PATH: sessionPath })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('textbox', { name: 'Block 1' })).toBeVisible()

      await page.getByRole('button', { name: 'Open Excel' }).click()
      const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByRole('button', { name: 'Open Excel' }).click()
      await dialog.getByRole('button', { name: 'Discard' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
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

  test('retains an open workbook when native config import fails', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-e2e-'))
    const missingSession = resolve(directory, 'missing-session.json')
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath, ELECTRON_E2E_IMPORT_PATH: missingSession })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('alert')).toContainText('Unable to import config')
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
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
      await expect(preview.getByText('PARSE REVIEW', { exact: true })).toBeVisible()
      await expect(preview.getByText('Source cells', { exact: true })).toBeVisible()
      await expect(preview.getByText('Parsed output', { exact: true })).toBeVisible()
      await expect(preview.getByRole('button', { name: 'Show JSON' })).toBeVisible()
      await expect(preview.getByRole('cell', { name: 'Alice', exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('handles native dialog cancellation without mutating the workspace', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_CANCEL_DIALOGS: '1' })
    try {
      await page.getByRole('button', { name: 'Open Excel' }).click()
      await expect(page.getByText('Select an Excel file, then choose the ranges you want to turn into structured data.', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('persists and clears a valid recovery session through native IPC', async () => {
    const { app, page } = await launch()
    const recovery = JSON.stringify({
      version: 2,
      exportedAt: '2026-07-16T00:00:00.000Z',
      config: { blocks: [], activeBlockId: '', focusMode: 'always-editable', regions: [] },
      data: {},
      blockResults: [],
    })
    try {
      await page.evaluate(async (content) => {
        const api = (window as any).electronAPI
        await api.clearRecovery()
        await api.saveRecovery(content)
      }, recovery)
      await expect.poll(() => page.evaluate(async () => (window as any).electronAPI.loadRecovery())).toBe(recovery)
      await page.evaluate(async () => (window as any).electronAPI.clearRecovery())
      await expect.poll(() => page.evaluate(async () => (window as any).electronAPI.loadRecovery())).toBeNull()
    } finally {
      await app.close()
    }
  })

  test('offers and restores a recovery workspace after restart', async () => {
    const recovery = await readFile(sessionPath, 'utf8')
    const first = await launch()
    try {
      await first.page.evaluate(async (content) => {
        const api = (window as any).electronAPI
        await api.clearRecovery()
        await api.saveRecovery(content)
      }, recovery)
    } finally {
      await first.app.close()
    }

    const second = await launch()
    try {
      const dialog = second.page.getByRole('dialog', { name: 'Recover unsaved workspace?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Recover' }).click()
      await expect(second.page.getByRole('textbox', { name: 'Block 1' })).toBeVisible()
      await second.page.evaluate(async () => (window as any).electronAPI.clearRecovery())
    } finally {
      await second.app.close()
    }
  })

  test('discards a recovery workspace after restart', async () => {
    const recovery = await readFile(sessionPath, 'utf8')
    const first = await launch()
    try {
      await first.page.evaluate(async (content) => {
        const api = (window as any).electronAPI
        await api.clearRecovery()
        await api.saveRecovery(content)
      }, recovery)
    } finally {
      await first.app.close()
    }

    const second = await launch()
    try {
      const dialog = second.page.getByRole('dialog', { name: 'Recover unsaved workspace?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Discard' }).click()
      await expect(second.page.getByText('Select an Excel file, then choose the ranges you want to turn into structured data.', { exact: true })).toBeVisible()
      await expect.poll(() => second.page.evaluate(async () => (window as any).electronAPI.loadRecovery())).toBeNull()
    } finally {
      await second.app.close()
    }
  })
})
