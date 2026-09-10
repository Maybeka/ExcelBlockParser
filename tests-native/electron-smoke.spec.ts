import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { closeElectronApp, launchElectronApp } from './electronLaunch'

const root = process.cwd()
const workbookPath = resolve(root, 'examples', 'test_data.xlsx')
const secondWorkbookPath = resolve(root, 'examples', 'multi_sheet.xlsx')
const officeMathWorkbookPath = resolve(root, 'tests-native', 'fixtures', 'office-math-textbox.xlsx')
const mathTypeWorkbookPath = resolve(root, 'tests-native', 'fixtures', 'mathtype-equation-dsmt4.xlsx')

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
    await expect(settings).toContainText(workbookPath)
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

test('registers an embedded workbook image with the live Univer drawing facade', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-image-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const workbookFile = resolve(directory, 'image.xlsx')
  const workbook = new ExcelJS.Workbook()
  const imageId = workbook.addImage({
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAF/gL+ZllnTwAAAABJRU5ErkJggg==',
    extension: 'png',
  })
  const sheet = workbook.addWorksheet('Image')
  sheet.addImage(imageId, { tl: { col: 1, row: 1 }, ext: { width: 48, height: 48 } })
  await writeFile(workbookFile, Buffer.from(await workbook.xlsx.writeBuffer()))
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_OPEN_PATH: workbookFile,
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
    await expect(page.getByRole('tab', { name: 'image.xlsx' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserImageState?.() ?? {})).toEqual({
      Image: [expect.objectContaining({ source: expect.stringMatching(/^data:image\/png;base64,/) })],
    })
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})

test('renders Office Math without loading speech services or invalid SVG geometry', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-mathjax-'))
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
  })
  const requestedUrls: string[] = []

  try {
    page.on('request', request => requestedUrls.push(request.url()))
    await page.getByText('Excel Block Parser').waitFor()
    const assets = await readdir(resolve(root, 'out', 'renderer', 'assets'))
    const component = (name: string) => {
      const asset = assets.find(file => file.startsWith(`${name}-`) && file.endsWith('.js'))
      if (!asset) throw new Error(`Missing MathJax ${name} component in build output`)
      return `./assets/${asset}`
    }
    const svgAssets = await Promise.all(assets
      .filter(file => file.startsWith('svg-') && file.endsWith('.js'))
      .map(async file => ({ file, source: await readFile(resolve(root, 'out', 'renderer', 'assets', file), 'utf8') })))
    const outputSvg = svgAssets.find(asset => asset.source.includes('createSVG('))?.file
    const svgFont = svgAssets.find(asset => asset.source.includes('MathJaxNewcmFont'))?.file
    if (!outputSvg || !svgFont) throw new Error('Missing isolated MathJax SVG output or font component in build output')

    const result = await page.evaluate(async ({ mathjax, mathml, svg, font, adaptor, html }) => {
      const [mathjaxModule, { MathML }, { SVG }, fontModule, { browserAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
        import(mathjax), import(mathml), import(svg), import(font), import(adaptor), import(html),
      ]) as any[]
      const api = mathjaxModule.mathjax ?? mathjaxModule.m
      const MathJaxNewcmFont = fontModule.MathJaxNewcmFont ?? fontModule.M
      RegisterHTMLHandler(browserAdaptor())
      const document = api.document(window.document, {
        InputJax: new MathML(),
        OutputJax: new SVG({ fontCache: 'none', fontData: MathJaxNewcmFont }),
      })
      return document.convert('<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mi>y</mi></mfrac></math>', {
        display: false, em: 16, ex: 8, containerWidth: 16_384,
      }).outerHTML
    }, {
      mathjax: component('mathjax'),
      mathml: component('mathml'),
      svg: `./assets/${outputSvg}`,
      font: `./assets/${svgFont}`,
      adaptor: component('browserAdaptor'),
      html: component('html'),
    })

    expect(result).toContain('<svg')
    expect(result).not.toMatch(/(?:NaN|Infinity)/i)
    expect(requestedUrls).not.toContain(expect.stringContaining('speech-worker.js'))
  } finally {
    await closeElectronApp(app, page)
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('renders an Office Math drawing from a modern Excel text box', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-omml-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const warnings: string[] = []
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_OPEN_PATH: officeMathWorkbookPath,
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
    await expect(page.getByRole('tab', { name: 'office-math-textbox.xlsx' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserImageState?.() ?? {})).toEqual({
      Sheet1: [expect.objectContaining({ source: expect.stringMatching(/^data:image\/svg\+xml;base64,/) })],
    })
    await expect.poll(() => warnings).toEqual([])
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})

test('renders a MathType EMF preview through Electron canvas support', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-mathtype-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const warnings: string[] = []
  const { app, page } = await launchElectronApp({
    ELECTRON_E2E_USER_DATA_DIR: userDataDirectory,
    ELECTRON_E2E_OPEN_PATH: mathTypeWorkbookPath,
  })

  try {
    page.on('console', message => {
      if (message.text().includes('[LegacyEquation]') || message.text().includes('[Equation.3]')) warnings.push(message.text())
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
    await expect(page.getByRole('tab', { name: 'mathtype-equation-dsmt4.xlsx' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserImageState?.()?.Sheet1 ?? [])).toEqual([
      expect.objectContaining({ source: expect.stringMatching(/^data:image\/svg\+xml;base64,/) }),
    ])
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(settings).toBeHidden()
    expect(await page.evaluate(() => (window as any).__excelBlockParserScrollToCell?.('Sheet1', 12, 10))).toBe(true)
    await page.waitForTimeout(200)
    await page.screenshot({ path: '/tmp/mathtype-electron-preview.png' })
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

test('keeps a single-cell Univer selection while switching populated worksheets', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-selection-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const workbookFile = resolve(directory, 'populated-sheets.xlsx')
  const projectPath = resolve(directory, 'populated-sheets-project.json')
  const source = new ExcelJS.Workbook()
  const first = source.addWorksheet('First')
  const second = source.addWorksheet('Second')
  for (const sheet of [first, second]) {
    for (let row = 1; row <= 12; row += 1) {
      for (let column = 1; column <= 8; column += 1) sheet.getCell(row, column).value = `${sheet.name}-${row}-${column}`
    }
    sheet.views = [{ state: 'normal', activeCell: sheet === first ? 'C4' : 'F9' }]
  }
  await writeFile(workbookFile, Buffer.from(await source.xlsx.writeBuffer()))
  await writeFile(projectPath, JSON.stringify({
    version: 3,
    exportedAt: '2026-09-08T00:00:00.000Z',
    project: {
      id: 'populated-sheets-project', name: 'Populated sheets project', activeWorkbookId: 'populated-sheets', activeBlockId: '', activeRegionId: null,
      focusMode: 'always-editable',
      workbooks: [{ id: 'populated-sheets', name: 'populated-sheets.xlsx', sourcePath: workbookFile, activeSheetName: 'First', sheetNames: ['First', 'Second'] }],
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
    await expect(page.getByRole('tab', { name: 'First', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserSelectionState?.())).toMatchObject({
      sheetName: 'First',
      a1Notation: 'A1',
    })

    await page.getByRole('tab', { name: 'Second', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Second', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserSelectionState?.())).toMatchObject({
      sheetName: 'Second',
      a1Notation: 'A1',
    })

    await page.getByRole('tab', { name: 'First', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'First', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserSelectionState?.())).toMatchObject({
      sheetName: 'First',
      a1Notation: 'A1',
    })
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps a single-cell selection while restoring source-hidden rows and columns', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-hidden-selection-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const workbookFile = resolve(directory, 'hidden.xlsx')
  const projectPath = resolve(directory, 'hidden-project.json')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Hidden')
  for (let row = 1; row <= 12; row += 1) {
    for (let column = 1; column <= 8; column += 1) sheet.getCell(row, column).value = `${row}-${column}`
  }
  sheet.getRow(3).hidden = true
  sheet.getColumn(4).hidden = true
  sheet.getRow(6).outlineLevel = 1
  sheet.getRow(6).hidden = true
  sheet.getColumn(7).outlineLevel = 1
  sheet.getColumn(7).hidden = true
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
  await writeFile(workbookFile, Buffer.from(await workbook.xlsx.writeBuffer()))
  await writeFile(projectPath, JSON.stringify({
    version: 3,
    exportedAt: '2026-09-10T00:00:00.000Z',
    project: {
      id: 'hidden-selection-project', name: 'Hidden selection project', activeWorkbookId: 'hidden', activeBlockId: '', activeRegionId: null,
      focusMode: 'always-editable',
      workbooks: [{ id: 'hidden', name: 'hidden.xlsx', sourcePath: workbookFile, activeSheetName: 'Hidden', sheetNames: ['Hidden'] }],
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
    await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserSelectionState?.())).toMatchObject({
      sheetName: 'Hidden',
      a1Notation: 'A1',
    })
  } finally {
    await closeElectronApp(app, page)
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps a single-cell selection while switching cached populated workbooks', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'excel-block-parser-workbook-selection-'))
  const userDataDirectory = resolve(directory, 'user-data')
  const firstPath = resolve(directory, 'first.xlsx')
  const secondPath = resolve(directory, 'second.xlsx')
  const projectPath = resolve(directory, 'workbook-selection-project.json')

  const writeWorkbook = async (filePath: string, sheetName: string, activeCell: string) => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(sheetName)
    for (let row = 1; row <= 12; row += 1) {
      for (let column = 1; column <= 8; column += 1) sheet.getCell(row, column).value = `${sheetName}-${row}-${column}`
    }
    sheet.views = [{ state: 'normal', activeCell }]
    await writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))
  }
  await writeWorkbook(firstPath, 'First', 'C4')
  await writeWorkbook(secondPath, 'Second', 'F9')
  await writeFile(projectPath, JSON.stringify({
    version: 3,
    exportedAt: '2026-09-10T00:00:00.000Z',
    project: {
      id: 'workbook-selection-project', name: 'Workbook selection project', activeWorkbookId: 'first', activeBlockId: '', activeRegionId: null,
      focusMode: 'always-editable',
      workbookLoadSettings: {
        parseImages: true,
        parseOfficeMath: true,
        restoreExcelActiveCell: true,
        performanceLogging: false,
        experimentalStagedLoading: false,
      },
      workbooks: [
        { id: 'first', name: 'first.xlsx', sourcePath: firstPath, activeSheetName: 'First', sheetNames: ['First'] },
        { id: 'second', name: 'second.xlsx', sourcePath: secondPath, activeSheetName: 'Second', sheetNames: ['Second'] },
      ],
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
    const firstTab = page.getByRole('tab', { name: /first\.xlsx$/ })
    const secondTab = page.getByRole('tab', { name: /second\.xlsx$/ })
    await expect(firstTab).toHaveAttribute('aria-selected', 'true')

    for (const [tab, sheetName, activeCell] of [[secondTab, 'Second', 'F9'], [firstTab, 'First', 'C4'], [secondTab, 'Second', 'F9']] as const) {
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('tab', { name: sheetName, exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect.poll(() => page.evaluate(() => (window as any).__excelBlockParserSelectionState?.())).toMatchObject({
        sheetName,
        a1Notation: activeCell,
      })
    }
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
