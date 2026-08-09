import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = process.cwd()
const salesPath = resolve(root, 'examples', 'test_data.xlsx')
const catalogPath = resolve(root, 'examples', 'multi_sheet.xlsx')

function mapping(colIndex: number, colLetter: string, key: string, type: 'string' | 'integer' | 'float') {
  return { colIndex, colLetter, suggestedKey: key, key, type, skip: false, valueMap: [] }
}

function projectFixture() {
  const block = (id: string, workbookId: string, sheet: string, columns: ReturnType<typeof mapping>[]) => ({
    id,
    label: 'records',
    workbookId,
    range: { startRow: 0, startCol: 0, endRow: 2, endCol: columns.length - 1, a1Notation: `A1:${columns.at(-1)!.colLetter}3` },
    activeSheet: sheet,
    headerRows: [0],
    collapsed: false,
    selectionLocked: false,
    columns,
    dataSnapshot: null,
  })
  return {
    version: 3,
    exportedAt: '2026-08-09T00:00:00.000Z',
    project: {
      id: 'multi-workbook-project',
      name: 'Embedded stale project name',
      workbooks: [
        { id: 'sales', name: 'test_data.xlsx', sourcePath: salesPath, sheetNames: [], activeSheetName: 'Sheet1' },
        { id: 'catalog', name: 'multi_sheet.xlsx', sourcePath: catalogPath, sheetNames: [], activeSheetName: 'Products' },
      ],
      activeWorkbookId: 'sales',
      blocks: [
        block('sales-records', 'sales', 'Sheet1', [mapping(0, 'A', 'name', 'string'), mapping(1, 'B', 'age', 'integer')]),
        block('catalog-records', 'catalog', 'Products', [mapping(0, 'A', 'id', 'string'), mapping(1, 'B', 'name', 'string'), mapping(2, 'C', 'price', 'float')]),
      ],
      regions: [],
      activeBlockId: 'sales-records',
      activeRegionId: null,
      focusMode: 'always-editable',
    },
    data: {},
    blockResults: [],
  }
}

async function launch(userDataDirectory: string, importPath: string, outputPath: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve(root, 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      ELECTRON_E2E: '1',
      ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
      ELECTRON_E2E_IMPORT_PATH: importPath,
      ELECTRON_E2E_SAVE_PATH: outputPath,
      ELECTRON_E2E_OPEN_PATHS: JSON.stringify([salesPath, catalogPath]),
    },
  })
  const page = await app.firstWindow()
  await page.getByText('Excel Block Parser').waitFor()
  await page.evaluate(async () => (window as any).electronAPI.clearRecovery())
  return { app, page }
}

test('keeps two real workbooks isolated across open, switch, preview, and save as', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-multi-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const importPath = resolve(directory, 'Multi workbook regression.json')
  const outputPath = resolve(directory, 'output.json')
  await writeFile(importPath, JSON.stringify(projectFixture()), 'utf8')

  const { app, page } = await launch(userDataDirectory, importPath, outputPath)
  try {
    await page.getByRole('button', { name: 'Open Project' }).click()
    await expect(page.getByRole('textbox', { name: 'records' })).toBeVisible()

    await expect(page.getByRole('tab', { name: 'test_data.xlsx' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'multi_sheet.xlsx' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Workbook canvas' }).getByText('Excel Workbook', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })
    await expect(navigator.getByText('Multi workbook regression', { exact: true })).toBeVisible()
    await expect(navigator.getByLabel('test_data.xlsx sheets').getByText('Sheet1', { exact: true })).toBeVisible()
    await expect(navigator.getByLabel('multi_sheet.xlsx sheets').getByText('Products', { exact: true })).toBeVisible()
    await expect(navigator.getByLabel('multi_sheet.xlsx sheets').getByText('Orders', { exact: true })).toBeVisible()

    const salesTab = page.getByRole('tab', { name: 'test_data.xlsx' })
    const catalogTab = page.getByRole('tab', { name: 'multi_sheet.xlsx' })
    await salesTab.click()
    await expect(salesTab).toHaveAttribute('aria-selected', 'true')
    await catalogTab.click()
    await expect(catalogTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('region', { name: 'Workbook canvas' }).getByText('Excel Workbook', { exact: true })).toBeVisible()
    await salesTab.click()
    await expect(salesTab).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('button', { name: 'Run & Preview' }).click()
    await expect(page.getByText('PARSE REVIEW', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close preview' }).click()
    await page.getByRole('button', { name: 'Project actions' }).click()
    await page.getByRole('menuitem', { name: /Save Project As/ }).click()

    await expect.poll(async () => {
      try { return JSON.parse(await readFile(outputPath, 'utf8')).version } catch { return null }
    }).toBe(3)
    const exported = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(exported.project.name).toBe('output')
    expect(exported.data.sales.records[0]).toMatchObject({ name: 'Alice', age: 25 })
    expect(exported.data.catalog.records[0]).toMatchObject({ id: 'P001', name: 'Widget A', price: 19.99 })
    expect(exported.project.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sales-records', workbookId: 'sales', range: expect.objectContaining({ a1Notation: 'A1:B3' }) }),
      expect.objectContaining({ id: 'catalog-records', workbookId: 'catalog', range: expect.objectContaining({ a1Notation: 'A1:C3' }) }),
    ]))
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
