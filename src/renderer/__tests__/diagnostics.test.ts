import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../types'
import { orderDiagnostics } from '../services/diagnostics'
import { builtInFeatureRegistry } from '../features/builtinRegistry'

const project = { id: 'p', name: 'P', workbooks: [{ id: 'a', name: 'a.xlsx', sheetNames: ['S'], activeSheetName: 'S' }, { id: 'b', name: 'b.xlsx', sheetNames: ['T'], activeSheetName: 'T' }], activeWorkbookId: 'a', blocks: [{ id: 'block', label: 'B', workbookId: 'b', activeSheet: 'T', range: { startRow: 2, startCol: 1, endRow: 3, endCol: 2, a1Notation: 'B3:C4' }, headerRows: [], collapsed: false, selectionLocked: false, columns: [], dataSnapshot: null }], regions: [], activeBlockId: 'block', activeRegionId: null, focusMode: 'always-editable' } satisfies ProjectConfig

describe('diagnostics coordinator', () => {
  it('resolves a cross-workbook focus target before UI navigation', () => {
    expect(builtInFeatureRegistry.diagnosticFocus(project, { code: 'sheet-missing', severity: 'error', blockId: 'block', message: 'missing' })).toMatchObject({
      workbookId: 'b', sheetName: 'T', featureId: 'builtin.extraction', itemId: 'block',
    })
  })
  it('orders errors before warnings deterministically', () => {
    const ordered = orderDiagnostics([{ code: 'z', severity: 'warning', message: 'z' }, { code: 'b', severity: 'error', message: 'b' }, { code: 'a', severity: 'error', message: 'a' }])
    expect(ordered.map(item => item.code)).toEqual(['a', 'b', 'z'])
  })
})
