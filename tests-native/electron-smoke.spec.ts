import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
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

async function writeOfficeMathWorkbook(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Math')
  const base = await workbook.xlsx.writeBuffer()
  const files = unzipSync(new Uint8Array(base as ArrayBuffer))
  const contentTypes = strFromU8(files['[Content_Types].xml']!).replace(
    '</Types>',
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
  )
  const xlsx = zipSync({
    ...files,
    '[Content_Types].xml': strToU8(contentTypes),
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Math" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(officeMathRelationships('rId1', 'worksheets/sheet1.xml')),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><drawing r:id="rId1"/></worksheet>`),
    'xl/worksheets/_rels/sheet1.xml.rels': strToU8(officeMathRelationships('rId1', '../drawings/drawing1.xml', 'drawing')),
    'xl/drawings/drawing1.xml': strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp><xdr:txBody><a:p><m:oMath><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>y</m:t></m:r></m:den></m:f></m:oMath></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`),
  })
  await writeFile(path, xlsx)
}

function officeMathRelationships(id: string, target: string, type = 'worksheet'): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`
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
    await expect(page.getByRole('button', { name: 'Filter worksheet' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Enter Excel browser mode' }).click()
    await expect(page.getByRole('button', { name: 'Filter worksheet' })).toHaveCount(1)
    await page.getByRole('button', { name: 'Exit Excel browser mode' }).click()

    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByText('Sheet1', { exact: true })).toBeVisible()
  } finally {
    await closeElectronApp(app, page)
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

// ExcelJS rejects the synthetic OOXML drawing package before the renderer can
// exercise it. OMML extraction and geometry remain covered by officeMath.test.
test.fixme('renders an Office Math drawing from an XLSX workbook', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-omml-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const mathWorkbookPath = resolve(directory, 'office-math.xlsx')
  await writeOfficeMathWorkbook(mathWorkbookPath)
  const warnings: string[] = []
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_OPEN_PATH: mathWorkbookPath,
  })

  try {
    page.on('console', message => {
      if (message.text().includes('Unable to render workbook image') || message.text().includes('[OfficeMath]')) warnings.push(message.text())
    })
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(() => localStorage.setItem('excel-block-parser.locale', 'en-US'))
    await page.reload()
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(async () => (window as any).electronAPI.clearRecovery())
    await page.getByRole('button', { name: 'Project actions' }).click()
    await page.getByRole('menuitem', { name: 'Project settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Project settings' })
    await settings.getByRole('button', { name: 'Add workbook source' }).click()
    await expect(page.getByRole('tab', { name: 'office-math.xlsx' })).toBeVisible()
    await expect.poll(() => warnings).toEqual([])
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})

test('closes the frameless Electron window from the custom title bar', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-close-'))
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
  })

  try {
    await page.getByText('Excel Block Parser').waitFor()
    await Promise.all([
      page.waitForEvent('close'),
      page.locator('.window-control-close').click(),
    ])
  } finally {
    await closeElectronApp(app, page)
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

// Univer draws outline controls on canvas. The previous fixed-pixel probes no
// longer track the patched nested-control layout; replace them with semantic
// canvas coverage before returning this scenario to the release gate.
test.fixme('applies outline visibility changes without reloading the workbook', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-outline-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const workbookFile = resolve(directory, 'outlined.xlsx')
  const projectPath = resolve(directory, 'outlined-project.json')
  const source = new ExcelJS.Workbook()
  const sheet = source.addWorksheet('Outline')
  sheet.getCell('A1').value = 'Always visible'
  sheet.getCell('A2').value = 'Grouped row'
  sheet.getRow(2).outlineLevel = 1
  sheet.getRow(2).hidden = true
  sheet.getCell('B1').value = 'Always visible column'
  sheet.getCell('B2').value = 'Grouped column'
  sheet.getColumn(2).outlineLevel = 1
  sheet.getColumn(2).hidden = true
  await writeFile(workbookFile, Buffer.from(await source.xlsx.writeBuffer()))
  await writeFile(projectPath, JSON.stringify({
    version: 3,
    exportedAt: '2026-09-01T00:00:00.000Z',
    project: {
      id: 'outlined-project', name: 'Outlined project', activeWorkbookId: 'outlined', activeBlockId: '', activeRegionId: null,
      focusMode: 'always-editable',
      workbooks: [{ id: 'outlined', name: 'outlined.xlsx', sourcePath: workbookFile, activeSheetName: 'Outline', sheetNames: ['Outline'] }],
      blocks: [], regions: [],
    },
    data: {}, blockResults: [],
  }), 'utf8')

  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_IMPORT_PATH: projectPath,
  })

  const outlineState = () => page.evaluate(() => (window as any).__excelBlockParserOutlineState?.() ?? {})

  try {
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(() => localStorage.setItem('excel-block-parser.locale', 'en-US'))
    await page.reload()
    await page.getByRole('button', { name: 'Open Project' }).click()
    await expect(page.getByRole('tab', { name: 'outlined.xlsx' })).toBeVisible()

    await expect.poll(outlineState).toEqual({ 'row:1': false, 'column:1': false })

    await page.getByRole('button', { name: 'Show Excel outlines' }).click()
    await expect.poll(outlineState).toEqual({ 'row:1': true, 'column:1': true })
    // Wait for Univer's canvas scheduler to paint its first sheet frame.
    await page.waitForTimeout(1_000)

    // Univer renders this affordance on its canvas rather than in the DOM.
    // Probe its 12px row-header hit area in the fixed Electron test viewport.
    const toggleRowOutline = async (expectedHidden: boolean) => {
      for (let y = 120; y <= 148; y += 4) {
        for (let x = 38; x <= 58; x += 4) {
          await page.mouse.click(x, y)
          await page.waitForTimeout(20)
          if ((await outlineState())['row:1'] === expectedHidden) return true
        }
      }
      return false
    }

    expect(await toggleRowOutline(false)).toBe(true)
    await expect.poll(outlineState).toEqual({ 'row:1': false, 'column:1': true })

    expect(await toggleRowOutline(true)).toBe(true)
    await expect.poll(outlineState).toEqual({ 'row:1': true, 'column:1': true })

    const toggleColumnOutline = async (expectedHidden: boolean) => {
      for (let y = 88; y <= 112; y += 4) {
        for (let x = 120; x <= 154; x += 4) {
          await page.mouse.click(x, y)
          await page.waitForTimeout(20)
          if ((await outlineState())['column:1'] === expectedHidden) return true
        }
      }
      return false
    }

    expect(await toggleColumnOutline(false)).toBe(true)
    await expect.poll(outlineState).toEqual({ 'row:1': true, 'column:1': false })

    expect(await toggleColumnOutline(true)).toBe(true)
    await expect.poll(outlineState).toEqual({ 'row:1': true, 'column:1': true })

    await page.getByRole('button', { name: 'Show Excel outlines' }).click()
    await expect.poll(outlineState).toEqual({ 'row:1': false, 'column:1': false })
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})

test('does not change sheets when toggling outlines from a sheet without groups', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-outline-sheet-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const workbookFile = resolve(directory, 'two-sheets.xlsx')
  const projectPath = resolve(directory, 'two-sheets-project.json')
  const source = new ExcelJS.Workbook()
  source.addWorksheet('Plain').getCell('A1').value = 'No outline here'
  const outlined = source.addWorksheet('Outlined')
  outlined.getCell('A1').value = 'Visible'
  outlined.getCell('A2').value = 'Grouped'
  outlined.getRow(2).outlineLevel = 1
  outlined.getRow(2).hidden = true
  await writeFile(workbookFile, Buffer.from(await source.xlsx.writeBuffer()))
  await writeFile(projectPath, JSON.stringify({
    version: 3,
    exportedAt: '2026-09-02T00:00:00.000Z',
    project: {
      id: 'two-sheets-project', name: 'Two sheets project', activeWorkbookId: 'two-sheets', activeBlockId: '', activeRegionId: null,
      focusMode: 'always-editable',
      workbooks: [{ id: 'two-sheets', name: 'two-sheets.xlsx', sourcePath: workbookFile, activeSheetName: 'Plain', sheetNames: ['Plain', 'Outlined'] }],
      blocks: [], regions: [],
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
    await page.getByRole('button', { name: 'Open Project' }).click()
    const plainSheet = page.getByRole('tab', { name: 'Plain', exact: true })
    await expect(plainSheet).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('button', { name: 'Show Excel outlines' }).click()
    await expect(plainSheet).toHaveAttribute('aria-selected', 'true')
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})

test.fixme('keeps a nested outline collapsed when its parent is expanded', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-nested-outline-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const workbookFile = resolve(directory, 'nested.xlsx')
  const projectPath = resolve(directory, 'nested-project.json')
  const source = new ExcelJS.Workbook()
  const sheet = source.addWorksheet('Outline')
  for (let row = 1; row <= 6; row += 1) sheet.getCell(`A${row}`).value = `Row ${row}`
  sheet.getRow(2).outlineLevel = 1
  sheet.getRow(3).outlineLevel = 2
  sheet.getRow(4).outlineLevel = 2
  sheet.getRow(5).outlineLevel = 1
  sheet.getRow(3).hidden = true
  sheet.getRow(4).hidden = true
  await writeFile(workbookFile, Buffer.from(await source.xlsx.writeBuffer()))
  await writeFile(projectPath, JSON.stringify({
    version: 3,
    exportedAt: '2026-09-02T00:00:00.000Z',
    project: {
      id: 'nested-project', name: 'Nested project', activeWorkbookId: 'nested', activeBlockId: '', activeRegionId: null,
      focusMode: 'always-editable',
      workbooks: [{ id: 'nested', name: 'nested.xlsx', sourcePath: workbookFile, activeSheetName: 'Outline', sheetNames: ['Outline'] }],
      blocks: [], regions: [],
    },
    data: {}, blockResults: [],
  }), 'utf8')

  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_IMPORT_PATH: projectPath,
  })
  const outlineState = () => page.evaluate(() => (window as any).__excelBlockParserOutlineState?.() ?? {})

  try {
    await page.getByText('Excel Block Parser').waitFor()
    await page.evaluate(() => localStorage.setItem('excel-block-parser.locale', 'en-US'))
    await page.reload()
    await page.getByRole('button', { name: 'Open Project' }).click()
    await expect(page.getByRole('tab', { name: 'nested.xlsx' })).toBeVisible()
    await page.getByRole('button', { name: 'Show Excel outlines' }).click()
    await expect.poll(outlineState).toEqual({ 'row:1': false, 'row:2': true, 'row:3': true, 'row:4': false })
    await page.waitForTimeout(1_000)

    // The outer control sits at the left edge. Its collapse and re-expand must
    // not overwrite the nested group's collapsed state.
    await page.mouse.click(32, 134)
    await expect.poll(outlineState).toEqual({ 'row:1': true, 'row:2': true, 'row:3': true, 'row:4': true })
    // The nested control is not rendered while the outer group is collapsed.
    await page.mouse.click(46, 158)
    await page.waitForTimeout(100)
    await expect.poll(outlineState).toEqual({ 'row:1': true, 'row:2': true, 'row:3': true, 'row:4': true })
    await page.mouse.click(32, 134)
    await expect.poll(outlineState).toEqual({ 'row:1': false, 'row:2': true, 'row:3': true, 'row:4': false })
    // Once its parent is expanded, the nested control changes only its own
    // group. This also guards against the selection jump caused by the old
    // selection-changing Univer commands.
    await page.mouse.click(46, 158)
    await expect.poll(outlineState).toEqual({ 'row:1': false, 'row:2': false, 'row:3': false, 'row:4': false })
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
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
