import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectColumnChanges } from '../services/reconciliation'
import { loadExcelJsWorkbook } from '../services/exceljsWorkbook'
import { inferColumnType, parseWorkbook, suggestMappingsForWorkbook } from '../services/extraction'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'
import type { BlockConfig, CellRange, RegionConfig } from '../types'

const fixture = (name: string) => resolve(process.cwd(), 'examples', name)
const range = (a1Notation: string, startRow: number, startCol: number, endRow: number, endCol: number): CellRange => ({ a1Notation, startRow, startCol, endRow, endCol })

async function workbook(name: string) {
  return loadExcelJsWorkbook(await readFile(fixture(name)))
}

function block(overrides: Partial<BlockConfig> = {}): BlockConfig {
  return {
    id: 'records', label: 'records', range: range('A2:D5', 1, 0, 4, 3), activeSheet: 'Data', headerRows: [0],
    collapsed: false, selectionLocked: false, dataSnapshot: null, skipEmptyColumns: true,
    columns: [
      { colIndex: 0, colLetter: 'A', suggestedKey: 'name', key: 'name', type: 'string', skip: false, valueMap: [] },
      { colIndex: 1, colLetter: 'B', suggestedKey: 'status', key: 'status', type: 'valueMapping', valueMapFallbackType: 'string', skip: false, valueMap: [{ from: 'active', to: true }, { from: 'inactive', to: false }] },
      { colIndex: 2, colLetter: 'C', suggestedKey: 'count', key: 'count', type: 'integer', skip: false, valueMap: [] },
      { colIndex: 3, colLetter: 'D', suggestedKey: 'unused', key: 'unused', type: 'string', skip: false, valueMap: [] },
    ],
    ...overrides,
  }
}

describe('real Excel workbook extraction', () => {
  it('assigns distinct Univer unit IDs to separate workbook conversions', async () => {
    const [first, second] = await Promise.all([
      readFile(fixture('m2_integration.xlsx')).then(buffer => convertXlsxToWorkbookData(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), 'first.xlsx')),
      readFile(fixture('multi_sheet.xlsx')).then(buffer => convertXlsxToWorkbookData(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), 'second.xlsx')),
    ])
    expect(first.workbookData.id).not.toBe(second.workbookData.id)
    expect(first.workbookData.sheetOrder).not.toEqual(second.workbookData.sheetOrder)
  })

  it('extracts mapped values, ignores empty columns, and preserves merged snapshots', async () => {
    const execution = parseWorkbook(await workbook('m2_integration.xlsx'), [block()], [])
    expect(execution.result.success).toBe(true)
    expect(execution.result.data.records).toEqual([
      { name: 'Alice', status: true, count: 2 },
      { name: 'Bob', status: false, count: 3 },
      { name: '', status: '', count: null },
    ])
    const title = block({ range: range('A1:D2', 0, 0, 1, 3), headerRows: [1] })
    const titleExecution = parseWorkbook(await workbook('m2_integration.xlsx'), [title], [])
    expect(titleExecution.snapshots.get('records')?.[0]).toEqual(['Quarterly report', 'Quarterly report', 'Quarterly report', 'Quarterly report'])
  })

  it('supports multi-sheet extraction and region splitting from .xlsx fixtures', async () => {
    const multi = await workbook('multi_sheet.xlsx')
    const columns = suggestMappingsForWorkbook(multi, range('A1:E11', 0, 0, 10, 4), [0], 'Orders')
    const orders = block({ label: 'orders', activeSheet: 'Orders', range: range('A1:E11', 0, 0, 10, 4), columns })
    const execution = parseWorkbook(multi, [orders], [])
    expect(execution.result.success).toBe(true)
    expect((execution.result.data.orders as Record<string, unknown>[])[0]).toMatchObject({ orderid: 'ORD-001', qty: 3 })
    const regions: RegionConfig[] = [{ id: 'groups', label: 'groups', activeSheet: 'Regions', range: range('A1:B5', 0, 0, 4, 1), splitRules: [{ type: 'emptyRow' }], blocks: [], collapsed: false, selectionLocked: false }]
    const regionExecution = parseWorkbook(await workbook('m2_integration.xlsx'), [block()], regions)
    expect(regionExecution.result.regionResults?.[0].blocks).toHaveLength(2)
  })

  it('infers date columns and emits no rows when every column is skipped', async () => {
    expect(inferColumnType(['2026-07-18', '2026-08-01'])).toBe('date')
    expect(inferColumnType([new Date('2026-07-18'), new Date('2026-08-01')])).toBe('date')
    expect(inferColumnType(['ORD-001', 'ORD-002'])).toBe('string')

    const execution = parseWorkbook(await workbook('m2_integration.xlsx'), [block({
      skipEmptyColumns: false,
      columns: block().columns.map(column => ({ ...column, skip: true })),
    })], [])
    expect(execution.result.data.records).toEqual([])
    expect(execution.result.blocks[0]).toMatchObject({ rowCount: 0, data: [] })
  })

  it('reports invalid templates, missing sheets, and failed conversions deterministically', async () => {
    const invalid = parseWorkbook(await workbook('m2_integration.xlsx'), [block({ columns: [block().columns[0], { ...block().columns[0] }] })], [])
    expect(invalid.result).toMatchObject({ success: false, diagnostics: [{ code: 'duplicate-key', severity: 'error' }] })
    const missing = parseWorkbook(await workbook('m2_integration.xlsx'), [block({ activeSheet: 'Missing' })], [])
    expect(missing.result).toMatchObject({ success: false, diagnostics: [{ code: 'sheet-missing', severity: 'error' }] })
  })

  it('keeps multi-error diagnostic codes and block ordering stable', async () => {
    const input = await workbook('m2_integration.xlsx')
    const invalidRange = block({
      id: 'invalid-range',
      label: 'invalidRange',
      range: range('B2:A1', 1, 1, 0, 0),
    })
    const duplicateKeys = block({
      id: 'duplicate-keys',
      label: 'duplicateKeys',
      columns: [block().columns[0], { ...block().columns[0] }],
    })

    const first = parseWorkbook(input, [invalidRange, duplicateKeys], []).result
    const second = parseWorkbook(input, [invalidRange, duplicateKeys], []).result

    expect(first.success).toBe(false)
    expect(first.diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid-range', severity: 'error', blockId: 'invalid-range' }),
      expect.objectContaining({ code: 'duplicate-key', severity: 'error', blockId: 'duplicate-keys' }),
    ])
    expect(second.diagnostics).toEqual(first.diagnostics)
  })

  it('detects changed-source headers using real v1 and v2 workbooks', async () => {
    const original = await workbook('test_data.xlsx')
    const changed = await workbook('test_data_v2.xlsx')
    const oldHeaders = original.getSheet('Sheet1')!.getValues(range('A1:E1', 0, 0, 0, 4)).map(row => row.map(String))
    const newHeaders = changed.getSheet('Sheet1')!.getValues(range('A4:F4', 3, 0, 3, 5)).map(row => row.map(String))
    const result = detectColumnChanges(oldHeaders, newHeaders)
    expect(result.added).toContain(0)
    expect(result.added).toContain(2)
    expect(result.removed).toContain(2)
  })
})
