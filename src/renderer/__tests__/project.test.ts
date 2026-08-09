import { describe, expect, it } from 'vitest'
import { parseProjectWorkbooks } from '../services/extraction'
import { loadProject, serializeProject } from '../services/serializer'
import { validateBlocks } from '../components/ConfigPanel'
import type { BlockConfig, ProjectConfig } from '../types'
import type { WorkbookReader } from '../services/workbook'
import { moveItemWithinWorkbook, projectJsonFileName, projectNameFromJsonPath, removeBlockForWorkbook } from '../services/project'

const range = { startRow: 0, startCol: 0, endRow: 1, endCol: 0, a1Notation: 'A1:A2' }
const block = (id: string, workbookId: string): BlockConfig => ({
  id, label: 'records', workbookId, range, activeSheet: 'Sheet1', headerRows: [0],
  collapsed: false, selectionLocked: false, dataSnapshot: null,
  columns: [{ colIndex: 0, colLetter: 'A', suggestedKey: 'name', key: 'name', type: 'string', skip: false, valueMap: [] }],
})

function workbook(value: string): WorkbookReader {
  const sheet = { name: 'Sheet1', getValues: () => [['name'], [value]], getMergedRanges: () => [] }
  return { sheetNames: () => ['Sheet1'], getActiveSheet: () => sheet, getSheet: (name) => name === 'Sheet1' ? sheet : null }
}

describe('project workspace', () => {
  it('derives project names and export file names from the same base name', () => {
    expect(projectNameFromJsonPath('/projects/Sales review.json')).toBe('Sales review')
    expect(projectNameFromJsonPath('C:\\projects\\Sales review.JSON')).toBe('Sales review')
    expect(projectJsonFileName('Sales review')).toBe('Sales review.json')
    expect(projectJsonFileName('Sales review.json')).toBe('Sales review.json')
    expect(projectJsonFileName('   ')).toBe('Untitled project.json')
  })

  it('round-trips workbook mappings and configured source paths', () => {
    const project: ProjectConfig = {
      id: 'project-1', name: 'Two sources',
      workbooks: [{ id: 'sales', name: 'sales.xlsx', sourcePath: 'sources/sales.xlsx', sheetNames: ['Orders', 'Summary'], activeSheetName: 'Summary' }, { id: 'costs', name: 'costs.xlsx', sourcePath: 'D:\\projects\\costs.xlsx', sheetNames: ['Costs'], activeSheetName: 'Costs' }],
      activeWorkbookId: 'sales', blocks: [block('sales-block', 'sales'), block('costs-block', 'costs')], regions: [],
      activeBlockId: 'sales-block', activeRegionId: null, focusMode: 'always-editable',
    }
    const exported = serializeProject(project, null)
    const loaded = loadProject(exported)
    expect(exported.version).toBe(3)
    expect(JSON.stringify(exported)).not.toContain('filePath')
    expect(loaded.project?.project.workbooks.map(item => item.sourcePath)).toEqual(['sources/sales.xlsx', 'D:\\projects\\costs.xlsx'])
    expect(loaded.project?.project.blocks.map(item => item.workbookId)).toEqual(['sales', 'costs'])
    expect(loaded.project?.project.workbooks[0].sheetNames).toEqual(['Orders', 'Summary'])
    expect(loaded.project?.project.workbooks[0].activeSheetName).toBe('Summary')
  })

  it('migrates legacy sessions into a project with an attachable workbook', () => {
    const loaded = loadProject({ version: 2, sourceFileName: 'legacy.xlsx', exportedAt: '', config: { blocks: [block('legacy-block', 'ignored')], regions: [], activeBlockId: 'legacy-block', focusMode: 'always-editable' }, data: {}, blockResults: [] })
    expect(loaded.migratedFrom).toBe(2)
    expect(loaded.project?.project.workbooks).toEqual([{ id: 'workbook-legacy', name: 'legacy.xlsx' }])
    expect(loaded.project?.project.blocks[0].workbookId).toBe('workbook-legacy')
  })

  it('rejects persisted project items without a valid workbook mapping', () => {
    const invalid = loadProject({
      version: 3, exportedAt: '', project: {
        id: 'project-1', name: 'Invalid', workbooks: [{ id: 'sales', name: 'sales.xlsx' }], activeWorkbookId: 'sales',
        blocks: [{ ...block('unmapped', 'sales'), workbookId: null }], regions: [], activeBlockId: 'unmapped', activeRegionId: null, focusMode: 'always-editable',
      }, data: {}, blockResults: [],
    })
    expect(invalid.errors.join(' ')).toContain('has no workbook mapping')
  })

  it('rejects an active item that belongs to another workbook', () => {
    const invalid = loadProject({
      version: 3, exportedAt: '', project: {
        id: 'project-1', name: 'Invalid selection',
        workbooks: [{ id: 'sales', name: 'sales.xlsx' }, { id: 'costs', name: 'costs.xlsx' }],
        activeWorkbookId: 'sales', blocks: [block('costs-block', 'costs')], regions: [],
        activeBlockId: 'costs-block', activeRegionId: null, focusMode: 'always-editable',
      }, data: {}, blockResults: [],
    })
    expect(invalid.errors.join(' ')).toContain('active block does not belong')
  })

  it('parses mapped workbooks independently and preserves duplicate labels', () => {
    const execution = parseProjectWorkbooks(new Map([['sales', workbook('Alice')], ['costs', workbook('Bob')]]), [block('sales-block', 'sales'), block('costs-block', 'costs')], [])
    expect(execution.result.success).toBe(true)
    expect(execution.result.data).toEqual({ sales: { records: [{ name: 'Alice' }] }, costs: { records: [{ name: 'Bob' }] } })
    expect(execution.result.blocks.map(item => item.workbookId)).toEqual(['sales', 'costs'])
  })

  it('allows a block label to be reused by different project workbooks', () => {
    expect(validateBlocks([block('sales-block', 'sales'), block('costs-block', 'costs')])).toEqual([])
    expect(validateBlocks([block('first', 'sales'), block('second', 'sales')]).join(' ')).toContain('Duplicate block name')
  })

  it('keeps other workbooks when deleting the last block of one workbook', () => {
    const sales = block('sales-block', 'sales')
    const costs = block('costs-block', 'costs')
    const fallback = block('sales-fallback', 'sales')
    const result = removeBlockForWorkbook([sales, costs], sales.id, 'sales', () => fallback)
    expect(result.blocks).toEqual([costs, fallback])
    expect(result.activeBlockId).toBe(fallback.id)
  })

  it('reorders blocks only within their workbook', () => {
    const salesA = block('sales-a', 'sales')
    const costsA = block('costs-a', 'costs')
    const salesB = block('sales-b', 'sales')
    const costsB = block('costs-b', 'costs')
    expect(moveItemWithinWorkbook([salesA, costsA, salesB, costsB], salesB.id, -1).map(item => item.id))
      .toEqual(['sales-b', 'costs-a', 'sales-a', 'costs-b'])
    expect(moveItemWithinWorkbook([salesA, costsA, salesB, costsB], salesA.id, -1))
      .toEqual([salesA, costsA, salesB, costsB])
  })

  it('rejects duplicate project item IDs during import', () => {
    const invalid = loadProject({
      version: 3, project: {
        id: 'project-1', name: 'Duplicate IDs', workbooks: [{ id: 'sales', name: 'sales.xlsx' }], activeWorkbookId: 'sales',
        blocks: [block('duplicate', 'sales'), block('duplicate', 'sales')], regions: [], activeBlockId: 'duplicate', activeRegionId: null, focusMode: 'always-editable',
      }, data: {}, blockResults: [],
    })
    expect(invalid.errors).toContain('Invalid project file: duplicate block IDs.')
  })
})
