import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeElectronApp, launchElectronApp } from './electronLaunch'

const root = process.cwd()
const workbookPath = resolve(root, 'examples', 'test_data.xlsx')
const secondWorkbookPath = resolve(root, 'examples', 'multi_sheet.xlsx')

function block(id: string, label: string, workbookId: string, sheet: string) {
  return {
    id, label, workbookId, activeSheet: sheet,
    range: { startRow: 0, startCol: 0, endRow: 2, endCol: 1, a1Notation: 'A1:B3' },
    headerRows: [0], collapsed: false, selectionLocked: true, columns: [], dataSnapshot: null,
  }
}

test('opens a real workbook through the Electron host bridge', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-smoke-'))
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_OPEN_PATH: workbookPath,
  })

  try {
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
    await expect(settings).toBeHidden()

    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByText('Sheet1', { exact: true })).toBeVisible()
  } finally {
    await closeElectronApp(app, page)
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('keeps the selected block while switching attached workbooks', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-switch-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const projectPath = resolve(directory, 'two-workbooks.json')
  await writeFile(projectPath, JSON.stringify({
    version: 3,
    exportedAt: '2026-08-31T00:00:00.000Z',
    project: {
      id: 'two-workbooks', name: 'Two workbooks', activeWorkbookId: 'first', activeBlockId: 'first-block', activeRegionId: null,
      focusMode: 'always-editable',
      workbooks: [
        { id: 'first', name: 'test_data.xlsx', sourcePath: workbookPath, activeSheetName: 'Sheet1', sheetNames: ['Sheet1'] },
        { id: 'second', name: 'multi_sheet.xlsx', sourcePath: secondWorkbookPath, activeSheetName: 'Products', sheetNames: ['Products', 'Orders'] },
      ],
      blocks: [block('first-block', 'first_block', 'first', 'Sheet1'), block('second-block', 'second_block', 'second', 'Products')],
      regions: [],
    },
    data: {}, blockResults: [],
  }), 'utf8')

  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_IMPORT_PATH: projectPath,
  })

  try {
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(() => localStorage.setItem('excel-block-parser.locale', 'en-US'))
    await page.reload()
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(async () => (window as any).electronAPI.clearRecovery())

    await page.getByRole('button', { name: 'Open Project' }).click()
    const firstTab = page.getByRole('tab', { name: 'test_data.xlsx' })
    const secondTab = page.getByRole('tab', { name: 'multi_sheet.xlsx' })
    await expect(firstTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('textbox', { name: 'first_block' })).toBeVisible()

    await secondTab.click()
    await expect(secondTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Products', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'first_block' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'second_block' })).toHaveCount(0)
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})
