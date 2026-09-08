import { describe, expect, it } from 'vitest'
import { restoreWorkbookSelections } from '../services/workbookSelectionState'

describe('workbook selection restoration', () => {
  it('writes each sheet selection directly without activating another sheet', () => {
    const calls: Array<{ command: string; params: Record<string, unknown> }> = []
    const sheets = [
      { id: 'first', name: 'First' },
      { id: 'second', name: 'Second' },
    ]
    const workbook = {
      getId: () => 'workbook-1',
      getSheets: () => sheets.map(sheet => ({
        getSheetId: () => sheet.id,
        getSheetName: () => sheet.name,
        getRange: (a1Notation: string) => ({ getRange: () => ({ a1Notation }) }),
      })),
    }

    restoreWorkbookSelections({
      syncExecuteCommand(command, params) { calls.push({ command, params }) },
    }, workbook, { First: 'C4', Second: 'D5' })

    expect(calls).toEqual([
      { command: 'sheet.command.select-range', params: { unitId: 'workbook-1', subUnitId: 'first', subUnit: 'first', range: { a1Notation: 'C4' } } },
      { command: 'sheet.command.select-range', params: { unitId: 'workbook-1', subUnitId: 'second', subUnit: 'second', range: { a1Notation: 'D5' } } },
    ])
  })

  it('uses A1 only for sheets without a saved Excel selection', () => {
    const ranges: string[] = []
    restoreWorkbookSelections({
      syncExecuteCommand(_command, params) { ranges.push((params.range as { a1Notation: string }).a1Notation) },
    }, {
      getId: () => 'workbook-1',
      getSheets: () => [{
        getSheetId: () => 'first',
        getSheetName: () => 'First',
        getRange: (a1Notation: string) => ({ getRange: () => ({ a1Notation }) }),
      }],
    }, {})

    expect(ranges).toEqual(['A1'])
  })
})
