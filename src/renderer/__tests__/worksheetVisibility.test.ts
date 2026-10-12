import { describe, expect, it, vi } from 'vitest'
import { SetColHiddenMutation, SetColVisibleMutation, SetRowHiddenMutation, SetRowVisibleMutation } from '@univerjs/sheets'
import { applyWorksheetVisibility } from '../services/worksheetVisibility'

describe('view-only worksheet visibility', () => {
  const sheet = { getSheet: () => ({ getSheetId: () => 'sheet', getRowCount: () => 50, getColumnCount: () => 20 }) }
  it.each([
    ['row', true, SetRowVisibleMutation.id], ['row', false, SetRowHiddenMutation.id],
    ['column', true, SetColVisibleMutation.id], ['column', false, SetColHiddenMutation.id],
  ] as const)('uses a selection-free mutation for %s visible=%s', (axis, visible, command) => {
    const api = { syncExecuteCommand: vi.fn(() => true) }
    applyWorksheetVisibility(api, 'workbook', sheet, axis, 2, 3, visible)
    expect(api.syncExecuteCommand).toHaveBeenCalledWith(command, {
      unitId: 'workbook', subUnitId: 'sheet', ranges: [axis === 'row'
        ? { startRow: 2, endRow: 4, startColumn: 0, endColumn: 19 }
        : { startColumn: 2, endColumn: 4, startRow: 0, endRow: 49 }],
    })
  })
  it('does not dispatch empty ranges and reports rejected mutations', () => {
    const api = { syncExecuteCommand: vi.fn(() => false) }
    applyWorksheetVisibility(api, 'workbook', sheet, 'row', 0, 0, true)
    expect(api.syncExecuteCommand).not.toHaveBeenCalled()
    expect(() => applyWorksheetVisibility(api, 'workbook', sheet, 'row', 0, 1, true)).toThrow('Unable to apply worksheet visibility')
  })
})
