import { Suspense, useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Badge, Button, Drawer, Dropdown, Layout, Modal, Splitter, Space, Spin, theme, Tooltip, message, Alert, Tabs } from 'antd'
import { CodeOutlined, FileExcelOutlined, FolderOpenOutlined, FolderAddOutlined, ImportOutlined, CloseOutlined, DownOutlined, MenuOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ReloadOutlined, SaveOutlined, SettingOutlined, WarningOutlined, UndoOutlined, RedoOutlined } from '@ant-design/icons'
import { SpreadsheetPanel } from './components/SpreadsheetPanel'
import { PythonProjectDialog } from './components/PythonProjectDialog'
import type { CellRange, ParseResult, ProjectConfig, ProjectWorkbook } from './types'
import { FeaturePanelHost } from './features/panel/FeaturePanelHost'
import { gateBPrototypePanel } from './features/panel/gateBPrototypePanels'
import type { WorkspaceFeaturePanelContext, WorkspaceReconciliationItem } from './features/panel/workspacePanel'
import { builtInFeaturePanelRegistry, builtInFeatureRegistry } from './features/builtinRegistry'
import { useUniver } from './context/UniverContext'
import { getBridge } from './services/bridge'
import { recordBridgeFailure, recordParseFailure } from './services/observability'
import { loadExcelJsWorkbook } from './services/exceljsWorkbook'
import {
  activateProjectWorkbook,
  addProjectWorkbook,
  createProject,
  createProjectWorkbook,
  reassignProjectWorkbook,
  recordProjectWorkbookLoaded,
  removeProjectWorkbook,
  setActiveWorkbookSheet,
} from './services/project'
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
  requestWorkbookRefresh,
  resetWorkbookRuntime,
  setLoadedWorkbook,
  shouldRequestWorkbookLoad,
  type WorkbookRuntimeState,
} from './services/workbookRuntime'
import { decodeProjectDocument, inspectProjectWorkbookSources, projectRecoveryContent, saveProjectDocument } from './services/projectLifecycle'
import { executeProject, type ProjectExecutionResult } from './services/projectExecution'
import { orderDiagnostics, type DiagnosticFocusTarget } from './services/diagnostics'

export function WorkspaceApplication() {
  const e2eMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('e2e')
  const { univerAPI, sheetNames } = useUniver()
  const spreadsheet = useMemo(() => createUniverSpreadsheetCapability(univerAPI, sheetNames), [sheetNames, univerAPI])

  const [project, setProject] = useState<ProjectConfig>(() => {
    return builtInFeatureRegistry.initialize(createProject())
  })
  const { workbooks: projectWorkbooks, activeWorkbookId } = project
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [loadSignal, setLoadSignal] = useState(0)
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null)
  const [pendingSaveAs, setPendingSaveAs] = useState(false)
  const [activeColIndex, setActiveColIndex] = useState<number | null>(null)
  const [showImportWarning, setShowImportWarning] = useState(false)
  const [pendingProjectReset, setPendingProjectReset] = useState<'new' | 'close' | null>(null)
  const [pendingImportContent, setPendingImportContent] = useState<string | null>(null)
  const [featurePanelPrototypeSearch, setFeaturePanelPrototypeSearch] = useState(() => window.location.search)
  const [pendingImportProjectName, setPendingImportProjectName] = useState<string | null>(null)
  const [pendingImportProjectPath, setPendingImportProjectPath] = useState<string | null>(null)
  const [reconcilingItem, setReconcilingItem] = useState<WorkspaceReconciliationItem | null>(null)
  const reconcilingItemRef = useRef(reconcilingItem)
  reconcilingItemRef.current = reconcilingItem
  const [reconcilingPreviewSheet, setReconcilingPreviewSheet] = useState<string | null>(null)
  const [reconcilingPreviewRange, setReconcilingPreviewRange] = useState<CellRange | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [previewExecution, setPreviewExecution] = useState<Extract<ProjectExecutionResult, { status: 'complete' }> | null>(null)
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
  const [pythonProjectOpen, setPythonProjectOpen] = useState(false)
  const [pythonToolbarContainer, setPythonToolbarContainer] = useState<HTMLDivElement | null>(null)
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
  const executionControllerRef = useRef<AbortController | null>(null)
  const pendingReconcilingRangeRef = useRef<{ range: CellRange; activeSheet: string | null } | null>(null)

  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => {
    let closing = false
    void builtInFeatureRegistry.open(project).then(() => {
      if (!closing) return builtInFeatureRegistry.activate(project)
    })
    return () => {
      closing = true
      executionControllerRef.current?.abort()
      void builtInFeatureRegistry.close(project)
    }
  }, [project.id])

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
      setProject(current => {
        const withMetadata = {
          ...current,
          workbooks: current.workbooks.map(workbook => availability.metadata.has(workbook.id) ? { ...workbook, ...availability.metadata.get(workbook.id)! } : workbook),
        }
        if (!nextActiveId) return withMetadata
        return activateProjectWorkbook(withMetadata, nextActiveId, builtInFeatureRegistry)
      })
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
    if (!import.meta.env.DEV) return
    const updatePrototype = () => setFeaturePanelPrototypeSearch(window.location.search)
    window.addEventListener('popstate', updatePrototype)
    return () => window.removeEventListener('popstate', updatePrototype)
  }, [])

  useEffect(() => {
    if (e2eMode) return
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
  }, [e2eMode])

  useEffect(() => {
    if (e2eMode || !hasUnsavedChanges) return
    const timer = window.setTimeout(() => {
      void getBridge().saveRecovery(projectRecoveryContent(project, parseResult, projectFilePath)).then((result) => {
        if (result.status === 'error') console.warn('Unable to save workspace recovery data:', result.error.message)
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [e2eMode, hasUnsavedChanges, parseResult, project, projectFilePath])

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
      ?? projectRef.current.workbooks.find(workbook => !workbookRuntimeRef.current.paths[workbook.id])
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
      if (plan.nextActiveWorkbookId) return activateProjectWorkbook(current, plan.nextActiveWorkbookId, builtInFeatureRegistry)
      return builtInFeatureRegistry.activateWorkbook({ ...current, activeWorkbookId: null }, '')
    })
    setParseResult(null)
  }, [activeWorkbookId, updateWorkbookRuntime])

  const handleRemoveProjectWorkbook = useCallback((workbookId: string) => {
    detachWorkbook(workbookId)
    setProject(current => removeProjectWorkbook(current, workbookId, builtInFeatureRegistry))
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
    }, builtInFeatureRegistry))
    setParseResult(null)
  }, [updateWorkbookRuntime])

  const handleSelectWorkbook = useCallback((workbookId: string, sheetName?: string) => {
    const path = workbookRuntimeRef.current.paths[workbookId]
    const workbook = projectRef.current.workbooks.find(item => item.id === workbookId)
    if (!path || !workbook) {
      message.warning(`Open ${workbook?.name ?? 'this workbook'} to attach it to the project.`)
      return
    }
    if (!shouldRequestWorkbookLoad(workbookRuntimeRef.current, projectRef.current.activeWorkbookId, workbookId)) {
      if (sheetName && workbookRuntimeRef.current.loadedWorkbookId === workbookId && spreadsheet.setActiveSheet(sheetName)) {
        setProjectActiveSheet(sheetName)
      }
      return
    }
    setProject(current => activateProjectWorkbook(current, workbookId, builtInFeatureRegistry, sheetName))
    updateWorkbookRuntime(current => requestWorkbookLoad(current, workbookId, path, sheetName ?? workbook.activeSheetName))
  }, [spreadsheet, updateWorkbookRuntime])

  const handleRefreshWorkbook = useCallback(() => {
    const workbookId = projectRef.current.activeWorkbookId
    if (!workbookId) return
    const path = workbookRuntimeRef.current.paths[workbookId]
    const workbook = projectRef.current.workbooks.find(item => item.id === workbookId)
    if (!path || !workbook) return
    updateWorkbookRuntime(current => requestWorkbookRefresh(current, workbookId, path, workbook.activeSheetName))
  }, [updateWorkbookRuntime])

  const handleSelectionChange = useCallback(async (sourceWorkbookId: string, range: CellRange | null, activeSheet: string | null) => {
    if (sourceWorkbookId !== projectRef.current.activeWorkbookId || sourceWorkbookId !== loadedWorkbookId) return
    if (reconcilingItemRef.current && range) {
      pendingReconcilingRangeRef.current = { range, activeSheet }
    }
    const current = projectRef.current
    const withSheet = setActiveWorkbookSheet(current, activeSheet)
    const next = builtInFeatureRegistry.selectionChanged(withSheet, { workbookId: sourceWorkbookId, range, activeSheet }, spreadsheet)
    if (next !== withSheet) {
      rememberWorkspace()
      setParseResult(null)
      setHasUnsavedChanges(true)
    }
    if (next !== current) setProject(next)
  }, [loadedWorkbookId, rememberWorkspace, spreadsheet])

  const handleReconcilingReselectRange = useCallback((onRange: (range: CellRange) => void) => {
    const pending = pendingReconcilingRangeRef.current
    if (!pending) return
    onRange(pending.range)
    setReconcilingPreviewRange(pending.range)
    if (pending.activeSheet) setReconcilingPreviewSheet(pending.activeSheet)
    pendingReconcilingRangeRef.current = null
  }, [])

  const handleSelectSheet = useCallback((sheetName: string) => {
    if (loadedWorkbookId !== projectRef.current.activeWorkbookId) return
    if (!spreadsheet.setActiveSheet(sheetName)) return
    setProjectActiveSheet(sheetName)
  }, [loadedWorkbookId, spreadsheet])

  const runProjectExtraction = useCallback(async (showPreview: boolean): Promise<{ project: ProjectConfig; result: ParseResult } | { error: string }> => {
    const clearPreview = () => {
      if (showPreview) setPreviewExecution(null)
    }
    if (!builtInFeatureRegistry.executionReady(projectRef.current)) {
      const error = 'Configure at least one feature range before running'
      clearPreview()
      const result = { success: false, data: {}, blocks: [], error }
      setParseResult(result)
      recordParseFailure('parse-preview', result)
      if (showPreview) message.warning(error)
      return { error }
    }

    executionControllerRef.current?.abort()
    const controller = new AbortController()
    executionControllerRef.current = controller
    const generation = ++executionGenerationRef.current
    const execution = await executeProject(
      projectRef.current,
      workbookRuntimeRef.current.paths,
      path => getBridge().readFile(path),
      loadExcelJsWorkbook,
      () => executionGenerationRef.current === generation,
      controller.signal,
    )
    if (execution.status === 'stale') return { error: 'The project changed before input preparation completed. Run again.' }
    const result = execution.result
    if (!result.success) {
      clearPreview()
      setParseResult(result)
      recordParseFailure('parse-preview', result)
      setDiagnosticsOpen(true)
      const error = result.error || 'Parsing could not complete. Review diagnostics for details.'
      if (showPreview) message.error(error)
      return { error }
    }

    if (execution.project !== projectRef.current) {
      rememberWorkspace()
      setHasUnsavedChanges(true)
    }
    setProject(execution.project)
    setParseResult(result)
    if (showPreview) setPreviewExecution(execution)
    return { project: execution.project, result }
  }, [rememberWorkspace])

  const handleParse = useCallback(() => { void runProjectExtraction(true) }, [runProjectExtraction])
  const preparePythonInput = useCallback(() => runProjectExtraction(false), [runProjectExtraction])

  const saveProjectToDisk = useCallback(async (saveAs: boolean) => {
    try {
      const projectForSave = await builtInFeatureRegistry.captureForSave(projectRef.current, projectRef.current.activeWorkbookId, spreadsheet)
      const result = await saveProjectDocument(
        getBridge(), projectForSave, parseResult, projectFilePath, saveAs,
        current => builtInFeatureRegistry.prepareForSave(current),
        workbookRuntimeRef.current.paths,
      )
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
    const errors = builtInFeatureRegistry.validate(projectRef.current)
    if (errors.length > 0) {
      setPendingSaveAs(saveAs)
      setValidationErrors(errors)
      return
    }
    await saveProjectRef.current(saveAs)
  }, [])

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
    setProject(builtInFeatureRegistry.initialize(createProject()))
    setProjectFilePath(null)
    updateWorkbookRuntime(resetWorkbookRuntime)
    setParseResult(null)
    setPreviewExecution(null)
    setActiveColIndex(null)
    setReconcilingItem(null)
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
    const configured = builtInFeatureRegistry.canvasRanges(project, activeWorkbookId)

    const range = reconcilingPreviewRange ?? reconcilingItem?.range
    const reconciling = reconcilingItem && range
      ? [{ itemId: reconcilingItem.id, range, activeSheet: reconcilingPreviewSheet ?? reconcilingItem.activeSheet, color: '#fa8c16' }]
      : []

    return [...configured, ...reconciling]
  }, [activeWorkbookId, project, reconcilingItem, reconcilingPreviewSheet, reconcilingPreviewRange])

  useEffect(() => {
    if (!activeSheetName && sheetNames[0]) setProjectActiveSheet(sheetNames[0])
  }, [activeSheetName, sheetNames, setProjectActiveSheet])

  const configurationDiagnostics = useMemo(() => builtInFeatureRegistry.validate(project), [project])
  const activeCanvasItemIds = useMemo(() => builtInFeatureRegistry.activeCanvasItems(project), [project])
  const activeColumnItemId = useMemo(() => builtInFeatureRegistry.activeColumnItem(project), [project])
  const parseDiagnostics = useMemo(() => orderDiagnostics(parseResult?.diagnostics ?? []), [parseResult?.diagnostics])
  const diagnosticCount = configurationDiagnostics.length + parseDiagnostics.length

  const applyDiagnosticFocus = useCallback((target: DiagnosticFocusTarget) => {
    if (target.sheetName) spreadsheet.setActiveSheet(target.sheetName)
    setProject(current => builtInFeatureRegistry.applyDiagnosticFocus(current, target))
    if (target.range) spreadsheet.scrollTo(target.sheetName, target.range.startRow - 2, target.range.startCol - 1)
  }, [spreadsheet])

  useEffect(() => {
    if (!pendingDiagnosticFocus || pendingDiagnosticFocus.workbookId !== loadedWorkbookId) return
    applyDiagnosticFocus(pendingDiagnosticFocus)
    setPendingDiagnosticFocus(null)
  }, [applyDiagnosticFocus, loadedWorkbookId, pendingDiagnosticFocus])

  const handleFocusDiagnostic = useCallback((diagnostic: NonNullable<ParseResult['diagnostics']>[number]) => {
    const target = builtInFeatureRegistry.diagnosticFocus(projectRef.current, diagnostic)
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
      if (event.key === 'Enter' && builtInFeatureRegistry.executionReady(projectRef.current)) { event.preventDefault(); handleParse() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleImportConfig, handleParse, handleRedo, handleSaveProject, handleUndo])

  const handlePythonPackageChange = useCallback((pythonScript: NonNullable<ProjectConfig['pythonScript']>) => {
    setProject(current => ({ ...current, pythonScript }))
    setHasUnsavedChanges(true)
  }, [])

  const requestedFeatureName = new URLSearchParams(featurePanelPrototypeSearch).get('feature-panel-prototype')
  const requestedFeatureId = import.meta.env.DEV && requestedFeatureName ? `builtin.${requestedFeatureName}` : null
  const featureContext: WorkspaceFeaturePanelContext = {
    project,
    loadedWorkbookId,
    activeColIndex,
    parseResult,
    spreadsheet,
    requestedFeatureId,
    transactProject: update => {
      rememberWorkspace()
      setProject(update)
      setParseResult(null)
      setHasUnsavedChanges(true)
    },
    selectProject: update => setProject(update),
    activateWorkbook: handleSelectWorkbook,
    run: handleParse,
    setActiveColumn: setActiveColIndex,
    setReconciliationItem: item => {
      setReconcilingItem(item)
      setReconcilingPreviewRange(item?.range ?? null)
      setReconcilingPreviewSheet(item?.activeSheet ?? null)
      if (!item) {
        setReconcilingPreviewSheet(null)
        setReconcilingPreviewRange(null)
        pendingReconcilingRangeRef.current = null
      }
    },
    takeReselectedRange: handleReconcilingReselectRange,
    setPreviewSheet: setReconcilingPreviewSheet,
  }
  const featurePanel = gateBPrototypePanel(featurePanelPrototypeSearch) ?? builtInFeaturePanelRegistry.select(featureContext)
  const resultContributions = previewExecution
    ? builtInFeaturePanelRegistry.results({
        project: previewExecution.project,
        result: previewExecution.result,
        previews: previewExecution.previews,
      })
    : []

  const navigator = <WorkspaceNavigator
    projectName={project.name}
    fileName={currentFileName}
    workbooks={projectWorkbooks}
    activeWorkbookId={activeWorkbookId}
    activeSheet={activeSheetName}
    featureSections={builtInFeaturePanelRegistry.navigation(featureContext)}
    onOpen={() => setProjectSettingsOpen(true)}
    onSelectWorkbook={handleSelectWorkbook}
    onSelectSheet={handleSelectSheet}
  />

  return (
    <Layout className="app-shell">
      <Layout.Header className="app-header">
        <div className="app-brand">
          {!pythonProjectOpen && <Tooltip title={sidebarHidden ? 'Show workspace navigation' : 'Hide workspace navigation'}>
            <Button
              className="workspace-sidebar-toggle"
              aria-label={sidebarHidden ? 'Show workspace navigation' : 'Hide workspace navigation'}
              size="small"
              type="text"
              icon={sidebarHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarHidden(hidden => !hidden)}
            />
          </Tooltip>}
          <span className="app-brand-copy">
            <strong>{pythonProjectOpen ? 'Project Python' : 'Excel Block Parser'}</strong>
          </span>
        </div>
        {!pythonProjectOpen && <Tooltip title="Workspace navigation">
          <Button className="workspace-mobile-nav" aria-label="Workspace navigation" size="small" type="text" icon={<MenuOutlined />} onClick={() => setWorkspaceNavOpen(true)} />
        </Tooltip>}
        {!pythonProjectOpen && openWorkbookIds.length > 0 && (
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
        {!pythonProjectOpen && <Space className="app-actions" size={6}>
          {!pythonProjectOpen && <>
            <Tooltip title="Undo">
              <Button aria-keyshortcuts="Control+Z Meta+Z" aria-label="Undo" icon={<UndoOutlined />} onClick={handleUndo} disabled={!historyRef.current.canUndo} />
            </Tooltip>
            <Tooltip title="Redo">
              <Button aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" aria-label="Redo" icon={<RedoOutlined />} onClick={handleRedo} disabled={!historyRef.current.canRedo} />
            </Tooltip>
          </>}
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
                  { key: 'project-python', icon: <CodeOutlined />, label: 'Project Python' },
                  { type: 'divider' },
                  { key: 'close', icon: <CloseOutlined />, label: 'Close Project', danger: true, disabled: !projectFilePath && projectWorkbooks.length === 0 && !hasUnsavedChanges },
                ],
                onClick: ({ key }) => {
                  if (key === 'settings') setProjectSettingsOpen(true)
                  else if (key === 'project-python') setPythonProjectOpen(true)
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
        </Space>}
        {pythonProjectOpen && <div ref={setPythonToolbarContainer} className="python-header-actions" aria-label="Python workspace actions" />}
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
                  <div className="canvas-heading-actions">
                    <span>{currentFileName ?? 'Choose a file to begin'}</span>
                    <Tooltip title="Refresh workbook from source">
                      <Button aria-label="Refresh current workbook" size="small" type="text" icon={<ReloadOutlined />}
                        disabled={!activeWorkbookId || !workbookRuntime.paths[activeWorkbookId]} onClick={handleRefreshWorkbook} />
                    </Tooltip>
                  </div>
                </header>
                <SpreadsheetPanel
                  activeSheet={activeSheetName}
                  activeItemIds={activeCanvasItemIds}
                  activeColumnItemId={activeColIndex === null ? null : activeColumnItemId}
                  activeColIndex={activeColIndex}
                  onSelectionChange={handleSelectionChange}
                  onActiveSheetChange={(workbookId, sheetName) => {
                    if (workbookId === projectRef.current.activeWorkbookId && workbookId === loadedWorkbookId) setProjectActiveSheet(sheetName)
                  }}
                  loadSignal={loadSignal}
                  requestedWorkbook={requestedWorkbook}
                  openWorkbookIds={openWorkbookIds}
                  onFileLoaded={handleFileLoaded}
                  onLoadedWorkbookChange={workbookId => updateWorkbookRuntime(current => setLoadedWorkbook(current, workbookId))}
                  lockedRanges={lockedRanges}
                  closeSignal={closeSignal}
                  onOpenWorkbook={handleOpenFile}
                />
              </section>
            </Splitter.Panel>
            <Splitter.Panel defaultSize="30%" min="18%">
              <FeaturePanelHost panel={featurePanel} />
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
        open={previewExecution !== null}
        onCancel={() => setPreviewExecution(null)}
        footer={null}
        width="calc(100vw - 60px)"
        style={{ top: 30, paddingBottom: 0 }}
        styles={{ body: { height: 'calc(100vh - 120px)', padding: 0, overflow: 'hidden' } }}
        closable={false}
        destroyOnClose
        maskClosable={false}
      >
        {previewExecution && (
          <Tooltip title="Close preview">
            <Button
              className="preview-host-close"
              aria-label="Close preview"
              icon={<CloseOutlined />}
              onClick={() => setPreviewExecution(null)}
            />
          </Tooltip>
        )}
        {resultContributions.length > 1 ? (
          <Tabs
            defaultActiveKey={resultContributions[0]?.id}
            size="small"
            tabBarStyle={{ padding: '0 12px', marginBottom: 0, background: '#fafafa' }}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            items={resultContributions.map(contribution => ({
              key: contribution.id,
              label: `${contribution.label} (${contribution.count})`,
              children: <div style={{ height: 'calc(100vh - 170px)' }}><Suspense fallback={<Spin />}>{contribution.render()}</Suspense></div>,
            }))}
          />
        ) : (
          resultContributions[0] ? <Suspense fallback={<Spin />}>{resultContributions[0].render()}</Suspense> : null
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
        <p>This removes the workbook source and all feature configuration mapped to it.</p>
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
      <PythonProjectDialog
        open={pythonProjectOpen}
        project={project}
        parseResult={parseResult}
        onPrepareInput={preparePythonInput}
        onSourceChange={handlePythonPackageChange}
        onClose={() => setPythonProjectOpen(false)}
        toolbarContainer={pythonToolbarContainer}
      />
    </Layout>
  )
}
