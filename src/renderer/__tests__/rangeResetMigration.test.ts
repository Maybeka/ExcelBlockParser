import { describe, expect, it } from 'vitest'
import { prepareBlockRangeUpdate } from '../features/extraction/rangeResetMigration'
import type { BlockConfig, CellRange } from '../types'

const range: CellRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 1, a1Notation: 'A1:B3' }
const block: BlockConfig = {
  id: 'orders', label: 'orders', workbookId: 'book', activeSheet: 'Old', range, headerRows: [0], collapsed: false, selectionLocked: true,
  columns: [
    { colIndex: 0, colLetter: 'A', suggestedKey: 'name', key: 'customer', type: 'string', skip: false, valueMap: [] },
    { colIndex: 1, colLetter: 'B', suggestedKey: 'amount', key: 'amount', type: 'valueMapping', skip: true, valueMap: [{ from: 'Y', to: true }] },
  ],
  dataSnapshot: null, headerSnapshot: [['Name', 'Amount']],
  rowFilter: { removeEmptyRows: true, emptyCellConditions: { fullyStruck: false }, condition: { type: 'rule', column: 'amount', operator: 'eq', value: 'Y' } },
  computedProperties: [{ id: 'p', label: 'total', expression: 'amount * 2' }],
}

describe('range reset migration', () => {
  it('matches by normalized header before position and reports unmatched references', () => {
    const next = prepareBlockRangeUpdate(block, { workbookId: 'book', activeSheet: 'New', range }, [['Amount', 'Name'], ['Y', 'Ada']], 'preserve')
    expect(next.update.columns.map(column => column.key)).toEqual(['amount', 'customer'])
    expect(next.update.columns[0].skip).toBe(true)
    expect(next.impact.unmatchedColumns).toEqual([])
  })

  it('regenerates columns and lists configuration that needs attention', () => {
    const next = prepareBlockRangeUpdate(block, { workbookId: 'book', activeSheet: 'New', range }, [['New field', 'Other'], ['x', 'y']], 'regenerate')
    expect(next.update.columns.map(column => column.key)).toEqual(['new_field', 'other'])
    expect(next.impact.unmatchedColumns).toEqual(['customer', 'amount'])
    expect(next.impact.affectedReferences).toEqual(['amount'])
  })
})
