import { describe, expect, it } from 'vitest'
import type { BlockConfig } from '../types'
import { resetBlockRange } from '../features/extraction/rangeReset'

const block: BlockConfig = {
  id: 'sales', label: 'sales_block', workbookId: 'sales-book', activeSheet: 'Orders',
  range: { startRow: 0, startCol: 0, endRow: 5, endCol: 2, a1Notation: 'A1:C6' },
  headerRows: [0], collapsed: false, selectionLocked: true,
  columns: [{ colIndex: 0, colLetter: 'A', suggestedKey: 'name', key: 'name', type: 'string', skip: false, valueMap: [] }],
  dataSnapshot: [['Name'], ['Ada']], tags: [{ type: 'label', key: 'customer' }],
  rowFilter: { removeEmptyRows: true, emptyCellConditions: { fullyStruck: true }, condition: null },
  computedProperties: [{ id: 'p', label: 'display', expression: 'name' }],
}

describe('block range reset', () => {
  it('changes only the source binding and preserves the full configuration', () => {
    const updated = resetBlockRange(block, {
      workbookId: 'archive-book', activeSheet: 'Archive',
      range: { startRow: 4, startCol: 1, endRow: 9, endCol: 3, a1Notation: 'B5:D10' },
    })

    expect(updated).toMatchObject({ workbookId: 'archive-book', activeSheet: 'Archive', range: { a1Notation: 'B5:D10' } })
    expect(updated.columns).toEqual(block.columns)
    expect(updated.headerRows).toEqual(block.headerRows)
    expect(updated.rowFilter).toEqual(block.rowFilter)
    expect(updated.tags).toEqual(block.tags)
    expect(updated.computedProperties).toEqual(block.computedProperties)
    expect(updated.dataSnapshot).toEqual(block.dataSnapshot)
  })

  it('does not mutate the original block before the reset is applied', () => {
    resetBlockRange(block, { workbookId: 'archive-book', activeSheet: 'Archive', range: null })
    expect(block.workbookId).toBe('sales-book')
    expect(block.activeSheet).toBe('Orders')
    expect(block.range?.a1Notation).toBe('A1:C6')
  })
})
