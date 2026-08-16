import { describe, expect, it } from 'vitest'
import { builtInFeaturePanelRegistry, builtInFeatureRegistry } from '../features/builtinRegistry'
import { BuiltInFeatureRegistry, type ProjectFeatureModule } from '../features/core/projectFeature'
import type { WorkspaceFeaturePanelContext } from '../features/panel/workspacePanel'
import { createProject } from '../services/project'
import { createUnavailableSpreadsheetCapability } from '../services/spreadsheetCapability'

function noOpModule(id: string, overrides: Partial<ProjectFeatureModule> = {}): ProjectFeatureModule {
  return {
    id,
    schemaVersion: 1,
    initialize: project => project,
    activateWorkbook: project => project,
    workbookLoaded: project => project,
    removeWorkbook: project => project,
    prepareForSave: project => project,
    validate: () => [],
    diagnosticFocus: () => null,
    ...overrides,
  }
}

describe('built-in feature registration', () => {
  it('registers lifecycle and panel contributions for all admitted scenarios', () => {
    const projectIds = builtInFeatureRegistry.definitions().map(module => module.id)
    const panelIds = builtInFeaturePanelRegistry.definitions().map(provider => provider.featureId)
    expect(projectIds).toEqual(['builtin.extraction', 'builtin.regions', 'builtin.external-review'])
    expect(panelIds).toEqual(projectIds)
    expect(builtInFeatureRegistry.definitions().map(module => module.schemaVersion)).toEqual([1, 1, 1])
  })

  it('exposes regions from every workbook and navigates to their owner', () => {
    let project = {
      ...createProject('Cross-workbook regions'),
      workbooks: [
        { id: 'sales', name: 'sales.xlsx', activeSheetName: 'Orders' },
        { id: 'costs', name: 'costs.xlsx', activeSheetName: 'Summary' },
      ],
      activeWorkbookId: 'sales',
      regions: [
        { id: 'sales-region', label: 'Sales', workbookId: 'sales', activeSheet: 'Orders', range: null, splitRules: [], blocks: [], collapsed: false, selectionLocked: false },
        { id: 'costs-region', label: 'Costs', workbookId: 'costs', activeSheet: 'Summary', range: { startRow: 0, startCol: 1, endRow: 4, endCol: 2, a1Notation: 'B1:C5' }, splitRules: [], blocks: [], collapsed: false, selectionLocked: true },
      ],
      activeRegionId: 'sales-region',
      activeBlockId: '',
    }
    const activations: Array<[string, string | undefined]> = []
    const context: WorkspaceFeaturePanelContext = {
      project,
      loadedWorkbookId: 'sales',
      activeColIndex: null,
      parseResult: null,
      spreadsheet: createUnavailableSpreadsheetCapability(['Orders']),
      requestedFeatureId: null,
      transactProject: update => { project = update(project) },
      selectProject: update => { project = update(project) },
      activateWorkbook: (workbookId, sheetName) => { activations.push([workbookId, sheetName]) },
      run: () => undefined,
      setActiveColumn: () => undefined,
      setReconciliationItem: () => undefined,
      takeReselectedRange: () => undefined,
      setPreviewSheet: () => undefined,
    }

    const regions = builtInFeaturePanelRegistry.navigation(context).find(section => section.id === 'builtin.regions')
    expect(regions?.items.map(item => [item.label, item.detail])).toEqual([
      ['Sales', 'sales.xlsx'],
      ['Costs', 'costs.xlsx · Summary!B1:C5'],
    ])

    regions?.items[1].select()
    expect(activations).toEqual([['costs', 'Summary']])
    expect(project.activeRegionId).toBe('costs-region')
    expect(project.activeBlockId).toBe('')
  })

  it('routes selection and active canvas state through the active feature only', () => {
    const range = { startRow: 1, startCol: 1, endRow: 2, endCol: 2, a1Notation: 'B2:C3' }
    const base = {
      ...createProject(),
      workbooks: [{ id: 'book', name: 'book.xlsx' }],
      activeWorkbookId: 'book',
      blocks: [{
        id: 'block', label: 'block', workbookId: 'book', range: null, activeSheet: 'Sheet1', headerRows: [0],
        collapsed: false, selectionLocked: false, columns: [], dataSnapshot: null,
      }],
      regions: [{
        id: 'region', label: 'region', workbookId: 'book', range: null, activeSheet: 'Sheet1', splitRules: [],
        blocks: [], collapsed: false, selectionLocked: false,
      }],
      activeBlockId: 'block',
      activeRegionId: 'region',
    }
    const spreadsheet = createUnavailableSpreadsheetCapability(['Sheet1'])
    const regionSelected = builtInFeatureRegistry.selectionChanged(base, { workbookId: 'book', range, activeSheet: 'Sheet1' }, spreadsheet)
    expect(regionSelected.blocks[0].range).toBeNull()
    expect(regionSelected.regions[0].range).toEqual(range)
    expect(builtInFeatureRegistry.activeCanvasItems(regionSelected)).toEqual(['region'])
    expect(builtInFeatureRegistry.activeColumnItem(regionSelected)).toBeNull()

    const blockActive = { ...regionSelected, activeRegionId: null }
    const blockSelected = builtInFeatureRegistry.selectionChanged(blockActive, { workbookId: 'book', range, activeSheet: 'Sheet1' }, spreadsheet)
    expect(blockSelected.blocks[0].range).toEqual(range)
    expect(builtInFeatureRegistry.activeCanvasItems(blockSelected)).toEqual(['block'])
    expect(builtInFeatureRegistry.activeColumnItem(blockSelected)).toBe('block')
  })

  it('aggregates execution contributions without feature-specific dispatch', async () => {
    const first = noOpModule('first', { execute: () => ({ data: { a: 1 }, resultFields: { blocks: [] } }) })
    const second = noOpModule('second', { execute: () => ({ data: { b: 2 }, resultFields: { regionResults: [] } }) })
    const execution = await new BuiltInFeatureRegistry([first, second]).execute(createProject(), new Map(), new AbortController().signal)
    expect(execution).not.toBeNull()
    if (!execution) return
    expect(execution.result).toMatchObject({ success: true, data: { a: 1, b: 2 }, blocks: [], regionResults: [] })
  })

  it('isolates one feature execution failure as a structured diagnostic', async () => {
    const failing = noOpModule('failing', { execute: () => { throw new Error('bad fixture') } })
    const healthy = noOpModule('healthy', { execute: () => ({ data: { kept: true } }) })
    const execution = await new BuiltInFeatureRegistry([failing, healthy]).execute(createProject(), new Map(), new AbortController().signal)
    expect(execution).not.toBeNull()
    if (!execution) return
    expect(execution.result.data).toEqual({ kept: true })
    expect(execution.result.success).toBe(false)
    expect(execution.result.diagnostics).toEqual([expect.objectContaining({
      code: 'unsupported-content',
      message: 'Feature "failing" failed: bad fixture',
    })])
  })

  it('stops composition when async feature execution is cancelled', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const calls: string[] = []
    const delayed = noOpModule('delayed', {
      execute: async () => { calls.push('delayed'); await pending; return { data: { late: true } } },
    })
    const later = noOpModule('later', { execute: () => { calls.push('later'); return { data: { later: true } } } })
    const controller = new AbortController()
    const execution = new BuiltInFeatureRegistry([delayed, later]).execute(createProject(), new Map(), controller.signal)
    controller.abort()
    release()
    expect(await execution).toBeNull()
    expect(calls).toEqual(['delayed'])
  })

  it('preserves project state when a feature save adapter fails', () => {
    const project = createProject('Stable')
    const registry = new BuiltInFeatureRegistry([
      noOpModule('failing', { prepareForSave: () => { throw new Error('save failed') } }),
      noOpModule('healthy', { prepareForSave: current => ({ ...current, name: 'Prepared' }) }),
    ])
    expect(registry.prepareForSave(project).name).toBe('Prepared')
    expect(project.name).toBe('Stable')
  })

  it('runs lifecycle hooks and activation cleanup through registration order', async () => {
    const events: string[] = []
    const module = (id: string) => noOpModule(id, {
      onProjectOpen: () => { events.push(`${id}:open`) },
      onActivate: () => {
        events.push(`${id}:activate`)
        return () => { events.push(`${id}:cleanup`) }
      },
      onDeactivate: () => { events.push(`${id}:deactivate`) },
      onProjectClose: () => { events.push(`${id}:close`) },
    })
    const registry = new BuiltInFeatureRegistry([module('first'), module('second')])
    const project = createProject()
    await registry.open(project)
    await registry.activate(project)
    await registry.activate(project)
    await registry.close(project)
    expect(events).toEqual([
      'first:open', 'second:open', 'first:activate', 'second:activate',
      'second:cleanup', 'second:deactivate', 'first:cleanup', 'first:deactivate',
      'second:close', 'first:close',
    ])
  })
})
