import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../types'
import { captureExtractionSnapshots } from '../services/extractionPersistence'
import { createUnavailableSpreadsheetCapability } from '../services/spreadsheetCapability'

describe('extraction persistence preparation', () => {
  it('captures active-workbook headers and normalizes persisted region block labels', async () => {
    const project: ProjectConfig = {
      id: 'p', name: 'P', workbooks: [{ id: 'a', name: 'a.xlsx', sheetNames: ['S'], activeSheetName: 'S' }], activeWorkbookId: 'a',
      blocks: [{ id: 'b', label: 'B', workbookId: 'a', activeSheet: 'S', range: { startRow: 0, startCol: 0, endRow: 1, endCol: 1, a1Notation: 'A1:B2' }, headerRows: [0], collapsed: false, selectionLocked: false, columns: [], dataSnapshot: null }],
      regions: [{ id: 'r', label: 'R', workbookId: 'a', activeSheet: 'S', range: null, splitRules: [], collapsed: false, selectionLocked: false, blocks: [{ id: 'nested', label: '', workbookId: 'a', activeSheet: 'S', range: null, headerRows: [], collapsed: false, selectionLocked: false, columns: [], dataSnapshot: null }] }],
      activeBlockId: 'b', activeRegionId: null, focusMode: 'always-editable',
    }
    const spreadsheet = { ...createUnavailableSpreadsheetCapability(['S']), readRange: () => [['Group', ''], ['a', 'b']] }
    const result = await captureExtractionSnapshots(project, 'a', spreadsheet)
    expect(result.blocks[0].headerSnapshot).toEqual([['Group', 'Group']])
    expect(result.regions[0].blocks[0].label).toBe('block_1')
  })

  it('preserves the prior header snapshot when the active range is unavailable', async () => {
    const existing = [['Existing']]
    const project: ProjectConfig = {
      id: 'p', name: 'P', workbooks: [{ id: 'a', name: 'a.xlsx', sheetNames: ['S'], activeSheetName: 'S' }], activeWorkbookId: 'a',
      blocks: [{ id: 'b', label: 'B', workbookId: 'a', activeSheet: 'Missing', range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0, a1Notation: 'A1' }, headerRows: [0], headerSnapshot: existing, collapsed: false, selectionLocked: false, columns: [], dataSnapshot: null }],
      regions: [], activeBlockId: 'b', activeRegionId: null, focusMode: 'always-editable',
    }
    const result = await captureExtractionSnapshots(project, 'a', createUnavailableSpreadsheetCapability())
    expect(result.blocks[0].headerSnapshot).toEqual(existing)
  })
})
