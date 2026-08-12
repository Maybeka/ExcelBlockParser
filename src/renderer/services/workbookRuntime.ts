export interface WorkbookLoadRequest {
  workbookId: string
  path: string
  requestId: number
  sheetName?: string | null
  refresh?: boolean
}

export interface WorkbookRuntimeState {
  paths: Record<string, string>
  openWorkbookIds: string[]
  requestedWorkbook: WorkbookLoadRequest | null
  loadedWorkbookId: string | null
  loadGeneration: number
  requestSequence: number
  closeSignal: number
}

export interface WorkbookDetachPlan {
  state: WorkbookRuntimeState
  nextActiveWorkbookId: string | null
  shouldCloseCanvas: boolean
}

export function createWorkbookRuntimeState(): WorkbookRuntimeState {
  return {
    paths: {},
    openWorkbookIds: [],
    requestedWorkbook: null,
    loadedWorkbookId: null,
    loadGeneration: 0,
    requestSequence: 0,
    closeSignal: 0,
  }
}

export function resetWorkbookRuntime(state: WorkbookRuntimeState): WorkbookRuntimeState {
  return {
    ...createWorkbookRuntimeState(),
    loadGeneration: state.loadGeneration + 1,
    requestSequence: state.requestSequence,
    closeSignal: state.closeSignal + 1,
  }
}

export function beginWorkbookProjectLoad(state: WorkbookRuntimeState): WorkbookRuntimeState {
  return resetWorkbookRuntime(state)
}

export function authorizeWorkbookPath(state: WorkbookRuntimeState, workbookId: string, path: string): WorkbookRuntimeState {
  return { ...state, paths: { ...state.paths, [workbookId]: path } }
}

export function requestWorkbookLoad(
  state: WorkbookRuntimeState,
  workbookId: string,
  path: string,
  sheetName?: string | null,
): WorkbookRuntimeState {
  const requestSequence = state.requestSequence + 1
  return {
    ...authorizeWorkbookPath(state, workbookId, path),
    requestSequence,
    requestedWorkbook: { workbookId, path, requestId: requestSequence, sheetName },
  }
}

export function requestWorkbookRefresh(
  state: WorkbookRuntimeState,
  workbookId: string,
  path: string,
  sheetName?: string | null,
): WorkbookRuntimeState {
  const requested = requestWorkbookLoad(state, workbookId, path, sheetName)
  return {
    ...requested,
    requestedWorkbook: requested.requestedWorkbook
      ? { ...requested.requestedWorkbook, refresh: true }
      : null,
  }
}

export function shouldRequestWorkbookLoad(
  state: WorkbookRuntimeState,
  activeWorkbookId: string | null,
  targetWorkbookId: string,
): boolean {
  if (targetWorkbookId !== activeWorkbookId) return true
  return state.loadedWorkbookId !== targetWorkbookId
    && state.requestedWorkbook?.workbookId !== targetWorkbookId
}

export function completeWorkbookLoad(state: WorkbookRuntimeState, workbookId: string, path: string): WorkbookRuntimeState {
  return {
    ...authorizeWorkbookPath(state, workbookId, path),
    openWorkbookIds: state.openWorkbookIds.includes(workbookId)
      ? state.openWorkbookIds
      : [...state.openWorkbookIds, workbookId],
  }
}

export function setLoadedWorkbook(state: WorkbookRuntimeState, workbookId: string | null): WorkbookRuntimeState {
  return { ...state, loadedWorkbookId: workbookId }
}

export function replaceAvailableWorkbooks(
  state: WorkbookRuntimeState,
  paths: Record<string, string>,
  openWorkbookIds: string[],
  activeWorkbookId: string | null,
  activeSheetName?: string | null,
): WorkbookRuntimeState {
  let next: WorkbookRuntimeState = { ...state, paths: { ...paths }, openWorkbookIds: [...openWorkbookIds] }
  if (activeWorkbookId && paths[activeWorkbookId]) {
    next = requestWorkbookLoad(next, activeWorkbookId, paths[activeWorkbookId], activeSheetName)
  }
  return next
}

export function detachWorkbookRuntime(
  state: WorkbookRuntimeState,
  workbookId: string,
  activeWorkbookId: string | null,
  sheetNameFor: (workbookId: string) => string | null | undefined,
): WorkbookDetachPlan {
  const paths = { ...state.paths }
  delete paths[workbookId]
  const openWorkbookIds = state.openWorkbookIds.filter(id => id !== workbookId)
  const wasActive = workbookId === activeWorkbookId
  const wasRequested = state.requestedWorkbook?.workbookId === workbookId
  const wasLoaded = state.loadedWorkbookId === workbookId
  const nextActiveWorkbookId = wasActive ? openWorkbookIds[0] ?? null : activeWorkbookId
  const needsCanvasReplacement = wasActive || wasRequested || wasLoaded
  let next: WorkbookRuntimeState = {
    ...state,
    paths,
    openWorkbookIds,
    loadedWorkbookId: state.loadedWorkbookId === workbookId ? null : state.loadedWorkbookId,
  }
  if (needsCanvasReplacement && nextActiveWorkbookId && paths[nextActiveWorkbookId]) {
    next = requestWorkbookLoad(next, nextActiveWorkbookId, paths[nextActiveWorkbookId], sheetNameFor(nextActiveWorkbookId))
  } else if (needsCanvasReplacement) {
    next = { ...next, requestedWorkbook: null, closeSignal: next.closeSignal + 1 }
  }
  return { state: next, nextActiveWorkbookId, shouldCloseCanvas: needsCanvasReplacement && !nextActiveWorkbookId }
}

export function isCurrentWorkbookLoad(state: WorkbookRuntimeState, generation: number): boolean {
  return state.loadGeneration === generation
}
