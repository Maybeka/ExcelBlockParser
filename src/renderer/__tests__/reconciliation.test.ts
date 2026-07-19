import { describe, expect, it } from 'vitest'
import type { BlockConfig, CellRange, ColumnMapping } from '../types'
import {
  applyRowAdjustFix,
  compareContentSnapshot,
  detectColumnChanges,
  detectColumnRearrangement,
  detectRangeChange,
  detectSheetMismatch,
  detectValueMapConflicts,
  generateColumnIssues,
  generateReconciliationReport,
  generateValueMapIssues,
  runReconciliation,
  suggestRangeReselectFix,
} from '../services/reconciliation'

const range: CellRange = {
  a1Notation: 'A1:B2',
  startRow: 0,
  startCol: 0,
  endRow: 1,
  endCol: 1,
}

const columns: ColumnMapping[] = [
  { colIndex: 0, colLetter: 'A', suggestedKey: 'name', key: 'name', type: 'string', skip: false, valueMap: [] },
  { colIndex: 1, colLetter: 'B', suggestedKey: 'status', key: 'status', type: 'valueMapping', skip: false, valueMap: [{ from: 'old', to: 'archived' }] },
]

const block: BlockConfig = {
  id: 'customers',
  label: 'Customers',
  range,
  activeSheet: 'Customers',
  headerRows: [0],
  collapsed: false,
  selectionLocked: false,
  columns,
  dataSnapshot: [['name', 'status'], ['Ada', 'active']],
}

describe('reconciliation primitives', () => {
  it('distinguishes a missing sheet from an unspecified sheet', () => {
    expect(detectSheetMismatch(null, ['Customers'])).toEqual({ exists: true, suggestion: 'Customers' })
    expect(detectSheetMismatch('Missing', ['Customers'])).toEqual({ exists: false, suggestion: 'Customers' })
    expect(detectSheetMismatch('Customers', ['Customers'])).toEqual({ exists: true })
  })

  it('matches duplicate headers deterministically and reports additions/removals', () => {
    const change = detectColumnChanges([['Name', 'Status', 'Status']], [['Status', 'Name', 'New']])

    expect([...change.matched.entries()]).toEqual([[0, 1], [1, 0]])
    expect(change.removed).toEqual([2])
    expect(change.added).toEqual([2])
    expect(generateColumnIssues(change, 'Customers').map(issue => issue.type)).toEqual([
      'column-removed',
      'column-added',
      'column-shifted',
      'column-shifted',
    ])
  })

  it('reports value-map entries no longer in the source and new unmapped values', () => {
    const conflicts = detectValueMapConflicts(
      { type: 'valueMapping', valueMap: [{ from: 'old', to: 'archived' }, { from: 'active', to: 'current' }] },
      ['active', 'new', 'new'],
    )

    expect(conflicts.unusedEntries).toEqual([{ from: 'old', to: 'archived' }])
    expect(conflicts.newUnmappedValues).toEqual(['new'])
    expect(generateValueMapIssues(conflicts, 'Status').map(issue => issue.type)).toEqual([
      'value-map-unused',
      'value-map-new',
    ])
  })

  it('compares unequal shaped snapshots without mutating either input', () => {
    const snapshot = [['name'], ['Ada']]
    const current = [['name', 'status'], ['Grace', 'active'], ['Lin', 'new']]
    const originalSnapshot = structuredClone(snapshot)
    const originalCurrent = structuredClone(current)

    const diff = compareContentSnapshot(snapshot, current)

    expect(diff).toMatchObject({
      changedRowCount: 3,
      changedColCount: 2,
    })
    expect(diff.changedCells).toHaveLength(5)
    expect(diff.changedCells).toEqual(expect.arrayContaining([
        { row: 0, col: 1, oldValue: undefined, newValue: 'status' },
        { row: 1, col: 0, oldValue: 'Ada', newValue: 'Grace' },
    ]))
    expect(snapshot).toEqual(originalSnapshot)
    expect(current).toEqual(originalCurrent)
  })

  it('creates a range-reselect suggestion without mutating existing column settings', () => {
    const currentColumns = structuredClone(columns)
    const currentSheet = {
      getRange: () => ({ getValues: () => [['status', 'name', 'extra']] }),
    }

    const result = detectRangeChange({ range, columns }, currentSheet)
    const fix = suggestRangeReselectFix({ range, headerRows: [0], columns }, currentSheet, 4, 3)

    expect(result).toMatchObject({ rangeMatch: false, storedRowCount: 2, storedColCount: 2, currentRowCount: 1, currentColCount: 3 })
    expect(fix).toMatchObject({
      type: 'range-reselect',
      autoApply: false,
      data: {
        newRange: { startRow: 0, startCol: 0, endRow: 3, endCol: 2 },
      },
    })
    expect((fix?.data as { remappedColumns: ColumnMapping[] }).remappedColumns.map(column => column.key)).toEqual(['status', 'name', 'column_C'])
    expect(columns).toEqual(currentColumns)
  })

  it('applies a validated row-adjust suggestion without mutating the saved range', () => {
    const original = structuredClone(range)
    const adjusted = applyRowAdjustFix(range, {
      type: 'row-adjust',
      description: 'Adjust range by 2 rows',
      autoApply: false,
      data: { newStartRow: 2, newEndRow: 3, shift: 2 },
    })

    expect(adjusted).toEqual({ ...range, startRow: 2, endRow: 3, a1Notation: 'A3:B4' })
    expect(range).toEqual(original)
    expect(applyRowAdjustFix(range, { type: 'row-adjust', description: '', autoApply: false, data: { newStartRow: -1, newEndRow: 2 } })).toBeNull()
    expect(applyRowAdjustFix(range, { type: 'range-reselect', description: '', autoApply: false, data: {} })).toBeNull()
  })

  it('detects column reordering separately from insertion and deletion', () => {
    expect(detectColumnRearrangement({ columns }, ['status', 'name'])).toEqual({
      columnsReordered: true,
      insertionDetected: false,
      deletionDetected: false,
      shiftDetected: true,
    })
    expect(detectColumnRearrangement({ columns }, ['name', 'status', 'country'])).toMatchObject({
      columnsReordered: true,
      insertionDetected: true,
      deletionDetected: false,
    })
  })

  it('emits a sheet-missing report without attempting sheet reads', () => {
    const report = generateReconciliationReport(
      [block],
      {
        getActiveWorkbook: () => ({
          getSheets: () => [{ getSheetName: () => 'Orders' }],
        }),
      },
    )

    expect(report).toHaveLength(1)
    expect(report[0]).toMatchObject({
      blockId: 'customers',
      status: 'sheet-missing',
      issues: [{ type: 'sheet-missing', severity: 'error' }],
      suggestedFixes: [{ type: 'sheet-remap', autoApply: false }],
    })
  })

  it('runs the UI-facing reconciliation path and suggests a content refresh without mutation', async () => {
    const originalBlock = structuredClone(block)
    const sheet = {
      getRange: () => ({
        getValues: () => [['name', 'status'], ['Ada', 'inactive']],
      }),
    }
    const report = await runReconciliation(
      block,
      {
        getActiveWorkbook: () => ({
          getSheetByName: () => sheet,
          getActiveSheet: () => sheet,
        }),
      },
      ['Customers'],
    )

    expect(report.status).toBe('ok')
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'content-changed', severity: 'warning' }),
    ]))
    expect(report.suggestedFixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'content-update', autoApply: false }),
    ]))
    expect(block).toEqual(originalBlock)
  })

  it('surfaces row shifts and value-map conflicts through the UI-facing report', async () => {
    const shiftedBlock: BlockConfig = {
      ...block,
      dataSnapshot: null,
      headerSnapshot: [['name', 'status']],
    }
    const sheet = {
      getRange: (a1: string) => ({
        getValues: () => {
          if (a1 === 'A1:B1') return [['not', 'the header']]
          if (a1 === 'A3:B3') return [['name', 'status']]
          if (a1 === 'B1:B2') return [['status'], ['active']]
          return [['name', 'status'], ['Ada', 'active']]
        },
      }),
    }

    const report = await runReconciliation(
      shiftedBlock,
      { getActiveWorkbook: () => ({ getSheetByName: () => sheet, getActiveSheet: () => sheet }) },
      ['Customers'],
    )

    expect(report.status).toBe('rows-mismatch')
    expect(report.issues.map(issue => issue.type)).toEqual(expect.arrayContaining([
      'row-shifted',
      'value-map-unused',
      'value-map-new',
    ]))
    expect(report.suggestedFixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'row-adjust', autoApply: false }),
    ]))
  })
})
