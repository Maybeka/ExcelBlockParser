import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { access, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeElectronApp, launchElectronApp, waitForElectronExit } from './electronLaunch'

const root = process.cwd()
const workbookPath = resolve(root, 'examples', 'test_data.xlsx')
const multiSheetWorkbookPath = resolve(root, 'examples', 'multi_sheet.xlsx')
const projectFixturePath = resolve(root, 'examples', 'project.json')
const completeProjectV3FixturePath = resolve(root, 'src', 'renderer', '__tests__', 'fixtures', 'project-v3-complete.json')
let userDataDirectory = ''

async function launch(extraEnv: Record<string, string> = {}, preserveRecovery = false): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ...extraEnv,
  })
  await page.getByText('Excel Block Parser').waitFor()
  await page.evaluate(() => localStorage.setItem('excel-block-parser.locale', 'en-US'))
  await page.reload()
  await page.getByText('Excel Block Parser').waitFor()
  if (!preserveRecovery) {
    const recoveryDialog = page.getByRole('dialog', { name: 'Recover unsaved workspace?' })
    await page.waitForTimeout(150)
    if (await recoveryDialog.isVisible().catch(() => false)) {
      await recoveryDialog.getByRole('button', { name: 'Discard' }).click()
    }
    await page.evaluate(async () => (window as any).electronAPI.clearRecovery())
  }
  return { app, page }
}

async function importIntoOpenWorkbook(page: Page): Promise<void> {
  await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
  await page.getByRole('button', { name: 'Open Project' }).click()
  const replaceDialog = page.getByRole('dialog', { name: 'Open another project?' })
  const importedBlock = page.getByRole('textbox', { name: 'block_1' })
  const settings = page.getByRole('dialog', { name: 'Project settings' })
  await expect.poll(async () => {
    if (await replaceDialog.isVisible().catch(() => false)) return 'replace'
    if (await importedBlock.isVisible().catch(() => false)) return 'imported'
    if (await settings.isVisible().catch(() => false)) return 'settings'
    return null
  }).not.toBeNull()
  if (await replaceDialog.isVisible().catch(() => false)) {
    await replaceDialog.getByRole('button', { name: 'Open Project' }).click()
  }
  await expect.poll(async () => (
    await importedBlock.isVisible().catch(() => false)
    || await settings.isVisible().catch(() => false)
  )).toBe(true)
}

async function closePreview(page: Page): Promise<void> {
  const closeButton = page.getByRole('button', { name: 'Close preview' })
  await closeButton.click()
  await expect(closeButton).toBeHidden()
}

async function openProjectSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: 'Project settings' }).click()
}

async function addWorkbookSource(page: Page, fileName: string): Promise<void> {
  await openProjectSettings(page)
  const settings = page.getByRole('dialog', { name: 'Project settings' })
  await settings.getByRole('button', { name: 'Add workbook source' }).click()
  await expect(page.getByRole('tab', { name: fileName })).toBeVisible()
  await settings.getByRole('button', { name: 'Done' }).click()
}

async function ensurePreviewOpen(page: Page): Promise<void> {
  const previewHeading = page.getByText('PARSE REVIEW', { exact: true })
  const parseButton = page.getByRole('button', { name: 'Run & Preview' })
  await page.waitForTimeout(500)
  if (!await previewHeading.isVisible().catch(() => false)) {
    await expect(parseButton).toBeEnabled()
    await parseButton.click()
  }
  await expect(previewHeading).toBeVisible()
}

test.describe('Electron native workflow', () => {
  test.beforeEach(async () => {
    userDataDirectory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-e2e-user-data-'))
  })

  test.afterEach(async () => {
    if (userDataDirectory) await rm(userDataDirectory, { recursive: true, force: true })
    userDataDirectory = ''
  })

  test('opens and reads a real workbook through native IPC', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
      await page.getByRole('button', { name: 'Show workspace navigation' }).click()
      await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByText('Sheet1', { exact: true })).toBeVisible()
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('keeps workspace navigation in sync with Univer sheet activation', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: multiSheetWorkbookPath })
    try {
      await addWorkbookSource(page, 'multi_sheet.xlsx')
      await expect(page.getByRole('banner').getByText('multi_sheet.xlsx')).toBeVisible()
      await page.getByRole('button', { name: 'Show workspace navigation' }).click()
      const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })
      const orders = navigator.locator('.workspace-item').filter({ hasText: 'Orders' })
      await expect(orders).toBeVisible()

      await page.getByRole('tab', { name: 'Orders', exact: true }).click()
      await expect(orders).toHaveClass(/is-active/)
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('parses an imported workbook configuration and opens the preview', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath, ELECTRON_E2E_IMPORT_PATH: projectFixturePath })
    try {
      await importIntoOpenWorkbook(page)
      const settings = page.getByRole('dialog', { name: 'Project settings' })
      await settings.getByRole('button', { name: 'Reassign' }).click()
      await expect(page.getByRole('tab', { name: 'test_data.xlsx' })).toBeVisible()
      await settings.getByRole('button', { name: 'Done' }).click()

      await ensurePreviewOpen(page)
      await expect(page.getByText('block_1', { exact: true })).toBeVisible()

      await closePreview(page)
      await expect(page.getByText('PARSE REVIEW', { exact: true })).not.toBeVisible()

      await page.getByRole('button', { name: 'Run & Preview' }).click()
      await expect(page.getByText('PARSE REVIEW', { exact: true })).toBeVisible()
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('top workbook tabs switch workbooks but do not expose a close action', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await expect(page.getByRole('tab', { name: 'test_data.xlsx' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Close test_data.xlsx' })).toHaveCount(0)
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('removes a workbook source only from project settings after confirmation', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await openProjectSettings(page)
      const settings = page.getByRole('dialog', { name: 'Project settings' })
      await settings.getByRole('button', { name: 'Remove' }).click()
      const confirmation = page.getByRole('dialog', { name: 'Remove project workbook?' })
      await confirmation.getByRole('button', { name: 'Remove source' }).click()
      await expect(settings.getByText('test_data.xlsx', { exact: true })).toBeHidden()
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('closes the current project through the explicit project lifecycle control', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await page.getByRole('button', { name: 'Project actions' }).click()
      await page.getByRole('menuitem', { name: 'Close Project' }).click()
      const confirmation = page.getByRole('dialog', { name: 'Close project?' })
      await expect(confirmation.getByText('Unsaved project changes will be discarded.')).toBeVisible()
      await confirmation.getByRole('button', { name: 'Discard and close' }).click()
      await expect(confirmation).toBeHidden()
      await expect(page.getByRole('tab', { name: 'test_data.xlsx' })).toBeHidden()
      await page.getByRole('button', { name: 'Project actions' }).click()
      await expect(page.getByRole('menuitem', { name: 'Close Project' })).toHaveAttribute('aria-disabled', 'true')
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('confirms before closing the application with unsaved project changes', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await page.locator('.window-control-close').click()
      const confirmation = page.getByRole('dialog', { name: 'Close application?' })
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmation).toBeHidden()
      await expect(page.getByText('Excel Block Parser')).toBeVisible()
      await page.locator('.window-control-close').click()
      await expect(confirmation).toBeVisible()
      const closed = page.waitForEvent('close')
      await confirmation.getByRole('button', { name: 'Discard and close' }).click().catch(() => undefined)
      await closed
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('quits after discard and still prompts when a new launch recovers the workspace', async () => {
    const first = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await addWorkbookSource(first.page, 'test_data.xlsx')
      await expect.poll(async () => {
        const result = await first.page.evaluate(async () => (window as any).electronAPI.loadRecovery())
        return result?.status === 'ok' && Boolean(result.value)
      }).toBe(true)

      await first.page.locator('.window-control-close').click()
      const confirmation = first.page.getByRole('dialog', { name: 'Close application?' })
      await expect(confirmation).toBeVisible()
      const closed = first.page.waitForEvent('close')
      const exited = waitForElectronExit(first.app)
      await confirmation.getByRole('button', { name: 'Discard and close' }).click().catch(() => undefined)
      await closed
      await exited
    } catch (error) {
      await closeElectronApp(first.app, first.page)
      throw error
    }

    const second = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath }, true)
    try {
      const recoveryDialog = second.page.getByRole('dialog', { name: 'Recover unsaved workspace?' })
      await expect(recoveryDialog).toBeVisible()
      await recoveryDialog.getByRole('button', { name: 'Recover' }).click()
      const settings = second.page.getByRole('dialog', { name: 'Project settings' })
      await second.page.waitForTimeout(150)
      if (await settings.isVisible().catch(() => false)) {
        await settings.getByRole('button', { name: 'Done' }).click()
      }

      await second.page.locator('.window-control-close').click()
      const secondConfirmation = second.page.getByRole('dialog', { name: 'Close application?' })
      await expect(secondConfirmation).toBeVisible()
      await secondConfirmation.getByRole('button', { name: 'Cancel' }).click()
    } finally {
      await closeElectronApp(second.app, second.page)
    }
  })

  test('confirms before opening a new project file', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath, ELECTRON_E2E_IMPORT_PATH: projectFixturePath })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await page.getByRole('button', { name: 'Open Project' }).click()
      const confirmation = page.getByRole('dialog', { name: 'Open another project?' })
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmation).toBeHidden()
      await expect(page.getByRole('tab', { name: 'test_data.xlsx' })).toBeVisible()

      await page.getByRole('button', { name: 'Open Project' }).click()
      await confirmation.getByRole('button', { name: 'Discard and open' }).click()
      await expect(page.getByRole('dialog', { name: 'Project settings' })).toBeVisible()
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('creates a new project from the project actions menu', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await page.getByRole('button', { name: 'Project actions' }).click()
      await page.getByRole('menuitem', { name: 'New Project' }).click()
      const confirmation = page.getByRole('dialog', { name: 'Create a new project?' })
      await confirmation.getByRole('button', { name: 'New Project' }).click()

      const settings = page.getByRole('dialog', { name: 'Project settings' })
      await expect(settings).toBeVisible()
      await expect(settings.getByText('test_data.xlsx', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: 'test_data.xlsx' })).toHaveCount(0)
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('imports configuration and saves the project through native IPC', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-e2e-'))
    const output = resolve(directory, 'project.json')
    const { app, page } = await launch({ ELECTRON_E2E_IMPORT_PATH: projectFixturePath, ELECTRON_E2E_SAVE_PATH: output })
    try {
      await page.getByRole('button', { name: 'Open Project' }).click()
      const settings = page.getByRole('dialog', { name: 'Project settings' })
      await expect(settings.getByText('Unavailable', { exact: true })).toBeVisible()
      await settings.getByRole('button', { name: 'Done' }).click()
      await page.getByRole('button', { name: 'Project actions' }).click()
      await page.getByRole('menuitem', { name: /Save Project As/ }).click()
      await expect.poll(async () => { try { await access(output); return true } catch { return false } }).toBe(true)
      expect(JSON.parse(await readFile(output, 'utf8')).version).toBe(3)
    } finally {
      await closeElectronApp(app, page)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('opens and saves the complete Project v3 golden fixture through native IPC', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-v3-e2e-'))
    const output = resolve(directory, 'Complete v3 fixture.json')
    const { app, page } = await launch({
      ELECTRON_E2E_IMPORT_PATH: completeProjectV3FixturePath,
      ELECTRON_E2E_SAVE_PATH: output,
    })
    try {
      await page.getByRole('button', { name: 'Open Project' }).click()
      const settings = page.getByRole('dialog', { name: 'Project settings' })
      await expect(settings.getByText('sales.xlsx')).toBeVisible()
      await expect(settings.getByText('costs.xlsx')).toBeVisible()
      await expect(settings.getByText('Unavailable', { exact: true })).toHaveCount(2)
      await settings.getByRole('button', { name: 'Done' }).click()

      await page.getByRole('button', { name: 'Project actions' }).click()
      await page.getByRole('menuitem', { name: /Save Project As/ }).click()
      const saveAnyway = page.getByRole('button', { name: 'Save anyway' })
      if (await saveAnyway.isVisible().catch(() => false)) await saveAnyway.click()
      await expect.poll(async () => { try { await access(output); return true } catch { return false } }).toBe(true)

      const source = JSON.parse(await readFile(completeProjectV3FixturePath, 'utf8'))
      const saved = JSON.parse(await readFile(output, 'utf8'))
      delete source.exportedAt
      delete saved.exportedAt
      const savedPaths = saved.project.workbooks.map((workbook: { sourcePath?: string }) => workbook.sourcePath)
      for (const document of [source, saved]) {
        for (const workbook of document.project.workbooks) delete workbook.sourcePath
      }
      expect(saved).toEqual(source)
      expect(savedPaths).toEqual(expect.arrayContaining([expect.any(String), expect.any(String)]))
    } finally {
      await closeElectronApp(app, page)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('saves an opened project back to its current path', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-save-e2e-'))
    const projectPath = resolve(directory, 'Current project.json')
    await copyFile(projectFixturePath, projectPath)
    const { app, page } = await launch({ ELECTRON_E2E_IMPORT_PATH: projectPath })
    try {
      await page.getByRole('button', { name: 'Open Project' }).click()
      const settings = page.getByRole('dialog', { name: 'Project settings' })
      await settings.getByRole('button', { name: 'Done' }).click()

      await page.getByRole('button', { name: 'Project actions' }).click()
      await page.getByRole('menuitem', { name: /Save Project$/ }).click()
      const saveAnyway = page.getByRole('button', { name: 'Save anyway' })
      if (await saveAnyway.isVisible().catch(() => false)) await saveAnyway.click()
      await expect.poll(async () => {
        const saved = JSON.parse(await readFile(projectPath, 'utf8'))
        return saved.version === 3 ? saved.project?.name : null
      }).toBe('Current project')
    } finally {
      await closeElectronApp(app, page)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('uses Save As for the first save of a new project', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-new-save-e2e-'))
    const projectPath = resolve(directory, 'New analysis.json')
    const { app, page } = await launch({ ELECTRON_E2E_SAVE_PATH: projectPath })
    try {
      await page.getByRole('button', { name: 'Project actions' }).click()
      await page.getByRole('menuitem', { name: /Save Project$/ }).click()
      await expect.poll(async () => {
        try { return JSON.parse(await readFile(projectPath, 'utf8')) } catch { return null }
      }).toMatchObject({ version: 3, project: { name: 'New analysis', blocks: [], regions: [] } })
    } finally {
      await closeElectronApp(app, page)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('retains an open workbook when native config import fails', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-e2e-'))
    const missingProject = resolve(directory, 'missing-project.json')
    const { app, page } = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath, ELECTRON_E2E_IMPORT_PATH: missingProject })
    try {
      await addWorkbookSource(page, 'test_data.xlsx')
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()

      await page.getByRole('button', { name: 'Open Project' }).click()
      await expect(page.getByRole('alert')).toContainText('Unable to import config')
      await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
    } finally {
      await closeElectronApp(app, page)
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
      await closeElectronApp(app, page)
    }
  })

  test('handles native dialog cancellation without mutating the workspace', async () => {
    const { app, page } = await launch({ ELECTRON_E2E_CANCEL_DIALOGS: '1' })
    try {
      await openProjectSettings(page)
      await page.getByRole('dialog', { name: 'Project settings' }).getByRole('button', { name: 'Add workbook source' }).click()
      await expect(page.getByText('Select an Excel file, then choose the ranges you want to turn into structured data.', { exact: true })).toBeVisible()
      await page.getByRole('dialog', { name: 'Project settings' }).getByRole('button', { name: 'Done' }).click()
      await page.getByRole('button', { name: 'Open Project' }).click()
      await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('persists and clears a valid recovery project through native IPC', async () => {
    const { app, page } = await launch()
    const recovery = JSON.stringify({
      version: 3,
      exportedAt: '2026-07-16T00:00:00.000Z',
      project: { id: 'recovery-project', name: 'Recovery', workbooks: [], activeWorkbookId: null, blocks: [], regions: [], activeBlockId: '', activeRegionId: null, focusMode: 'always-editable' },
      data: {},
      blockResults: [],
    })
    try {
      await page.evaluate(async (content) => {
        const api = (window as any).electronAPI
        await api.clearRecovery()
        await api.saveRecovery(content)
      }, recovery)
      await expect.poll(() => page.evaluate(async () => (window as any).electronAPI.loadRecovery())).toEqual({ status: 'ok', value: recovery })
      await page.evaluate(async () => (window as any).electronAPI.clearRecovery())
      await expect.poll(() => page.evaluate(async () => (window as any).electronAPI.loadRecovery())).toEqual({ status: 'ok', value: null })
    } finally {
      await closeElectronApp(app, page)
    }
  })

  test('offers and restores a recovery workspace after restart', async () => {
    const recovery = await readFile(projectFixturePath, 'utf8')
    const first = await launch()
    try {
      await first.page.evaluate(async (content) => {
        const api = (window as any).electronAPI
        await api.clearRecovery()
        await api.saveRecovery(content)
      }, recovery)
    } finally {
      await closeElectronApp(first.app, first.page)
    }

    const second = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath }, true)
    try {
      const dialog = second.page.getByRole('dialog', { name: 'Recover unsaved workspace?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Recover' }).click()
      const settings = second.page.getByRole('dialog', { name: 'Project settings' })
      await expect(settings.getByText('Unavailable', { exact: true })).toBeVisible()
      await settings.getByRole('button', { name: 'Reassign' }).click()
      await settings.getByRole('button', { name: 'Done' }).click()
      await expect(second.page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
      await second.page.evaluate(async () => (window as any).electronAPI.clearRecovery())
    } finally {
      await closeElectronApp(second.app, second.page)
    }
  })

  test('treats a recovered workspace as unsaved before closing the application', async () => {
    const recovery = await readFile(projectFixturePath, 'utf8')
    const first = await launch()
    try {
      await first.page.evaluate(async (content) => {
        const api = (window as any).electronAPI
        await api.clearRecovery()
        await api.saveRecovery(content)
      }, recovery)
    } finally {
      await closeElectronApp(first.app, first.page)
    }

    const second = await launch({ ELECTRON_E2E_OPEN_PATH: workbookPath }, true)
    try {
      const recoveryDialog = second.page.getByRole('dialog', { name: 'Recover unsaved workspace?' })
      await expect(recoveryDialog).toBeVisible()
      await recoveryDialog.getByRole('button', { name: 'Recover' }).click()
      const settings = second.page.getByRole('dialog', { name: 'Project settings' })
      await expect(settings.getByText('Unavailable', { exact: true })).toBeVisible()
      await settings.getByRole('button', { name: 'Reassign' }).click()
      await settings.getByRole('button', { name: 'Done' }).click()
      await expect(second.page.getByRole('textbox', { name: 'block_1' })).toBeVisible()

      await second.page.locator('.window-control-close').click()
      const confirmation = second.page.getByRole('dialog', { name: 'Close application?' })
      await expect(confirmation).toBeVisible()
      await expect(confirmation.getByRole('button', { name: 'Discard and close' })).toBeVisible()
      await confirmation.getByRole('button', { name: 'Cancel' }).click()
      await second.page.evaluate(async () => (window as any).electronAPI.clearRecovery())
    } finally {
      await closeElectronApp(second.app, second.page)
    }
  })

  test('discards a recovery workspace after restart', async () => {
    const recovery = await readFile(projectFixturePath, 'utf8')
    const first = await launch()
    try {
      await first.page.evaluate(async (content) => {
        const api = (window as any).electronAPI
        await api.clearRecovery()
        await api.saveRecovery(content)
      }, recovery)
    } finally {
      await closeElectronApp(first.app, first.page)
    }

    const second = await launch({}, true)
    try {
      const dialog = second.page.getByRole('dialog', { name: 'Recover unsaved workspace?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Discard' }).click()
      await expect(second.page.getByText('Select an Excel file, then choose the ranges you want to turn into structured data.', { exact: true })).toBeVisible()
      await expect.poll(() => second.page.evaluate(async () => (window as any).electronAPI.loadRecovery())).toEqual({ status: 'ok', value: null })
    } finally {
      await closeElectronApp(second.app, second.page)
    }
  })
})
