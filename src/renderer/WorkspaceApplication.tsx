import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import type { SetStateAction } from 'react'
import { Badge, Button, Drawer, Dropdown, Layout, Modal, Splitter, Space, theme, Tooltip, message, Alert, Tabs, Table, Empty } from 'antd'
import { FileExcelOutlined, FolderOpenOutlined, FolderAddOutlined, ImportOutlined, CloseOutlined, DownOutlined, MenuOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SaveOutlined, SettingOutlined, WarningOutlined, UndoOutlined, RedoOutlined } from '@ant-design/icons'
import { SpreadsheetPanel } from './components/SpreadsheetPanel'
import { ConfigPanel, validateBlocks } from './components/ConfigPanel'
import type { CellRange, BlockConfig, ParseResult, ProjectConfig, ProjectWorkbook, RegionConfig, RegionParseResult } from './types'
import type { FocusMode } from './components/ConfigPanel'
import { useUniver } from './context/UniverContext'
import { getBridge } from './services/bridge'
import { recordBridgeFailure, recordParseFailure } from './services/observability'
import { generateColumnMappings, suggestMappingsForWorkbook } from './services/extraction'
import { loadExcelJsWorkbook } from './services/exceljsWorkbook'
import {
  activateProjectWorkbook,
  addProjectWorkbook,
  blocksForWorkbook,
  createInitialProject,
  createProjectWorkbook,
  LEGACY_WORKBOOK_ID,
  moveItemWithinWorkbook,
  reassignProjectWorkbook,
  recordProjectWorkbookLoaded,
  regionsForWorkbook,
  removeBlockForWorkbook,
  removeProjectWorkbook,
  setActiveWorkbookSheet,
} from './services/project'
import { PreviewWindow } from './components/PreviewWindow'
import type { PreviewData } from './types'
import { WorkspaceNavigator } from './components/WorkspaceNavigator'
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer'
import { WorkspaceStateCoordinator, type WorkspaceSnapshot } from './services/workspaceHistory'
import { createUniverSpreadsheetCapability } from './services/spreadsheetCapability'
import {
  beginWorkbookProjectLoad,
  completeWorkbookLoad,
  createWorkbookRuntimeState,
  detachWorkbookRuntime,
  isCurrentWorkbookLoad,
  replaceAvailableWorkbooks,
  requestWorkbookLoad,
  resetWorkbookRuntime,
  setLoadedWorkbook,
  type WorkbookRuntimeState,
} from './services/workbookRuntime'
import { decodeProjectDocument, inspectProjectWorkbookSources, projectRecoveryContent, saveProjectDocument } from './services/projectLifecycle'
import { executeProject } from './services/projectExecution'
import { captureExtractionSnapshots } from './services/extractionPersistence'
import { diagnosticFocusTarget, orderDiagnostics, type DiagnosticFocusTarget } from './services/diagnostics'

let blockCounter = 1
function nextBlockId(): string {
  return `block-${blockCounter++}-${Date.now()}`
}

function createDefaultBlock(lastNum: number, workbookId: string | null = null): BlockConfig {
  const num = lastNum + 1
  return {
    id: nextBlockId(),
    label: `block_${num}`,
    workbookId,
    range: null,
    activeSheet: null,
    headerRows: [0],
    collapsed: false,
    selectionLocked: false,
    columns: [],
    dataSnapshot: null,
  }
}

function resolveState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next
}

export function WorkspaceApplication() {
  const { univerAPI, sheetNames } = useUniver()
  const spreadsheet = useMemo(() => createUniverSpreadsheetCapability(univerAPI, sheetNames), [sheetNames, univerAPI])

  const [project, setProject] = useState<ProjectConfig>(() => {
    return createInitialProject(workbookId => createDefaultBlock(0, workbookId))
  })
  const { blocks, regions, workbooks: projectWorkbooks, activeWorkbookId, activeBlockId, activeRegionId, focusMode } = project
  const setBlocks = useCallback((next: SetStateAction<BlockConfig[]>) => setProject(current => ({ ...current, blocks: resolveState(current.blocks, next) })), [])
  const setRegions = useCallback((next: SetStateAction<RegionConfig[]>) => setProject(current => ({ ...current, regions: resolveState(current.regions, next) })), [])
  const setActiveBlockId = useCallback((next: SetStateAction<string>) => setProject(current => ({ ...current, activeBlockId: resolveState(current.activeBlockId, next) })), [])
  const setActiveRegionId = useCallback((next: SetStateAction<string | null>) => setProject(current => ({ ...current, activeRegionId: resolveState(current.activeRegionId, next) })), [])
  const setFocusMode = useCallback((next: SetStateAction<FocusMode>) => setProject(current => ({ ...current, focusMode: resolveState(current.focusMode, next) })), [])
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [loadSignal, setLoadSignal] = useState(0)
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null)
  const [pendingSaveAs, setPendingSaveAs] = useState(false)
  const [activeColIndex, setActiveColIndex] = useState<number | null>(null)
  const [showImportWarning, setShowImportWarning] = useState(false)
  const [pendingProjectReset, setPendingProjectReset] = useState<'new' | 'close' | null>(null)
  const [pendingImportContent, setPendingImportContent] = useState<string | null>(null)
  const [pendingImportProjectName, setPendingImportProjectName] = useState<string | null>(null)
  const [pendingImportProjectPath, setPendingImportProjectPath] = useState<string | null>(null)
  const [reconcilingBlockId, setReconcilingBlockId] = useState<string | null>(null)
  const reconcilingBlockIdRef = useRef(reconcilingBlockId)
  reconcilingBlockIdRef.current = reconcilingBlockId
  const [reconcilingPreviewSheet, setReconcilingPreviewSheet] = useState<string | null>(null)
  const [reconcilingPreviewRange, setReconcilingPreviewRange] = useState<CellRange | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewModalData, setPreviewModalData] = useState<Map<string, PreviewData>>(new Map())
  const [previewActiveBlockId, setPreviewActiveBlockId] = useState<string>('')
  const [previewRegionResults, setPreviewRegionResults] = useState<RegionParseResult[]>([])
  const [workbookRuntime, setWorkbookRuntime] = useState<WorkbookRuntimeState>(() => createWorkbookRuntimeState())
  const workbookRuntimeRef = useRef(workbookRuntime)
  workbookRuntimeRef.current = workbookRuntime
  const updateWorkbookRuntime = useCallback((update: (current: WorkbookRuntimeState) => WorkbookRuntimeState): WorkbookRuntimeState => {
    const next = update(workbookRuntimeRef.current)
    workbookRuntimeRef.current = next
    setWorkbookRuntime(next)
    return next
  }, [])
  const { requestedWorkbook, loadedWorkbookId, openWorkbookIds, closeSignal } = workbookRuntime
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<string | null>(null)
  const [hasUnsavedChanges, setDirtyState] = useState(false)
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(true)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [recoveryContent, setRecoveryContent] = useState<string | null>(null)
  const [pendingDiagnosticFocus, setPendingDiagnosticFocus] = useState<DiagnosticFocusTarget | null>(null)
  const historyRef = useRef(new WorkspaceStateCoordinator())
  const setHasUnsavedChanges = useCallback((dirty: boolean) => {
    if (dirty) historyRef.current.markDirty()
    else historyRef.current.markSaved()
    setDirtyState(dirty)
  }, [])
  const [historyVersion, setHistoryVersion] = useState(0)
  const executionGenerationRef = useRef(0)
  const pendingReconcilingRangeRef = useRef<{ range: CellRange; activeSheet: string | null } | null>(null)

  const activeBlockIdRef = useRef(activeBlockId)
  activeBlockIdRef.current = activeBlockId
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  const regionsRef = useRef(regions)
  regionsRef.current = regions
  const activeRegionIdRef = useRef(activeRegionId)
  activeRegionIdRef.current = activeRegionId
  const focusModeRef = useRef(focusMode)
  focusModeRef.current = focusMode
  const projectRef = useRef(project)
  projectRef.current = project

  const activeBlocks = useMemo(() => blocksForWorkbook(blocks, activeWorkbookId), [activeWorkbookId, blocks])
  const activeRegions = useMemo(() => regionsForWorkbook(regions, activeWorkbookId), [activeWorkbookId, regions])
  const currentFileName = useMemo(
    () => projectWorkbooks.find(workbook => workbook.id === activeWorkbookId)?.name ?? null,
    [activeWorkbookId, projectWorkbooks],
  )
  const activeSheetName = useMemo(
    () => projectWorkbooks.find(workbook => workbook.id === activeWorkbookId)?.activeSheetName ?? null,
    [activeWorkbookId, projectWorkbooks],
  )
  const setProjectActiveSheet = useCallback((sheetName: string | null) => {
    setProject(current => setActiveWorkbookSheet(current, sheetName))
  }, [])

  const workspaceSnapshot = useCallback((): WorkspaceSnapshot => projectRef.current, [])

  const rememberWorkspace = useCallback(() => {
    historyRef.current.record(workspaceSnapshot())
    setHasUnsavedChanges(true)
    setHistoryVersion(version => version + 1)
  }, [workspaceSnapshot])

  const restoreWorkspace = useCallback((snapshot: WorkspaceSnapshot) => {
    setProject(snapshot)
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [])

  const handleUndo = useCallback(() => {
    const previous = historyRef.current.undo(workspaceSnapshot())
    if (previous) restoreWorkspace(previous.snapshot)
    setHistoryVersion(version => version + 1)
  }, [restoreWorkspace, workspaceSnapshot])

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo(workspaceSnapshot())
    if (next) restoreWorkspace(next.snapshot)
    setHistoryVersion(version => version + 1)
  }, [restoreWorkspace, workspaceSnapshot])

  const applyImportContent = useCallback((content: string, projectName?: string | null, projectPath?: string | null) => {
    const decoded = decodeProjectDocument(content, projectPath ?? null)
    if (decoded.status === 'error') { setImportError(decoded.message); return }
    if (decoded.document.migratedFrom) message.info(`Migrated legacy project file v${decoded.document.migratedFrom} to project v3.`)
    const importedProject = projectName ? { ...decoded.document.project, name: projectName } : decoded.document.project
    const loadingRuntime = updateWorkbookRuntime(beginWorkbookProjectLoad)
    const loadVersion = loadingRuntime.loadGeneration
    setProject(importedProject)
    setProjectFilePath(projectPath ?? null)
    setParseResult(decoded.document.parseResult)

    historyRef.current.reset()
    setHistoryVersion(version => version + 1)
    setHasUnsavedChanges(false)

    void (async () => {
      const availability = await inspectProjectWorkbookSources(
        importedProject,
        path => getBridge().readFile(path),
        loadExcelJsWorkbook,
        () => isCurrentWorkbookLoad(workbookRuntimeRef.current, loadVersion),
      )
      if (!availability) return

      const preferredId = importedProject.activeWorkbookId
      const nextActiveId = preferredId && availability.availableIds.includes(preferredId) ? preferredId : availability.availableIds[0] ?? null
      setProject(current => ({
        ...current,
        workbooks: current.workbooks.map(workbook => availability.metadata.has(workbook.id) ? { ...workbook, ...availability.metadata.get(workbook.id)! } : workbook),
        activeWorkbookId: nextActiveId,
        activeBlockId: blocksForWorkbook(current.blocks, nextActiveId)[0]?.id ?? '',
        activeRegionId: null,
      }))
      updateWorkbookRuntime(current => replaceAvailableWorkbooks(
        current,
        availability.paths,
        availability.availableIds,
        nextActiveId,
        nextActiveId ? availability.metadata.get(nextActiveId)?.activeSheetName : null,
      ))
      if (availability.unavailableIds.length) {
        setProjectSettingsOpen(true)
        message.warning(`${availability.unavailableIds.length} workbook source${availability.unavailableIds.length === 1 ? '' : 's'} could not be opened. Reassign or remove them.`)
      }
    })()
  }, [updateWorkbookRuntime])

  useEffect(() => {
    let active = true
    void getBridge().loadRecovery().then((result) => {
      if (!active || result.status !== 'ok' || !result.value) return
      const content = result.value
      if (decodeProjectDocument(content).status === 'ok') setRecoveryContent(content)
      else void getBridge().clearRecovery()
    }).catch(() => {
      // Recovery is optional; a filesystem issue must not prevent startup.
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const timer = window.setTimeout(() => {
      void getBridge().saveRecovery(projectRecoveryContent(project, parseResult)).then((result) => {
        if (result.status === 'error') console.warn('Unable to save workspace recovery data:', result.error.message)
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [hasUnsavedChanges, parseResult, project])

  const attachWorkbook = useCallback(async () => {
    if (projectRef.current.workbooks.length === 0) {
      message.info('Add workbook sources in Project settings before opening them.')
      setProjectSettingsOpen(true)
      return
    }
    const result = await getBridge().openXlsx()
    if (result.status !== 'ok') return
    const path = result.value
    const name = path.split(/[/\\]/).pop() ?? ''
    const source = projectRef.current.workbooks.find(workbook => workbook.name === name && !workbookRuntimeRef.current.paths[workbook.id])
      ?? projectRef.current.workbooks.find(workbook => workbook.name === name)
      ?? projectRef.current.workbooks.find(workbook => workbook.id === LEGACY_WORKBOOK_ID && !workbookRuntimeRef.current.paths[workbook.id])
    if (!source) {
      message.error(`"${name}" is not a workbook source in this project. Add it in Project settings.`)
      return
    }
    updateWorkbookRuntime(current => requestWorkbookLoad(current, source.id, path, source.activeSheetName))
  }, [updateWorkbookRuntime])

  const handleOpenFile = useCallback(() => { void attachWorkbook() }, [attachWorkbook])

  const handleAddProjectWorkbook = useCallback(async () => {
    const result = await getBridge().openXlsx()
    if (result.status !== 'ok') return
    const path = result.value
    const name = path.split(/[/\\]/).pop() ?? 'workbook.xlsx'
    if (projectRef.current.workbooks.some(workbook => workbook.name === name)) {
      message.warning(`"${name}" is already configured in this project.`)
      return
    }
    const workbook = createProjectWorkbook(name, undefined, path)
    setProject(current => addProjectWorkbook(current, workbook))
    updateWorkbookRuntime(current => requestWorkbookLoad(current, workbook.id, path))
    setHasUnsavedChanges(true)
  }, [updateWorkbookRuntime])

  const handleReassignProjectWorkbook = useCallback(async (workbookId: string) => {
    const result = await getBridge().openXlsx()
    if (result.status !== 'ok') return
    const path = result.value
    const name = path.split(/[/\\]/).pop() ?? 'workbook.xlsx'
    setProject(current => reassignProjectWorkbook(current, workbookId, name, path))
    updateWorkbookRuntime(current => requestWorkbookLoad(current, workbookId, path))
    setHasUnsavedChanges(true)
  }, [updateWorkbookRuntime])

  const detachWorkbook = useCallback((workbookId: string | null = activeWorkbookId) => {
    if (!workbookId) return
    const plan = detachWorkbookRuntime(
      workbookRuntimeRef.current,
      workbookId,
      activeWorkbookId,
      id => projectRef.current.workbooks.find(workbook => workbook.id === id)?.activeSheetName,
    )
    updateWorkbookRuntime(() => plan.state)
    setProject(current => {
      if (workbookId !== activeWorkbookId) return current
      if (plan.nextActiveWorkbookId) return activateProjectWorkbook(current, plan.nextActiveWorkbookId)
      return { ...current, activeWorkbookId: null, activeBlockId: '', activeRegionId: null }
    })
    setParseResult(null)
  }, [activeWorkbookId, updateWorkbookRuntime])

  const handleRemoveProjectWorkbook = useCallback((workbookId: string) => {
    detachWorkbook(workbookId)
    setProject(current => removeProjectWorkbook(current, workbookId))
    setPendingProjectRemoval(null)
    setPendingImportContent(null)
    setPendingImportProjectName(null)
    setShowImportWarning(false)
    setHasUnsavedChanges(true)
  }, [detachWorkbook])

  const handleFileLoaded = useCallback((workbookId: string, fileName: string, filePath: string, loadedSheetNames: string[], loadedActiveSheetName: string | null) => {
    const currentProject = projectRef.current
    const workbook = currentProject.workbooks.find(item => item.id === workbookId)
    if (!workbook) {
      message.error(`"${fileName}" is not configured as a project workbook.`)
      return
    }
    updateWorkbookRuntime(current => completeWorkbookLoad(current, workbook.id, filePath))
    setProject(previous => recordProjectWorkbookLoaded(previous, {
      workbookId,
      fileName,
      filePath,
      sheetNames: loadedSheetNames,
      activeSheetName: loadedActiveSheetName,
    }, ownerId => createDefaultBlock(0, ownerId)))
    setParseResult(null)
  }, [updateWorkbookRuntime])

  const handleSelectWorkbook = useCallback((workbookId: string, sheetName?: string) => {
    const path = workbookRuntimeRef.current.paths[workbookId]
    const workbook = projectRef.current.workbooks.find(item => item.id === workbookId)
    if (!path || !workbook) {
      message.warning(`Open ${workbook?.name ?? 'this workbook'} to attach it to the project.`)
      return
    }
    setProject(current => activateProjectWorkbook(current, workbookId, sheetName))
    updateWorkbookRuntime(current => requestWorkbookLoad(current, workbookId, path, sheetName ?? workbook.activeSheetName))
  }, [updateWorkbookRuntime])

  const handleSelectionChange = useCallback(async (sourceWorkbookId: string, range: CellRange | null, activeSheet: string | null) => {
    if (sourceWorkbookId !== projectRef.current.activeWorkbookId || sourceWorkbookId !== loadedWorkbookId) return
    setProjectActiveSheet(activeSheet)
    const blockId = activeBlockIdRef.current
    const currentBlock = blocksRef.current.find(b => b.id === blockId)
    const regionId = activeRegionIdRef.current
    const currentRegion = regionsRef.current.find(r => r.id === regionId)

    // When reconciling, track selection for Reselect Range even if locked
    if (reconcilingBlockIdRef.current && range) {
      pendingReconcilingRangeRef.current = { range, activeSheet }
    }

    if (range && range.startRow === range.endRow && range.startCol === range.endCol) {
      if (currentRegion?.selectionLocked || currentBlock?.selectionLocked) return
      if (!currentRegion) range = null
    }

    if (range && currentRegion) {
      if (currentRegion.selectionLocked) return
      rememberWorkspace()
      setRegions(prev => prev.map(r =>
        r.id === regionId ? { ...r, range, activeSheet } : r,
      ))
      setParseResult(null)
      return
    }

    if (range && currentBlock?.selectionLocked) return

    if (!range) {
      if (currentBlock?.selectionLocked) return
      if (currentRegion) {
        rememberWorkspace()
        setRegions(prev => prev.map(r =>
          r.id === regionId ? { ...r, range: null } : r,
        ))
        setParseResult(null)
        return
      }
      rememberWorkspace()
      setBlocks(prev => prev.map(b =>
        b.id === blockId ? { ...b, range: null, columns: [] } : b,
      ))
      setParseResult(null)
      return
    }

    const headerRows = currentBlock?.headerRows ?? [0]
    const workbook = spreadsheet.workbookReader()
    const mappings = workbook
      ? suggestMappingsForWorkbook(workbook, range, headerRows, currentBlock?.activeSheet ?? activeSheet)
      : generateColumnMappings(range)

    rememberWorkspace()
    setBlocks(prev => prev.map(b =>
      b.id === blockId ? { ...b, range, activeSheet, columns: mappings } : b,
    ))
    setParseResult(null)
  }, [loadedWorkbookId, spreadsheet])

  const handleActivateBlock = useCallback((blockId: string) => {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (block?.workbookId === loadedWorkbookId && block?.activeSheet && !reconcilingBlockIdRef.current) {
      if (spreadsheet.activeSheetName() !== block.activeSheet) spreadsheet.setActiveSheet(block.activeSheet)
    }
    setProjectActiveSheet(block?.activeSheet ?? null)
    setActiveBlockId(blockId)
    setActiveRegionId(null)
  }, [loadedWorkbookId, spreadsheet])

  const handleReconcilingReselectRange = useCallback((onRange: (range: CellRange) => void) => {
    const pending = pendingReconcilingRangeRef.current
    if (!pending) return
    onRange(pending.range)
    setReconcilingPreviewRange(pending.range)
    if (pending.activeSheet) setReconcilingPreviewSheet(pending.activeSheet)
    pendingReconcilingRangeRef.current = null
  }, [])

  const handleBlockChange = useCallback((blockId: string, partial: Partial<BlockConfig>) => {
    rememberWorkspace()
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, ...partial } : b))
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleAddBlock = useCallback(() => {
    rememberWorkspace()
    const maxNum = blocksRef.current.reduce((max, b) => {
      const m = (b.label || '').match(/^block_(\d+)$/)
      return m ? Math.max(max, parseInt(m[1], 10)) : max
    }, 0)
    const block = createDefaultBlock(maxNum, activeWorkbookId)
    setBlocks(prev => [...prev, block])
    setActiveBlockId(block.id)
    setActiveRegionId(null)
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleDeleteBlock = useCallback((blockId: string) => {
    rememberWorkspace()
    setBlocks(prev => {
      if (!activeWorkbookId) return prev
      const next = removeBlockForWorkbook(prev, blockId, activeWorkbookId, () => createDefaultBlock(0, activeWorkbookId))
      if (!next.blocks.some(block => block.id === activeBlockIdRef.current)) setActiveBlockId(next.activeBlockId)
      return next.blocks
    })
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleAddRegion = useCallback(() => {
    rememberWorkspace()
    const region: RegionConfig = {
      id: `region-${Date.now()}`,
      label: `region_${regions.length + 1}`,
      workbookId: activeWorkbookId,
      range: null,
      activeSheet: null,
      splitRules: [],
      blocks: [],
      collapsed: false,
      selectionLocked: false,
    }
    setRegions(prev => [...prev, region])
    setActiveRegionId(region.id)
    setActiveBlockId('')
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [regions.length, rememberWorkspace])

  const handleDeleteRegion = useCallback((regionId: string) => {
    rememberWorkspace()
    setRegions(prev => prev.filter(r => r.id !== regionId))
    if (activeRegionId === regionId) setActiveRegionId(null)
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [activeRegionId, rememberWorkspace])

  const handleRegionChange = useCallback((regionId: string, partial: Partial<RegionConfig>) => {
    rememberWorkspace()
    setRegions(prev => prev.map(r => r.id === regionId ? { ...r, ...partial } : r))
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleActivateRegion = useCallback((regionId: string) => {
    const region = regionsRef.current.find(item => item.id === regionId)
    if (region?.activeSheet) {
      spreadsheet.setActiveSheet(region.activeSheet)
      setProjectActiveSheet(region.activeSheet)
    }
    setActiveRegionId(regionId)
    setActiveBlockId('')
  }, [spreadsheet])

  const handleSelectSheet = useCallback((sheetName: string) => {
    if (loadedWorkbookId !== projectRef.current.activeWorkbookId) return
    if (!spreadsheet.setActiveSheet(sheetName)) return
    setProjectActiveSheet(sheetName)
  }, [loadedWorkbookId, spreadsheet])

  const handleMoveBlock = useCallback((blockId: string, direction: -1 | 1) => {
    rememberWorkspace()
    setBlocks(current => moveItemWithinWorkbook(current, blockId, direction))
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleMoveRegion = useCallback((regionId: string, direction: -1 | 1) => {
    rememberWorkspace()
    setRegions(current => moveItemWithinWorkbook(current, regionId, direction))
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleFocusModeChange = useCallback((mode: FocusMode) => {
    if (mode === focusModeRef.current) return
    rememberWorkspace()
    setFocusMode(mode)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleRegionRangeClick = useCallback((regionId: string) => {
    const region = regionsRef.current.find(r => r.id === regionId)
    if (!region?.range || region.workbookId !== loadedWorkbookId) return
    if (region.activeSheet) spreadsheet.setActiveSheet(region.activeSheet)
    spreadsheet.scrollTo(region.activeSheet, region.range.startRow - 3, region.range.startCol - 1)
    setActiveRegionId(regionId)
  }, [loadedWorkbookId, spreadsheet])

  const handleParse = useCallback(async () => {
    const clearPreview = () => {
      setPreviewModalOpen(false)
      setPreviewModalData(new Map())
      setPreviewRegionResults([])
      setPreviewActiveBlockId('')
    }
    const configuredBlocks = blocks.filter(b => b.range)
    if (!configuredBlocks.length) {
      const error = 'Select a range for at least one block before parsing'
      clearPreview()
      const result = { success: false, data: {}, blocks: [], error }
      setParseResult(result)
      recordParseFailure('parse-preview', result)
      message.warning(error)
      return
    }

    const generation = ++executionGenerationRef.current
    const execution = await executeProject(
      projectRef.current,
      workbookRuntimeRef.current.paths,
      path => getBridge().readFile(path),
      loadExcelJsWorkbook,
      () => executionGenerationRef.current === generation,
    )
    if (execution.status === 'stale') return
    const result = execution.result
    if (!result.success) {
      clearPreview()
      setParseResult(result)
      recordParseFailure('parse-preview', result)
      setDiagnosticsOpen(true)
      message.error(result.error || 'Parsing could not complete. Review the diagnostics for details.')
      return
    }

    setProject(execution.project)
    setParseResult(result)
    const allPreviewData = new Map([...execution.previews].filter(([id]) => activeBlocks.some(block => block.id === id)))
    setPreviewModalData(allPreviewData)
    setPreviewRegionResults(result.regionResults || [])
    setPreviewActiveBlockId(activeBlockId || activeBlocks[0]?.id || '')
    setPreviewModalOpen(true)
  }, [activeBlocks, blocks, activeBlockId])

  const saveProjectToDisk = useCallback(async (saveAs: boolean) => {
    try {
      const projectForSave = await captureExtractionSnapshots(projectRef.current, projectRef.current.activeWorkbookId, spreadsheet)
      const result = await saveProjectDocument(getBridge(), projectForSave, parseResult, projectFilePath, saveAs)
      if (result.status === 'ok') {
        setProject(result.project)
        setProjectFilePath(result.filePath)
        setHasUnsavedChanges(false)
        historyRef.current.markSaved()
        void getBridge().clearRecovery()
      } else if (result.status === 'error') {
        message.error(result.message || 'Unable to save the project. Your workspace recovery remains available.')
        console.error('Save failed:', result.message)
      }
    } catch (err) {
      message.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
      console.error('Save failed:', err)
    }
  }, [parseResult, projectFilePath, spreadsheet])

  const saveProjectRef = useRef(saveProjectToDisk)
  saveProjectRef.current = saveProjectToDisk

  const handleSaveProject = useCallback(async (saveAs = false) => {
    const errors = validateBlocks(blocks)
    if (errors.length > 0) {
      setPendingSaveAs(saveAs)
      setValidationErrors(errors)
      return
    }
    await saveProjectRef.current(saveAs)
  }, [blocks])

  const handleImportConfig = useCallback(async () => {
    setImportError(null)
    try {
      const result = await getBridge().openJson()
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        recordBridgeFailure('open-session', result)
        setImportError(`Unable to import config: ${result.error.message}`)
        return
      }
      const decoded = decodeProjectDocument(result.value.content, result.value.filePath)
      if (decoded.status === 'error') { setImportError(decoded.message); return }

      if (projectFilePath || projectRef.current.workbooks.length > 0 || hasUnsavedChanges) {
        setPendingImportContent(result.value.content)
        setPendingImportProjectName(decoded.document.project.name)
        setPendingImportProjectPath(result.value.filePath)
        setShowImportWarning(true)
      } else {
        applyImportContent(result.value.content, decoded.document.project.name, result.value.filePath)
      }
    } catch (err) {
      const detail = err instanceof SyntaxError ? err.message : String(err)
      const prefix = err instanceof SyntaxError ? 'Invalid config file' : 'Unable to import config'
      setImportError(`${prefix}: ${detail}`)
      console.error('Import failed:', err)
    }
  }, [applyImportContent, hasUnsavedChanges, projectFilePath])

  const handleConfirmImport = useCallback(() => {
    if (pendingImportContent) {
      applyImportContent(pendingImportContent, pendingImportProjectName, pendingImportProjectPath)
    }
    setShowImportWarning(false)
    setPendingImportContent(null)
    setPendingImportProjectName(null)
    setPendingImportProjectPath(null)
  }, [pendingImportContent, pendingImportProjectName, pendingImportProjectPath])

  const resetProject = useCallback((openSettings = false) => {
    setProject(createInitialProject(workbookId => createDefaultBlock(0, workbookId)))
    setProjectFilePath(null)
    updateWorkbookRuntime(resetWorkbookRuntime)
    setParseResult(null)
    setPreviewModalOpen(false)
    setPreviewModalData(new Map())
    setPreviewRegionResults([])
    setPreviewActiveBlockId('')
    setActiveColIndex(null)
    setReconcilingBlockId(null)
    setReconcilingPreviewSheet(null)
    setReconcilingPreviewRange(null)
    setProjectSettingsOpen(openSettings)
    setPendingProjectRemoval(null)
    setImportError(null)
    setValidationErrors(null)
    setPendingImportContent(null)
    setPendingImportProjectName(null)
    setPendingImportProjectPath(null)
    setShowImportWarning(false)
    setDiagnosticsOpen(false)
    setHasUnsavedChanges(false)
    historyRef.current.reset()
    setHistoryVersion(version => version + 1)
    setRecoveryContent(null)
    void getBridge().clearRecovery()
  }, [updateWorkbookRuntime])

  const requestProjectReset = useCallback((action: 'new' | 'close') => {
    if (projectFilePath || projectRef.current.workbooks.length > 0 || hasUnsavedChanges) {
      setPendingProjectReset(action)
      return
    }
    resetProject(action === 'new')
  }, [hasUnsavedChanges, projectFilePath, resetProject])

  const { token } = theme.useToken()

  const lockedRanges = useMemo(() => {
    const selectionLocked = blocks
      .filter(b => b.selectionLocked && b.range)
      .map(b => ({ blockId: b.id, range: b.range!, activeSheet: b.activeSheet, color: '#1677ff' }))

    const regionLocked = regions
      .filter(r => r.selectionLocked && r.range)
      .map(r => ({ blockId: r.id, range: r.range!, activeSheet: r.activeSheet, color: '#1677ff' }))

    const reconciling = reconcilingBlockId
      ? blocks
          .filter(b => b.id === reconcilingBlockId && (reconcilingPreviewRange || b.range))
          .map(b => ({ blockId: b.id, range: reconcilingPreviewRange || b.range!, activeSheet: reconcilingPreviewSheet || b.activeSheet, color: '#fa8c16' }))
      : []

    return [...selectionLocked, ...regionLocked, ...reconciling]
  }, [blocks, regions, reconcilingBlockId, reconcilingPreviewSheet, reconcilingPreviewRange])

  useEffect(() => {
    if (!activeSheetName && sheetNames[0]) setProjectActiveSheet(sheetNames[0])
  }, [activeSheetName, sheetNames, setProjectActiveSheet])

  const configurationDiagnostics = useMemo(() => validateBlocks(blocks), [blocks])
  const parseDiagnostics = useMemo(() => orderDiagnostics(parseResult?.diagnostics ?? []), [parseResult?.diagnostics])
  const diagnosticCount = configurationDiagnostics.length + parseDiagnostics.length

  const applyDiagnosticFocus = useCallback((target: DiagnosticFocusTarget) => {
    if (target.sheetName) spreadsheet.setActiveSheet(target.sheetName)
    if (target.blockId) { setActiveBlockId(target.blockId); setActiveRegionId(null) }
    if (target.regionId) { setActiveRegionId(target.regionId); setActiveBlockId('') }
    if (target.range) spreadsheet.scrollTo(target.sheetName, target.range.startRow - 2, target.range.startCol - 1)
  }, [spreadsheet])

  useEffect(() => {
    if (!pendingDiagnosticFocus || pendingDiagnosticFocus.workbookId !== loadedWorkbookId) return
    applyDiagnosticFocus(pendingDiagnosticFocus)
    setPendingDiagnosticFocus(null)
  }, [applyDiagnosticFocus, loadedWorkbookId, pendingDiagnosticFocus])

  const handleFocusDiagnostic = useCallback((diagnostic: NonNullable<ParseResult['diagnostics']>[number]) => {
    const target = diagnosticFocusTarget(projectRef.current, diagnostic)
    if (target?.workbookId && target.workbookId !== loadedWorkbookId) {
      setPendingDiagnosticFocus(target)
      handleSelectWorkbook(target.workbookId, target.sheetName ?? undefined)
    } else if (target) applyDiagnosticFocus(target)
    setDiagnosticsOpen(false)
  }, [applyDiagnosticFocus, handleSelectWorkbook, loadedWorkbookId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) handleRedo(); else handleUndo(); return }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); handleRedo(); return }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); handleImportConfig(); return }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void handleSaveProject(event.shiftKey); return }
      if (event.key === 'Enter' && blocksRef.current.some(block => block.range)) { event.preventDefault(); handleParse() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleImportConfig, handleParse, handleRedo, handleSaveProject, handleUndo])

  const navigator = <WorkspaceNavigator
    projectName={project.name}
    fileName={currentFileName}
    workbooks={projectWorkbooks}
    activeWorkbookId={activeWorkbookId}
    activeSheet={activeSheetName}
    blocks={activeBlocks}
    regions={activeRegions}
    activeBlockId={activeBlockId}
    activeRegionId={activeRegionId}
    onOpen={() => setProjectSettingsOpen(true)}
    onSelectWorkbook={handleSelectWorkbook}
    onSelectSheet={handleSelectSheet}
    onSelectBlock={handleActivateBlock}
    onSelectRegion={handleActivateRegion}
    onMoveBlock={handleMoveBlock}
    onMoveRegion={handleMoveRegion}
  />

  return (
    <Layout className="app-shell">
      <Layout.Header className="app-header">
        <div className="app-brand">
          <Tooltip title={sidebarHidden ? 'Show workspace navigation' : 'Hide workspace navigation'}>
            <Button
              className="workspace-sidebar-toggle"
              aria-label={sidebarHidden ? 'Show workspace navigation' : 'Hide workspace navigation'}
              size="small"
              type="text"
              icon={sidebarHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarHidden(hidden => !hidden)}
            />
          </Tooltip>
          <span className="app-brand-copy">
            <strong>Excel Block Parser</strong>
          </span>
        </div>
        <Tooltip title="Workspace navigation">
          <Button className="workspace-mobile-nav" aria-label="Workspace navigation" size="small" type="text" icon={<MenuOutlined />} onClick={() => setWorkspaceNavOpen(true)} />
        </Tooltip>
        {openWorkbookIds.length > 0 && (
          <div className="workbook-tabs" role="tablist" aria-label="Project workbooks">
            {projectWorkbooks.filter(workbook => openWorkbookIds.includes(workbook.id)).map(workbook => (
              <div key={workbook.id} className={`workbook-tab ${workbook.id === activeWorkbookId ? 'is-active' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workbook.id === activeWorkbookId}
                  className="workbook-tab-select"
                  title={workbook.name}
                  onClick={() => handleSelectWorkbook(workbook.id)}
                >
                  <FileExcelOutlined />
                  <span>{workbook.name}</span>
                </button>
              </div>
            ))}
          </div>
        )}
        <Space className="app-actions" size={6}>
          <Tooltip title="Undo">
            <Button aria-keyshortcuts="Control+Z Meta+Z" aria-label="Undo" icon={<UndoOutlined />} onClick={handleUndo} disabled={!historyRef.current.canUndo} />
          </Tooltip>
          <Tooltip title="Redo">
            <Button aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" aria-label="Redo" icon={<RedoOutlined />} onClick={handleRedo} disabled={!historyRef.current.canRedo} />
          </Tooltip>
          <Space.Compact className="project-command">
            <Button aria-keyshortcuts="Control+O Meta+O" icon={<ImportOutlined />} onClick={handleImportConfig}>
              Open Project
            </Button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              overlayClassName="project-command-menu"
              menu={{
                items: [
                  { key: 'new', icon: <FolderAddOutlined />, label: 'New Project' },
                  { key: 'save', icon: <SaveOutlined />, label: 'Save Project', extra: <span aria-hidden="true">Ctrl+S</span> },
                  { key: 'save-as', icon: <SaveOutlined />, label: 'Save Project As...', extra: <span aria-hidden="true">Ctrl+Shift+S</span> },
                  { key: 'settings', icon: <SettingOutlined />, label: 'Project settings' },
                  { type: 'divider' },
                  { key: 'close', icon: <CloseOutlined />, label: 'Close Project', danger: true, disabled: !projectFilePath && projectWorkbooks.length === 0 && !hasUnsavedChanges },
                ],
                onClick: ({ key }) => {
                  if (key === 'settings') setProjectSettingsOpen(true)
                  else if (key === 'save') void handleSaveProject(false)
                  else if (key === 'save-as') void handleSaveProject(true)
                  else requestProjectReset(key as 'new' | 'close')
                },
              }}
            >
              <Button aria-label="Project actions" icon={<DownOutlined />} />
            </Dropdown>
          </Space.Compact>
          <Tooltip title="Diagnostics">
            <Badge count={diagnosticCount} size="small" offset={[-2, 3]}>
              <Button aria-label="Diagnostics" icon={<WarningOutlined />} onClick={() => setDiagnosticsOpen(true)} />
            </Badge>
          </Tooltip>
        </Space>
      </Layout.Header>
      {importError && (
        <Alert
          message={importError}
          type="error"
          closable
          onClose={() => setImportError(null)}
          style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}
        />
      )}
      <Layout.Content className="workspace-layout">
        {!sidebarHidden && (
          <aside className="workspace-desktop-nav workspace-sidebar">
            {navigator}
          </aside>
        )}
        <div className="workspace-main">
          <Splitter className="workspace-splitter">
            <Splitter.Panel defaultSize="70%" min="45%" max="82%">
              <section className="workspace-canvas" aria-label="Workbook canvas">
                <header className="panel-heading canvas-heading">
                  <div><strong>Excel Workbook</strong></div>
                  <span>{currentFileName ?? 'Choose a file to begin'}</span>
                </header>
                <SpreadsheetPanel
                  activeBlockId={activeBlockId}
                  activeRegionId={activeRegionId}
                  activeColIndex={activeColIndex}
                  onSelectionChange={handleSelectionChange}
                  onActiveSheetChange={(workbookId, sheetName) => {
                    if (workbookId === projectRef.current.activeWorkbookId && workbookId === loadedWorkbookId) setProjectActiveSheet(sheetName)
                  }}
                  loadSignal={loadSignal}
                  requestedWorkbook={requestedWorkbook}
                  onFileLoaded={handleFileLoaded}
                  onLoadedWorkbookChange={workbookId => updateWorkbookRuntime(current => setLoadedWorkbook(current, workbookId))}
                  lockedRanges={lockedRanges}
                  closeSignal={closeSignal}
                  onOpenWorkbook={handleOpenFile}
                />
              </section>
            </Splitter.Panel>
            <Splitter.Panel defaultSize="30%" min="18%">
              <aside className="inspector-panel" aria-label="Extraction inspector">
                <header className="panel-heading inspector-heading">
                  <div><strong>Extraction setup</strong></div>
                  <span>{activeBlocks.filter(block => block.range).length} active</span>
                </header>
                <ConfigPanel
                  spreadsheet={spreadsheet}
                  blocks={activeBlocks}
                  activeBlockId={activeBlockId}
                  activeColIndex={activeColIndex}
                  focusMode={focusMode}
                  parseResult={parseResult}
                  regions={activeRegions}
                  activeRegionId={activeRegionId}
                  onActivateBlock={handleActivateBlock}
                  onBlockChange={handleBlockChange}
                  onAddBlock={handleAddBlock}
                  onDeleteBlock={handleDeleteBlock}
                  onAddRegion={handleAddRegion}
                  onDeleteRegion={handleDeleteRegion}
                  onRegionChange={handleRegionChange}
                  onActivateRegion={handleActivateRegion}
                  onRegionRangeClick={handleRegionRangeClick}
                  onFocusModeChange={handleFocusModeChange}
                  onColumnFocus={setActiveColIndex}
                  onParse={handleParse}
                  onReconcilingChange={(id) => {
                    setReconcilingBlockId(id)
                    if (!id) {
                      setReconcilingPreviewSheet(null)
                      setReconcilingPreviewRange(null)
                      pendingReconcilingRangeRef.current = null
                    }
                  }}
                  onReselectRange={handleReconcilingReselectRange}
                  onPreviewSheet={setReconcilingPreviewSheet}
                />
              </aside>
            </Splitter.Panel>
          </Splitter>
        </div>
      </Layout.Content>
      <Drawer title="Workspace" open={workspaceNavOpen} onClose={() => setWorkspaceNavOpen(false)} placement="left" width={300} destroyOnClose styles={{ body: { padding: 0 } }}>
        {navigator}
      </Drawer>
      <DiagnosticsDrawer
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        parseDiagnostics={parseDiagnostics}
        validationErrors={configurationDiagnostics}
        onFocus={handleFocusDiagnostic}
      />
      <Modal
        className="preview-modal"
        title={null}
        open={previewModalOpen}
        onCancel={() => setPreviewModalOpen(false)}
        footer={null}
        width="calc(100vw - 60px)"
        style={{ top: 30, paddingBottom: 0 }}
        styles={{ body: { height: 'calc(100vh - 120px)', padding: 0, overflow: 'hidden' } }}
        closable={false}
        destroyOnClose
        maskClosable={false}
      >
        {previewRegionResults.length > 0 ? (
          <Tabs
            defaultActiveKey="blocks"
            size="small"
            tabBarStyle={{ padding: '0 12px', marginBottom: 0, background: '#fafafa' }}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            items={[
              {
                key: 'blocks',
                label: `Blocks (${previewModalData.size})`,
                children: (
                  <div style={{ flex: 1, overflow: 'auto', height: 'calc(100vh - 170px)' }}>
                    <PreviewWindow
                      previewData={previewModalData.get(previewActiveBlockId) || null}
                      allBlocks={Array.from(previewModalData.entries()).map(([id, data]) => ({
                        blockId: id,
                        label: data.label,
                      }))}
                      activeBlockId={previewActiveBlockId}
                      onBlockChange={setPreviewActiveBlockId}
                      onClose={() => setPreviewModalOpen(false)}
                    />
                  </div>
                ),
              },
              {
                key: 'regions',
                label: `Regions (${previewRegionResults.length})`,
                children: (
                  <div style={{ flex: 1, overflow: 'auto', height: 'calc(100vh - 170px)', padding: 12 }}>
                    {previewRegionResults.map(region => (
                      <div key={region.regionId} style={{ marginBottom: 24 }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1677ff', fontWeight: 600 }}>
                          {region.label || 'Region'}
                        </h4>
                        {region.blocks.length === 0 ? (
                          <Empty description="No blocks detected" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                        ) : (
                          region.blocks.map((block, bi) => (
                            <div key={bi} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                                {block.blockLabel} ({block.rows.length} rows × {block.rows[0]?.length ?? 0} cols)
                              </div>
                              <Table
                                dataSource={block.rows.map((row, ri) => ({ key: ri, ...Object.fromEntries(row.map((cell, ci) => [`c${ci}`, cell])) }))}
                                columns={Array.from({ length: Math.max(...block.rows.map(r => r.length), 0) }, (_, ci) => ({
                                  title: String(ci),
                                  dataIndex: `c${ci}`,
                                  key: `c${ci}`,
                                  width: 120,
                                  ellipsis: true,
                                }))}
                                size="small"
                                pagination={false}
                                bordered
                                scroll={{ x: 'max-content' }}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        ) : (
          <PreviewWindow
            previewData={previewModalData.get(previewActiveBlockId) || null}
            allBlocks={Array.from(previewModalData.entries()).map(([id, data]) => ({
              blockId: id,
              label: data.label,
            }))}
            activeBlockId={previewActiveBlockId}
            onBlockChange={setPreviewActiveBlockId}
            onClose={() => setPreviewModalOpen(false)}
          />
        )}
      </Modal>
      <Modal
        title="Open another project?"
        open={showImportWarning}
        onCancel={() => { setShowImportWarning(false); setPendingImportContent(null); setPendingImportProjectName(null); setPendingImportProjectPath(null) }}
        onOk={handleConfirmImport}
        okText="Open Project"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
      >
        <p>
          Opening another project will replace the current project configuration and detach all attached workbooks.
        </p>
        <p>This action cannot be undone.</p>
      </Modal>
      <Modal
        title={pendingProjectReset === 'new' ? 'Create a new project?' : 'Close project?'}
        open={pendingProjectReset !== null}
        onCancel={() => setPendingProjectReset(null)}
        onOk={() => {
          const action = pendingProjectReset
          setPendingProjectReset(null)
          if (action) resetProject(action === 'new')
        }}
        okText={pendingProjectReset === 'new' ? 'New Project' : 'Close Project'}
        okButtonProps={{ danger: pendingProjectReset === 'close' }}
        cancelText="Cancel"
      >
        <p>{pendingProjectReset === 'new'
          ? 'This replaces the current project with a new empty project and detaches all workbooks.'
          : 'This closes the current project and detaches all workbooks.'}</p>
        {hasUnsavedChanges && <p>Unsaved project changes will be discarded.</p>}
      </Modal>
      <Modal
        title="Project settings"
        open={projectSettingsOpen}
        onCancel={() => setProjectSettingsOpen(false)}
        footer={<Button onClick={() => setProjectSettingsOpen(false)}>Done</Button>}
      >
        <div className="project-workbook-settings">
          {projectWorkbooks.map(workbook => (
            <div className="project-workbook-setting" key={workbook.id}>
              <span><FileExcelOutlined /> {workbook.name}<small>{openWorkbookIds.includes(workbook.id) ? 'Available' : 'Unavailable'}</small></span>
              <Space size={6}>
                <Button size="small" onClick={() => void handleReassignProjectWorkbook(workbook.id)}>Reassign</Button>
                <Button danger size="small" onClick={() => setPendingProjectRemoval(workbook.id)}>Remove</Button>
              </Space>
            </div>
          ))}
          <Button icon={<FolderOpenOutlined />} onClick={() => void handleAddProjectWorkbook()}>Add workbook source</Button>
        </div>
      </Modal>
      <Modal
        title="Remove project workbook?"
        open={pendingProjectRemoval !== null}
        onCancel={() => setPendingProjectRemoval(null)}
        onOk={() => { if (pendingProjectRemoval) handleRemoveProjectWorkbook(pendingProjectRemoval) }}
        okText="Remove source"
        okButtonProps={{ danger: true }}
      >
        <p>This removes the workbook source and all blocks and regions mapped to it.</p>
      </Modal>
      <Modal
        title="Recover unsaved workspace?"
        open={recoveryContent !== null}
        closable={false}
        maskClosable={false}
        okText="Recover"
        cancelText="Discard"
        onOk={() => {
          if (recoveryContent) applyImportContent(recoveryContent)
          setRecoveryContent(null)
        }}
        onCancel={() => {
          setRecoveryContent(null)
          void getBridge().clearRecovery()
        }}
      >
        <p>An unsaved project from the previous app session is available.</p>
        <p>Recover it to continue where you left off, or discard it to start fresh.</p>
      </Modal>
      <Modal
        title="Validation errors"
        open={validationErrors !== null}
        onCancel={() => setValidationErrors(null)}
        onOk={() => { setValidationErrors(null); void saveProjectRef.current(pendingSaveAs) }}
        okText="Save anyway"
        cancelText="Cancel"
      >
        <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 13 }}>
          {(validationErrors || []).slice(0, 10).map((e, i) => <div key={i} style={{ marginBottom: 4 }}>{e}</div>)}
          {(validationErrors || []).length > 10 && <div style={{ color: '#999' }}>...and {(validationErrors || []).length - 10} more</div>}
        </div>
      </Modal>
    </Layout>
  )
}
