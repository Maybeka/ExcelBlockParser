import ExcelJS from 'exceljs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadExcelJsWorkbook } from '../services/exceljsWorkbook'
import { parseWorkbook } from '../services/extraction'
import { adaptPreviewData } from '../services/previewDataAdapter'
import { loadProject, serializeProject } from '../services/serializer'
import type { BlockConfig, CellRange, ProjectConfig } from '../types'

const fixture = (name: string) => resolve(process.cwd(), 'examples', name)
const workbookFixtures = ['empty.xlsx', 'm2_integration.xlsx', 'multi_sheet.xlsx', 'test_data.xlsx', 'test_data_v2.xlsx']

function range(a1Notation: string, startRow: number, startCol: number, endRow: number, endCol: number): CellRange {
  return { a1Notation, startRow, startCol, endRow, endCol }
}

function recordsBlock(sourceRange: CellRange, columnCount: number): BlockConfig {
  return {
    id: 'records', label: 'records', workbookId: 'records-workbook', range: sourceRange, activeSheet: 'Records', headerRows: [0],
    collapsed: false, selectionLocked: false, dataSnapshot: null, skipEmptyColumns: false,
    columns: Array.from({ length: columnCount }, (_, colIndex) => ({
      colIndex, colLetter: String.fromCharCode(65 + colIndex), suggestedKey: `column${colIndex + 1}`,
      key: `column${colIndex + 1}`, type: colIndex === 0 ? 'integer' : 'string', skip: false, valueMap: [],
    })),
  }
}

describe('stabilization release candidate', () => {
  it.each(workbookFixtures)('loads tracked workbook fixture %s', async (name) => {
    const workbook = await loadExcelJsWorkbook(await readFile(fixture(name)))
    expect(workbook.sheetNames().length).toBeGreaterThan(0)
    expect(workbook.getActiveSheet()).not.toBeNull()
  })

  it('preserves Project v3 configuration and parsed JSON through a round trip', () => {
    const block = recordsBlock(range('A1:B2', 0, 0, 1, 1), 2)
    const project: ProjectConfig = {
      id: 'release-project', name: 'Release fixture',
      workbooks: [{ id: 'records-workbook', name: 'records.xlsx', sheetNames: ['Records'], activeSheetName: 'Records' }],
      activeWorkbookId: 'records-workbook', blocks: [block], regions: [], activeBlockId: block.id,
      activeRegionId: null, focusMode: 'always-editable',
    }
    const exported = serializeProject(project, {
      success: true,
      data: { 'records-workbook': { records: [{ column1: 7, column2: 'stable' }] } },
      blocks: [{ blockId: block.id, label: block.label, workbookId: 'records-workbook', data: [{ column1: 7, column2: 'stable' }], rowCount: 1 }],
    })

    const restored = loadProject(JSON.parse(JSON.stringify(exported)))
    expect(restored.project?.project.blocks).toEqual([block])
    expect(restored.project?.parseResult).toMatchObject({
      data: { 'records-workbook': { records: [{ column1: 7, column2: 'stable' }] } },
      blocks: [{ blockId: block.id, label: block.label, rowCount: 1 }],
    })
  })

  it('loads and extracts a 50,000-cell workbook within the release threshold', async () => {
    const rowCount = 4_999
    const columnCount = 10
    const source = new ExcelJS.Workbook()
    const sheet = source.addWorksheet('Records')
    sheet.addRow(Array.from({ length: columnCount }, (_, index) => `column${index + 1}`))
    for (let row = 1; row <= rowCount; row++) {
      sheet.addRow(Array.from({ length: columnCount }, (_, column) => column === 0 ? row : `value-${row}-${column}`))
    }

    const input = await source.xlsx.writeBuffer()
    const startedAt = performance.now()
    const workbook = await loadExcelJsWorkbook(input)
    const loadedAt = performance.now()
    const execution = parseWorkbook(workbook, [recordsBlock(range(`A1:J${rowCount + 1}`, 0, 0, rowCount, columnCount - 1), columnCount)], [])
    const parsedAt = performance.now()

    expect(execution.result.success).toBe(true)
    expect(execution.result.blocks[0].rowCount).toBe(rowCount)
    expect((execution.result.data.records as Record<string, unknown>[])[rowCount - 1]).toMatchObject({ column1: rowCount, column10: `value-${rowCount}-9` })
    const preview = adaptPreviewData({ ...recordsBlock(range(`A1:J${rowCount + 1}`, 0, 0, rowCount, columnCount - 1), columnCount), dataSnapshot: null }, execution.result)
    const previewPreparedAt = performance.now()
    const exported = JSON.stringify(execution.result.data)
    const completedAt = performance.now()

    expect(preview.parsedRows).toHaveLength(rowCount)
    expect(exported.length).toBeGreaterThan(0)
    expect(completedAt - startedAt).toBeLessThan(12_000)

    if (process.env.BENCHMARK_PERFORMANCE === '1') {
      console.info(JSON.stringify({
        fixture: '50,000 cells (10 columns x 5,000 rows including header)',
        loadAndConvertMs: Math.round(loadedAt - startedAt),
        parseMs: Math.round(parsedAt - loadedAt),
        previewDataPreparationMs: Math.round(previewPreparedAt - parsedAt),
        exportJsonMs: Math.round(completedAt - previewPreparedAt),
        totalMs: Math.round(completedAt - startedAt),
      }))
    }
  }, 30_000)
})
