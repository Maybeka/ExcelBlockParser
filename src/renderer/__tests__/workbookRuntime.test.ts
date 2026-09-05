import { describe, expect, it } from 'vitest'
import {
  authorizeWorkbookPath,
  beginWorkbookProjectLoad,
  completeWorkbookLoad,
  createWorkbookRuntimeState,
  detachWorkbookRuntime,
  isCurrentWorkbookLoad,
  replaceAvailableWorkbooks,
  requestWorkbookLoad,
  requestWorkbookRefresh,
  setLoadedWorkbook,
  shouldRequestWorkbookLoad,
} from '../services/workbookRuntime'

describe('workbook runtime state', () => {
  it('keeps authorization, attachment, request, and loaded identity separate', () => {
    let state = authorizeWorkbookPath(createWorkbookRuntimeState(), 'sales', '/data/sales.xlsx')
    expect(state.openWorkbookIds).toEqual([])
    state = requestWorkbookLoad(state, 'sales', '/data/sales.xlsx', 'Orders')
    expect(state.requestedWorkbook).toMatchObject({ workbookId: 'sales', requestId: 1, sheetName: 'Orders' })
    state = completeWorkbookLoad(state, 'sales', '/data/sales.xlsx')
    state = setLoadedWorkbook(state, 'sales')
    expect(state.openWorkbookIds).toEqual(['sales'])
    expect(state.loadedWorkbookId).toBe('sales')
  })

  it('invalidates stale async project loads', () => {
    const first = beginWorkbookProjectLoad(createWorkbookRuntimeState())
    expect(first.projectLoading).toBe(true)
    const generation = first.loadGeneration
    const second = beginWorkbookProjectLoad(first)
    expect(isCurrentWorkbookLoad(second, generation)).toBe(false)
    expect(isCurrentWorkbookLoad(second, second.loadGeneration)).toBe(true)
  })

  it('does not request an already loaded or in-flight active workbook again', () => {
    let state = requestWorkbookLoad(createWorkbookRuntimeState(), 'sales', '/sales.xlsx')
    expect(shouldRequestWorkbookLoad(state, 'sales', 'sales')).toBe(false)
    state = setLoadedWorkbook(state, 'sales')
    expect(shouldRequestWorkbookLoad(state, 'sales', 'sales')).toBe(false)
    expect(shouldRequestWorkbookLoad(state, 'sales', 'costs')).toBe(true)
  })

  it('marks an explicit refresh as a new forced request', () => {
    const loaded = setLoadedWorkbook(createWorkbookRuntimeState(), 'sales')
    const refreshed = requestWorkbookRefresh(loaded, 'sales', '/sales.xlsx', 'Orders')
    expect(refreshed.requestedWorkbook).toMatchObject({
      workbookId: 'sales',
      path: '/sales.xlsx',
      sheetName: 'Orders',
      refresh: true,
      requestId: 1,
    })
  })

  it('replaces project availability and requests the preferred attached workbook', () => {
    const state = replaceAvailableWorkbooks(
      beginWorkbookProjectLoad(createWorkbookRuntimeState()),
      { sales: '/sales.xlsx', costs: '/costs.xlsx' },
      ['sales', 'costs'],
      'costs',
      'Summary',
    )
    expect(state.openWorkbookIds).toEqual(['sales', 'costs'])
    expect(state.projectLoading).toBe(false)
    expect(state.requestedWorkbook).toMatchObject({ workbookId: 'costs', path: '/costs.xlsx', sheetName: 'Summary' })
  })

  it('detaches one workbook and requests the next attached workbook when active', () => {
    let state = replaceAvailableWorkbooks(
      createWorkbookRuntimeState(),
      { sales: '/sales.xlsx', costs: '/costs.xlsx' },
      ['sales', 'costs'],
      'sales',
      'Orders',
    )
    state = setLoadedWorkbook(state, 'sales')
    const plan = detachWorkbookRuntime(state, 'sales', 'sales', id => id === 'costs' ? 'Costs' : null)
    expect(plan.nextActiveWorkbookId).toBe('costs')
    expect(plan.state.paths.sales).toBeUndefined()
    expect(plan.state.openWorkbookIds).toEqual(['costs'])
    expect(plan.state.requestedWorkbook).toMatchObject({ workbookId: 'costs', sheetName: 'Costs' })
    expect(plan.shouldCloseCanvas).toBe(false)
  })

  it('closes the canvas only when the detached active workbook has no replacement', () => {
    const attached = completeWorkbookLoad(createWorkbookRuntimeState(), 'sales', '/sales.xlsx')
    const plan = detachWorkbookRuntime(attached, 'sales', 'sales', () => null)
    expect(plan.nextActiveWorkbookId).toBeNull()
    expect(plan.shouldCloseCanvas).toBe(true)
    expect(plan.state.closeSignal).toBe(1)
  })

  it('cancels an in-flight request for an inactive workbook when it is detached', () => {
    let state = replaceAvailableWorkbooks(
      createWorkbookRuntimeState(),
      { sales: '/sales.xlsx', costs: '/costs.xlsx' },
      ['sales', 'costs'],
      'sales',
      'Orders',
    )
    state = setLoadedWorkbook(state, 'sales')
    state = requestWorkbookLoad(state, 'costs', '/costs-v2.xlsx', 'Costs')
    const plan = detachWorkbookRuntime(state, 'costs', 'sales', id => id === 'sales' ? 'Orders' : null)
    expect(plan.nextActiveWorkbookId).toBe('sales')
    expect(plan.state.requestedWorkbook).toMatchObject({ workbookId: 'sales', path: '/sales.xlsx', sheetName: 'Orders' })
    expect(plan.state.paths.costs).toBeUndefined()
  })
})
