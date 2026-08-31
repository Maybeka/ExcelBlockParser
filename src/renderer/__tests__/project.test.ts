import { describe, expect, it } from 'vitest'
import { parseProjectWorkbooks } from '../services/extraction'
import { loadProject, serializeProject } from '../services/serializer'
import { validateBlocks } from '../features/extraction/validation'
import { blocksForWorkbook, moveBlock, removeBlock } from '../features/extraction/model'
import { moveRegion } from '../features/regions/model'
import { builtInFeatureRegistry } from '../features/builtinRegistry'
import type { BlockConfig, ProjectConfig } from '../types'
import type { WorkbookReader } from '../services/workbook'
import {
  applyProjectCommand,
  activateProjectWorkbook,
  addProjectWorkbook,
  createProject,
  projectJsonFileName,
  projectNameFromJsonPath,
  reassignProjectWorkbook,
  rejectProjectCommand,
  recordProjectWorkbookLoaded,
  removeProjectWorkbook,
  setActiveWorkbookSheet,
} from '../services/project'

const range = { startRow: 0, startCol: 0, endRow: 1, endCol: 0, a1Notation: 'A1:A2' }
const block = (id: string, workbookId: string | null): BlockConfig => ({
  id, label: 'records', workbookId, range, activeSheet: 'Sheet1', headerRows: [0],
  collapsed: false, selectionLocked: false, dataSnapshot: null,
  columns: [{ colIndex: 0, colLetter: 'A', suggestedKey: 'name', key: 'name', type: 'string', skip: false, valueMap: [] }],
})

function workbook(value: string): WorkbookReader {
  const sheet = { name: 'Sheet1', getValues: () => [['name'], [value]], getValuesByA1: () => [['name'], [value]], getMergedRanges: () => [] }
  return { sheetNames: () => ['Sheet1'], getActiveSheet: () => sheet, getSheet: (name) => name === 'Sheet1' ? sheet : null }
}

describe('project workspace', () => {
  it('keeps a new project free of extraction items', () => {
    const project = builtInFeatureRegistry.initialize(createProject())
    expect(project.workbooks).toEqual([])
    expect(project.blocks).toEqual([])
    expect(project.activeBlockId).toBe('')
    expect(project.activeWorkbookId).toBeNull()
  })

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

  it('rejects legacy session versions explicitly', () => {
    expect(loadProject({ version: 2 }).errors).toEqual(['Invalid project file: unsupported project version.'])
    expect(loadProject({ version: 1 }).errors).toEqual(['Invalid project file: unsupported project version.'])
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

  it('validates row filters and downstream output metadata before save or run', () => {
    const configured = block('configured', 'sales')
    configured.rowFilter = {
      removeEmptyRows: true,
      emptyCellConditions: { fullyStruck: true },
      condition: { type: 'rule', column: 'missing', operator: 'regex', value: '[' },
    }
    configured.computedProperties = [{ id: 'computed', label: 'name', expression: "row['missing']" }]
    const errors = validateBlocks([configured]).join(' ')
    expect(errors).toContain('references unavailable column "missing"')
    expect(errors).toContain('invalid regular expression')
    expect(errors).toContain('Duplicate output key')
    expect(errors).toContain("Unknown key: 'missing'")
  })

  it('keeps other workbooks when deleting the last block of one workbook', () => {
    const sales = block('sales-block', 'sales')
    const costs = block('costs-block', 'costs')
    const project = { ...createProject(), workbooks: [{ id: 'sales', name: 'sales.xlsx' }, { id: 'costs', name: 'costs.xlsx' }], activeWorkbookId: 'sales', blocks: [sales, costs], activeBlockId: sales.id }
    const result = removeBlock(project, sales.id)
    expect(result.blocks[0]).toBe(costs)
    expect(blocksForWorkbook(result, 'sales')).toHaveLength(0)
    expect(result.activeBlockId).toBe('')
  })

  it('preserves the active block when deleting a different block', () => {
    const active = block('active', 'sales')
    const removed = block('removed', 'sales')
    const project = { ...createProject(), blocks: [active, removed], activeBlockId: active.id }
    expect(removeBlock(project, removed.id).activeBlockId).toBe(active.id)
  })

  it('adds and reassigns configured workbook sources without changing scenario state', () => {
    const initial = builtInFeatureRegistry.initialize(createProject())
    const added = addProjectWorkbook(initial, { id: 'sales', name: 'sales.xlsx', sourcePath: 'old/sales.xlsx' })
    expect(added.workbooks).toEqual([{ id: 'sales', name: 'sales.xlsx', sourcePath: 'old/sales.xlsx' }])
    expect(addProjectWorkbook(added, { id: 'duplicate-name', name: 'sales.xlsx' })).toBe(added)

    const reassigned = reassignProjectWorkbook(added, 'sales', 'sales-v2.xlsx', 'new/sales-v2.xlsx')
    expect(reassigned.workbooks[0]).toMatchObject({ id: 'sales', name: 'sales-v2.xlsx', sourcePath: 'new/sales-v2.xlsx' })
    expect(reassigned.blocks).toEqual(initial.blocks)
  })

  it('records workbook loading without changing configured blocks', () => {
    const draft = { ...block('draft', 'placeholder'), workbookId: null }
    const costs = block('costs-block', 'costs')
    const project: ProjectConfig = {
      id: 'project-1', name: 'Loading',
      workbooks: [{ id: 'sales', name: 'sales.xlsx' }, { id: 'costs', name: 'costs.xlsx' }],
      activeWorkbookId: null, blocks: [draft, costs], regions: [], activeBlockId: 'draft', activeRegionId: null,
      focusMode: 'always-editable',
    }
    const loaded = recordProjectWorkbookLoaded(project, {
      workbookId: 'sales', fileName: 'selected-name.xlsx', filePath: '/data/sales.xlsx',
      sheetNames: ['Orders', 'Summary'], activeSheetName: 'Summary',
    }, builtInFeatureRegistry)

    expect(loaded.workbooks[0]).toMatchObject({
      id: 'sales', name: 'sales.xlsx', sourcePath: '/data/sales.xlsx',
      sheetNames: ['Orders', 'Summary'], activeSheetName: 'Summary',
    })
    expect(loaded.blocks.map(item => [item.id, item.workbookId])).toEqual([
      ['draft', null], ['costs-block', 'costs'],
    ])
    expect(loaded.activeWorkbookId).toBe('sales')
    expect(loaded.activeBlockId).toBe('draft')
  })

  it('preserves a cross-workbook block selection when the target workbook finishes loading', () => {
    const sales = block('sales-block', 'sales')
    const costs = block('costs-block', 'costs')
    const project: ProjectConfig = {
      id: 'project-1', name: 'Cross workbook selection',
      workbooks: [{ id: 'sales', name: 'sales.xlsx' }, { id: 'costs', name: 'costs.xlsx' }],
      activeWorkbookId: 'costs', blocks: [sales, costs], regions: [], activeBlockId: costs.id, activeRegionId: null,
      focusMode: 'always-editable',
    }

    const loaded = recordProjectWorkbookLoaded(project, {
      workbookId: 'costs', fileName: 'costs.xlsx', filePath: '/data/costs.xlsx',
      sheetNames: ['Sheet1'], activeSheetName: 'Sheet1',
    }, builtInFeatureRegistry)

    expect(loaded.activeWorkbookId).toBe('costs')
    expect(loaded.activeBlockId).toBe(costs.id)
  })

  it('does not create a block when a workbook is loaded', () => {
    const project: ProjectConfig = {
      id: 'project-1', name: 'Loading', workbooks: [{ id: 'sales', name: 'sales.xlsx' }],
      activeWorkbookId: null, blocks: [], regions: [], activeBlockId: '', activeRegionId: null,
      focusMode: 'always-editable',
    }
    const loaded = recordProjectWorkbookLoaded(project, {
      workbookId: 'sales', fileName: 'sales.xlsx', filePath: '/data/sales.xlsx',
      sheetNames: ['Sheet1'], activeSheetName: 'Sheet1',
    }, builtInFeatureRegistry)
    expect(loaded.blocks).toEqual([])
    expect(loaded.activeBlockId).toBe('')
  })

  it('switches workbook and sheet without replacing global extraction selections', () => {
    const project: ProjectConfig = {
      id: 'project-1', name: 'Switching',
      workbooks: [
        { id: 'sales', name: 'sales.xlsx', activeSheetName: 'Orders' },
        { id: 'costs', name: 'costs.xlsx', activeSheetName: 'Costs' },
      ],
      activeWorkbookId: 'sales', blocks: [block('sales-block', 'sales'), block('costs-block', 'costs')], regions: [],
      activeBlockId: 'sales-block', activeRegionId: 'stale-region', focusMode: 'always-editable',
    }
    const switched = activateProjectWorkbook(project, 'costs', builtInFeatureRegistry, 'Summary')
    expect(switched.activeWorkbookId).toBe('costs')
    expect(switched.activeBlockId).toBe('sales-block')
    expect(switched.activeRegionId).toBe('stale-region')
    expect(switched.workbooks.find(item => item.id === 'costs')?.activeSheetName).toBe('Summary')

    const sheetChanged = setActiveWorkbookSheet(switched, 'Detail')
    expect(sheetChanged.workbooks.find(item => item.id === 'costs')?.activeSheetName).toBe('Detail')
    expect(activateProjectWorkbook(sheetChanged, 'missing', builtInFeatureRegistry)).toBe(sheetChanged)
  })

  it('removes a workbook and all of its owned state without disturbing the remaining workbook', () => {
    const project: ProjectConfig = {
      id: 'project-1', name: 'Removal',
      workbooks: [{ id: 'sales', name: 'sales.xlsx' }, { id: 'costs', name: 'costs.xlsx' }],
      activeWorkbookId: 'sales', blocks: [block('sales-block', 'sales'), block('costs-block', 'costs')],
      regions: [{ id: 'sales-region', label: 'sales', workbookId: 'sales', range: null, activeSheet: null, splitRules: [], blocks: [], collapsed: false, selectionLocked: false }],
      activeBlockId: 'sales-block', activeRegionId: 'sales-region', focusMode: 'always-editable',
    }
    const detached = removeProjectWorkbook(project, 'sales', builtInFeatureRegistry)
    expect(detached.activeWorkbookId).toBeNull()
    expect(detached.activeBlockId).toBe('')

    const removed = removeProjectWorkbook(project, 'sales', builtInFeatureRegistry, 'costs')
    expect(removed.workbooks.map(item => item.id)).toEqual(['costs'])
    expect(removed.blocks.map(item => item.id)).toEqual(['costs-block'])
    expect(removed.regions).toEqual([])
    expect(removed.activeWorkbookId).toBe('costs')
    expect(removed.activeBlockId).toBe('')
    expect(removed.activeRegionId).toBeNull()
  })

  it('preserves active selections when removing a different workbook', () => {
    const project: ProjectConfig = {
      id: 'project-1', name: 'Removal',
      workbooks: [{ id: 'sales', name: 'sales.xlsx' }, { id: 'costs', name: 'costs.xlsx' }],
      activeWorkbookId: 'sales',
      blocks: [block('sales-first', 'sales'), block('sales-active', 'sales'), block('costs-block', 'costs')],
      regions: [{ id: 'sales-region', label: 'sales', workbookId: 'sales', range: null, activeSheet: null, splitRules: [], blocks: [], collapsed: false, selectionLocked: false }],
      activeBlockId: 'sales-active', activeRegionId: 'sales-region', focusMode: 'always-editable',
    }
    const removed = removeProjectWorkbook(project, 'costs', builtInFeatureRegistry)
    expect(removed.activeWorkbookId).toBe('sales')
    expect(removed.activeBlockId).toBe('sales-active')
    expect(removed.activeRegionId).toBe('sales-region')
  })

  it('normalizes only invalid transient ownership and active pointers before saving', () => {
    const owned = block('owned', 'sales')
    const draft = { ...block('draft', 'placeholder'), workbookId: null }
    const project: ProjectConfig = {
      id: 'project-1', name: 'Save', workbooks: [{ id: 'sales', name: 'sales.xlsx' }],
      activeWorkbookId: 'sales', blocks: [draft, owned],
      regions: [{ id: 'draft-region', label: 'draft', workbookId: null, range: null, activeSheet: null, splitRules: [], blocks: [], collapsed: false, selectionLocked: false }],
      activeBlockId: 'draft', activeRegionId: 'draft-region', focusMode: 'always-editable',
    }
    const prepared = builtInFeatureRegistry.prepareForSave(project)
    expect(prepared.blocks).toEqual([owned])
    expect(prepared.regions).toEqual([])
    expect(prepared.activeBlockId).toBe('owned')
    expect(prepared.activeRegionId).toBeNull()
  })

  it('reorders blocks in project-wide navigation order', () => {
    const salesA = block('sales-a', 'sales')
    const costsA = block('costs-a', 'costs')
    const salesB = block('sales-b', 'sales')
    const costsB = block('costs-b', 'costs')
    const project = { ...createProject(), blocks: [salesA, costsA, salesB, costsB] }
    expect(moveBlock(project, salesB.id, -1).blocks.map(item => item.id))
      .toEqual(['sales-a', 'sales-b', 'costs-a', 'costs-b'])
    expect(moveBlock(project, salesA.id, -1)).toBe(project)
  })

  it('reorders regions in project-wide navigation order', () => {
    const region = (id: string, workbookId: string) => ({
      id, label: id, workbookId, range: null, activeSheet: null, splitRules: [], blocks: [], collapsed: false, selectionLocked: false,
    })
    const project = { ...createProject(), regions: [region('sales-a', 'sales'), region('costs-a', 'costs'), region('sales-b', 'sales')] }
    expect(moveRegion(project, 'sales-b', -1).regions.map(item => item.id))
      .toEqual(['sales-a', 'sales-b', 'costs-a'])
    expect(moveRegion(project, 'sales-a', -1)).toBe(project)
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

  it('reports changed, unchanged, and rejected command outcomes explicitly', () => {
    const project = builtInFeatureRegistry.initialize(createProject())
    expect(applyProjectCommand(project, current => current).status).toBe('unchanged')
    expect(applyProjectCommand(project, current => ({ ...current, name: 'Renamed' })).status).toBe('changed')
    expect(rejectProjectCommand(project, 'Workbook is unavailable')).toMatchObject({ status: 'rejected', reason: 'Workbook is unavailable' })
  })
})
