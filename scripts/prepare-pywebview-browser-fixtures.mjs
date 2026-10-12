import ExcelJS from 'exceljs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = resolve(root, '.tmp/pywebview-browser-fixtures')
await mkdir(directory, { recursive: true })

async function workbook(fileName, sheets) {
  const source = new ExcelJS.Workbook()
  for (const [name, activeCell, hidden] of sheets) {
    const sheet = source.addWorksheet(name)
    for (let row = 1; row <= 12; row++) {
      for (let column = 1; column <= 8; column++) sheet.getCell(row, column).value = `${name}-${row}-${column}`
    }
    if (hidden) {
      sheet.getRow(3).hidden = true
      sheet.getColumn(4).hidden = true
      sheet.getRow(6).outlineLevel = 1
      sheet.getRow(6).hidden = true
      sheet.getColumn(7).outlineLevel = 1
      sheet.getColumn(7).hidden = true
    }
    sheet.views = hidden
      ? [{ state: 'frozen', xSplit: 1, ySplit: 1, activeCell }]
      : [{ state: 'normal', activeCell }]
  }
  await source.xlsx.writeFile(resolve(directory, fileName))
}

await workbook('first.xlsx', [['First', 'C4', true], ['Second', 'F9', false]])
await workbook('second.xlsx', [['Other', 'F9', false], ['Ungrouped', 'D5', false]])

for (const mode of ['normal', 'restore', 'blocks']) {
  const blocks = mode === 'blocks' ? [
    { id: 'first-block', label: 'first_block', workbookId: 'first', activeSheet: 'First' },
    { id: 'other-block', label: 'other_block', workbookId: 'second', activeSheet: 'Other' },
  ].map(block => ({ ...block, range: null, headerRows: [0], collapsed: false, selectionLocked: false, columns: [], dataSnapshot: null })) : []
  const project = {
    version: 3, exportedAt: '2026-10-12T00:00:00.000Z',
    project: {
      id: `browser-${mode}`, name: mode, activeWorkbookId: 'first',
      activeBlockId: blocks[0]?.id ?? '', activeRegionId: null, focusMode: 'always-editable',
      workbookLoadSettings: { parseImages: true, parseOfficeMath: true, restoreExcelActiveCell: mode === 'restore', performanceLogging: false, experimentalStagedLoading: false },
      workbooks: [
        { id: 'first', name: 'first.xlsx', sourcePath: 'first.xlsx', activeSheetName: 'First', sheetNames: ['First', 'Second'], displaySettings: { showOutlines: false, showFrozenPanes: false } },
        { id: 'second', name: 'second.xlsx', sourcePath: 'second.xlsx', activeSheetName: 'Other', sheetNames: ['Other', 'Ungrouped'], displaySettings: { showOutlines: false, showFrozenPanes: false } },
      ], blocks, regions: [],
    }, data: {}, blockResults: [],
  }
  await writeFile(resolve(directory, `${mode}.json`), JSON.stringify(project))
}
console.log('Prepared populated pywebview browser fixtures')

const nested = new ExcelJS.Workbook()
const sheet = nested.addWorksheet('Nested')
for (let row = 1; row <= 12; row++) {
  for (let col = 1; col <= 8; col++) sheet.getCell(row, col).value = `${row}-${col}`
}
for (let row = 2; row <= 8; row++) sheet.getRow(row).outlineLevel = 1
for (let row = 4; row <= 5; row++) { sheet.getRow(row).outlineLevel = 2; sheet.getRow(row).hidden = true }
for (let col = 2; col <= 7; col++) sheet.getColumn(col).outlineLevel = 1
for (let col = 4; col <= 5; col++) { sheet.getColumn(col).outlineLevel = 2; sheet.getColumn(col).hidden = true }
sheet.getRow(11).hidden = true
sheet.getColumn(8).hidden = true
await nested.xlsx.writeFile(resolve(directory, 'nested.xlsx'))
await writeFile(resolve(directory, 'nested.json'), JSON.stringify({
  version: 3, exportedAt: '2026-10-12T00:00:00.000Z',
  project: { id: 'nested', name: 'nested', activeWorkbookId: 'nested', activeBlockId: '', activeRegionId: null,
    focusMode: 'always-editable', blocks: [], regions: [],
    workbookLoadSettings: { parseImages: true, parseOfficeMath: true, restoreExcelActiveCell: false, performanceLogging: false, experimentalStagedLoading: false },
    workbooks: [{ id: 'nested', name: 'nested.xlsx', sourcePath: 'nested.xlsx', sheetNames: ['Nested'], activeSheetName: 'Nested', displaySettings: { showOutlines: true, showFrozenPanes: false } }] },
  data: {}, blockResults: [],
}))
