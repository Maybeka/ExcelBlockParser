import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Badge, Button, Drawer, Layout, Modal, Splitter, Space, theme, ConfigProvider, Tooltip, message, Alert, Tabs, Table, Empty } from 'antd'
import { FolderOpenOutlined, ExportOutlined, PlayCircleOutlined, ImportOutlined, CloseOutlined, MenuOutlined, MenuFoldOutlined, MenuUnfoldOutlined, WarningOutlined, UndoOutlined, RedoOutlined } from '@ant-design/icons'
import { UniverProvider } from './context/UniverContext'
import { SpreadsheetPanel } from './components/SpreadsheetPanel'
import { ConfigPanel, validateBlocks } from './components/ConfigPanel'
import type { CellRange, BlockConfig, ParseResult, ReconciliationReport, RegionConfig, RegionParseResult } from './types'
import type { FocusMode } from './components/ConfigPanel'
import { useUniver } from './context/UniverContext'
import { runReconciliation } from './services/reconciliation'
import { getBridge } from './services/bridge'
import { adaptPreviewData } from './services/previewDataAdapter'
import { serializeSession, loadSession } from './services/serializer'
import { createUniverWorkbookReader } from './services/workbook'
import { generateColumnMappings, parseWorkbook, suggestMappingsForWorkbook } from './services/extraction'
import { PreviewWindow } from './components/PreviewWindow'
import type { PreviewData } from './types'
import { WorkspaceNavigator } from './components/WorkspaceNavigator'
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer'
import { WorkspaceHistory, type WorkspaceSnapshot } from './services/workspaceHistory'

let blockCounter = 1
function nextBlockId(): string {
  return `block-${blockCounter++}-${Date.now()}`
}

function createDefaultBlock(lastNum: number): BlockConfig {
  const num = lastNum + 1
  return {
    id: nextBlockId(),
    label: `block_${num}`,
    range: null,
    activeSheet: null,
    headerRows: [0],
    collapsed: false,
    selectionLocked: false,
    columns: [],
    dataSnapshot: null,
  }
}

function AppContent() {
  const { univerAPI, sheetNames } = useUniver()
  const univerAPIRef = useRef(univerAPI)
  univerAPIRef.current = univerAPI

  const defaultBlock = createDefaultBlock(0)
  const [blocks, setBlocks] = useState<BlockConfig[]>([defaultBlock])
  const [activeBlockId, setActiveBlockId] = useState<string>(defaultBlock.id)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [loadSignal, setLoadSignal] = useState(0)
  const [focusMode, setFocusMode] = useState<FocusMode>('always-editable')
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null)
  const [regions, setRegions] = useState<RegionConfig[]>([])
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const [activeColIndex, setActiveColIndex] = useState<number | null>(null)
  const [showImportWarning, setShowImportWarning] = useState(false)
  const [pendingImportContent, setPendingImportContent] = useState<string | null>(null)
  const [reconcilingBlockId, setReconcilingBlockId] = useState<string | null>(null)
  const reconcilingBlockIdRef = useRef(reconcilingBlockId)
  reconcilingBlockIdRef.current = reconcilingBlockId
  const [reconcilingPreviewSheet, setReconcilingPreviewSheet] = useState<string | null>(null)
  const [reconcilingPreviewRange, setReconcilingPreviewRange] = useState<CellRange | null>(null)
  const [shouldReParse, setShouldReParse] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewModalData, setPreviewModalData] = useState<Map<string, PreviewData>>(new Map())
  const [previewActiveBlockId, setPreviewActiveBlockId] = useState<string>('')
  const [previewRegionResults, setPreviewRegionResults] = useState<RegionParseResult[]>([])
  const [currentFileName, setCurrentFileName] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [closeSignal, setCloseSignal] = useState(0)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [showWorkbookSwitchConfirm, setShowWorkbookSwitchConfirm] = useState(false)
  const [showWorkbookCloseConfirm, setShowWorkbookCloseConfirm] = useState(false)
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null)
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(true)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [recoveryContent, setRecoveryContent] = useState<string | null>(null)
  const historyRef = useRef(new WorkspaceHistory())
  const [historyVersion, setHistoryVersion] = useState(0)
  const pendingFileActionRef = useRef<(() => void) | null>(null)
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

  const workspaceSnapshot = useCallback((): WorkspaceSnapshot => ({
    blocks: blocksRef.current,
    regions: regionsRef.current,
    activeBlockId: activeBlockIdRef.current,
    activeRegionId: activeRegionIdRef.current,
    focusMode: focusModeRef.current,
  }), [])

  const rememberWorkspace = useCallback(() => {
    historyRef.current.push(workspaceSnapshot())
    setHistoryVersion(version => version + 1)
  }, [workspaceSnapshot])

  const restoreWorkspace = useCallback((snapshot: WorkspaceSnapshot) => {
    setBlocks(snapshot.blocks)
    setRegions(snapshot.regions)
    setActiveBlockId(snapshot.activeBlockId)
    setActiveRegionId(snapshot.activeRegionId)
    setFocusMode(snapshot.focusMode)
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [])

  const handleUndo = useCallback(() => {
    const previous = historyRef.current.undo(workspaceSnapshot())
    if (previous) restoreWorkspace(previous)
    setHistoryVersion(version => version + 1)
  }, [restoreWorkspace, workspaceSnapshot])

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo(workspaceSnapshot())
    if (next) restoreWorkspace(next)
    setHistoryVersion(version => version + 1)
  }, [restoreWorkspace, workspaceSnapshot])

  const runReconciliationIfNeeded = useCallback(async (importedBlocks: BlockConfig[]) => {
    const hasHeaders = importedBlocks.some(b => b.headerRows.length > 0 && b.range)
    if (!hasHeaders) return

    const api = univerAPIRef.current
    if (!api) {
      setImportError('Open an Excel file to validate imported config')
      return
    }

    try {
      const sheets: string[] = []
      const wb = api.getActiveWorkbook?.()
      if (wb) {
        const facadeSheets = wb.getSheets()
        if (facadeSheets) {
          for (const s of facadeSheets) {
            sheets.push(s.getSheetName())
          }
        }
      }

      const reports: ReconciliationReport[] = []
      for (const block of importedBlocks) {
        if (!block?.range) continue
        const report = await runReconciliation(block, api, sheets)
        reports.push(report)
      }

      if (reports.length === 0) {
        setImportError('No blocks with valid ranges to reconcile.')
        return
      }

      const hasIssues = reports.some(r => r.status !== 'ok')

      if (hasIssues) {
        setImportError('Some blocks have issues with the current spreadsheet. Click the sync button on each block to review and fix them.')
      } else {
        setImportError(null)
        message.success('Config imported successfully. All blocks match the current spreadsheet.')
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setImportError(`Reconciliation failed: ${detail}`)
      console.error('Reconciliation failed:', err)
    }
  }, [])

  const runReconciliationIfNeededRef = useRef(runReconciliationIfNeeded)
  runReconciliationIfNeededRef.current = runReconciliationIfNeeded

  const applyImportContent = useCallback((content: string) => {
    let imported: any
    try {
      imported = JSON.parse(content)
    } catch (err) {
      setImportError('Invalid config file: failed to parse JSON')
      return
    }

    const loaded = loadSession(imported)
    if (!loaded.session) {
      setImportError(loaded.errors.join(' '))
      return
    }
    if (loaded.migratedFrom) message.info(`Migrated session v${loaded.migratedFrom} to v2.`)
    const deserialized = loaded.session
    const cleanBlocks = deserialized.blocks
    const cleanRegions = deserialized.regions

    setBlocks(cleanBlocks)
    setRegions(cleanRegions)
    if (cleanRegions.length > 0) {
      setActiveRegionId(cleanRegions[0].id)
    }
    setActiveBlockId(deserialized.activeBlockId || cleanBlocks[0]?.id || '')
    setFocusMode(deserialized.focusMode)
    if (deserialized.parseResult) {
      setParseResult(deserialized.parseResult)
    }

    setShouldReParse(true)
    historyRef.current.clear()
    setHistoryVersion(version => version + 1)
    setHasUnsavedChanges(true)
    setTimeout(() => {
      runReconciliationIfNeededRef.current(cleanBlocks)
    }, 300)
  }, [])

  useEffect(() => {
    let active = true
    void getBridge().loadRecovery().then((content) => {
      if (!active || !content) return
      try {
        const loaded = loadSession(JSON.parse(content))
        if (loaded.session) setRecoveryContent(content)
        else void getBridge().clearRecovery()
      } catch {
        void getBridge().clearRecovery()
      }
    }).catch(() => {
      // Recovery is optional; a filesystem issue must not prevent startup.
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const timer = window.setTimeout(() => {
      const session = serializeSession(blocks, regions, activeBlockId, focusMode, parseResult)
      void getBridge().saveRecovery(JSON.stringify({ ...session, sourceFileName: currentFileName ?? undefined })).catch((error) => {
        console.warn('Unable to save workspace recovery data:', error)
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [activeBlockId, blocks, currentFileName, focusMode, hasUnsavedChanges, parseResult, regions])

  const openWorkbookPicker = useCallback(() => {
    setLoadSignal(s => s + 1)
    setParseResult(null)
  }, [])

  const handleOpenFile = useCallback(() => {
    if (hasUnsavedChanges) {
      pendingFileActionRef.current = openWorkbookPicker
      setShowDiscardConfirm(true)
      return
    }
    if (currentFileName) {
      pendingFileActionRef.current = openWorkbookPicker
      setShowWorkbookSwitchConfirm(true)
      return
    }
    openWorkbookPicker()
  }, [currentFileName, hasUnsavedChanges, openWorkbookPicker])

  const closeWorkbook = useCallback(() => {
    const freshBlock = createDefaultBlock(0)
    setBlocks([freshBlock])
    setActiveBlockId(freshBlock.id)
    setRegions([])
    setActiveRegionId(null)
    setActiveSheetName(null)
    setCloseSignal(s => s + 1)
    setCurrentFileName(null)
    setParseResult(null)
    blockCounter = 1
  }, [])

  const handleCloseFile = useCallback(() => {
    pendingFileActionRef.current = closeWorkbook
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true)
      return
    }
    setShowWorkbookCloseConfirm(true)
  }, [closeWorkbook, hasUnsavedChanges])

  const handleConfirmDiscard = useCallback(() => {
    pendingFileActionRef.current?.()
    pendingFileActionRef.current = null
    setShowDiscardConfirm(false)
    setHasUnsavedChanges(false)
    historyRef.current.clear()
    setHistoryVersion(version => version + 1)
    void getBridge().clearRecovery()
  }, [])

  const handleConfirmWorkbookSwitch = useCallback(() => {
    pendingFileActionRef.current?.()
    pendingFileActionRef.current = null
    setShowWorkbookSwitchConfirm(false)
    historyRef.current.clear()
    setHistoryVersion(version => version + 1)
    void getBridge().clearRecovery()
  }, [])

  const handleConfirmWorkbookClose = useCallback(() => {
    pendingFileActionRef.current?.()
    pendingFileActionRef.current = null
    setShowWorkbookCloseConfirm(false)
    setHasUnsavedChanges(false)
    historyRef.current.clear()
    setHistoryVersion(version => version + 1)
    void getBridge().clearRecovery()
  }, [])

  const handleFileLoaded = useCallback((fileName: string) => {
    const freshBlock = createDefaultBlock(0)
    setBlocks([freshBlock])
    setActiveBlockId(freshBlock.id)
    setRegions([])
    setActiveRegionId(null)
    setCurrentFileName(fileName)
    setHasUnsavedChanges(false)
    blockCounter = 1
  }, [])

  const handleSelectionChange = useCallback(async (range: CellRange | null, activeSheet: string | null) => {
    setActiveSheetName(activeSheet)
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
    const workbook = univerAPIRef.current?.getActiveWorkbook()
    const mappings = workbook
      ? suggestMappingsForWorkbook(createUniverWorkbookReader(workbook), range, headerRows, currentBlock?.activeSheet ?? activeSheet)
      : generateColumnMappings(range)

    rememberWorkspace()
    setBlocks(prev => prev.map(b =>
      b.id === blockId ? { ...b, range, activeSheet, columns: mappings } : b,
    ))
    setParseResult(null)
  }, [])

  const handleActivateBlock = useCallback((blockId: string) => {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (block?.activeSheet && !reconcilingBlockIdRef.current) {
      const wb = univerAPIRef.current?.getActiveWorkbook()
      if (wb) {
        const currentSheet = wb.getActiveSheet()
        if (currentSheet?.getSheetName() !== block.activeSheet) {
          wb.setActiveSheet(block.activeSheet)
        }
      }
    }
    setActiveSheetName(block?.activeSheet ?? null)
    setActiveBlockId(blockId)
    setActiveRegionId(null)
  }, [])

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
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleAddBlock = useCallback(() => {
    rememberWorkspace()
    const maxNum = blocksRef.current.reduce((max, b) => {
      const m = (b.label || '').match(/^block_(\d+)$/)
      return m ? Math.max(max, parseInt(m[1], 10)) : max
    }, 0)
    const block = createDefaultBlock(maxNum)
    setBlocks(prev => [...prev, block])
    setActiveBlockId(block.id)
    setActiveRegionId(null)
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleDeleteBlock = useCallback((blockId: string) => {
    rememberWorkspace()
    setBlocks(prev => {
      const next = prev.filter(b => b.id !== blockId)
      if (next.length === 0) {
        const fallback = createDefaultBlock(0)
        setActiveBlockId(fallback.id)
        return [fallback]
      }
      if (blockId === activeBlockIdRef.current) {
        const idx = prev.findIndex(b => b.id === blockId)
        setActiveBlockId(next[Math.min(idx, next.length - 1)].id)
      }
      return next
    })
    setParseResult(null)
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleAddRegion = useCallback(() => {
    rememberWorkspace()
    const region: RegionConfig = {
      id: `region-${Date.now()}`,
      label: `region_${regions.length + 1}`,
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
    setHasUnsavedChanges(true)
  }, [regions.length, rememberWorkspace])

  const handleDeleteRegion = useCallback((regionId: string) => {
    rememberWorkspace()
    setRegions(prev => prev.filter(r => r.id !== regionId))
    if (activeRegionId === regionId) setActiveRegionId(null)
    setHasUnsavedChanges(true)
  }, [activeRegionId, rememberWorkspace])

  const handleRegionChange = useCallback((regionId: string, partial: Partial<RegionConfig>) => {
    rememberWorkspace()
    setRegions(prev => prev.map(r => r.id === regionId ? { ...r, ...partial } : r))
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleActivateRegion = useCallback((regionId: string) => {
    const region = regionsRef.current.find(item => item.id === regionId)
    if (region?.activeSheet) {
      const workbook = univerAPIRef.current?.getActiveWorkbook()
      workbook?.setActiveSheet(region.activeSheet)
      setActiveSheetName(region.activeSheet)
    }
    setActiveRegionId(regionId)
    setActiveBlockId('')
  }, [])

  const handleSelectSheet = useCallback((sheetName: string) => {
    const workbook = univerAPIRef.current?.getActiveWorkbook()
    if (!workbook) return
    workbook.setActiveSheet(sheetName)
    setActiveSheetName(sheetName)
  }, [])

  const moveItem = <T extends { id: string }>(items: T[], id: string, direction: -1 | 1): T[] => {
    const index = items.findIndex(item => item.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= items.length) return items
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  }

  const handleMoveBlock = useCallback((blockId: string, direction: -1 | 1) => {
    rememberWorkspace()
    setBlocks(current => moveItem(current, blockId, direction))
    setHasUnsavedChanges(true)
  }, [rememberWorkspace])

  const handleMoveRegion = useCallback((regionId: string, direction: -1 | 1) => {
    rememberWorkspace()
    setRegions(current => moveItem(current, regionId, direction))
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
    if (!region?.range) return
    const api = univerAPIRef.current
    if (!api) return
    const wb = api.getActiveWorkbook()
    if (!wb) return
    if (region.activeSheet) wb.setActiveSheet(region.activeSheet)
    const sheet = region.activeSheet ? wb.getSheetByName(region.activeSheet) : wb.getActiveSheet()
    if (sheet && region.range) {
      sheet.scrollToCell(Math.max(0, region.range.startRow - 3), Math.max(0, region.range.startCol - 1))
    }
    setActiveRegionId(regionId)
  }, [])

  const handleParse = useCallback(async () => {
    const clearPreview = () => {
      setPreviewModalOpen(false)
      setPreviewModalData(new Map())
      setPreviewRegionResults([])
      setPreviewActiveBlockId('')
    }
    if (!univerAPI) {
      const error = 'Spreadsheet is not initialized'
      clearPreview()
      setParseResult({ success: false, data: {}, blocks: [], error })
      message.error(error)
      return
    }
    const workbook = univerAPI.getActiveWorkbook()
    if (!workbook) {
      const error = 'No workbook loaded'
      clearPreview()
      setParseResult({ success: false, data: {}, blocks: [], error })
      message.error(error)
      return
    }

    const activeBlocks = blocks.filter(b => b.range)
    if (!activeBlocks.length) {
      const error = 'Select a range for at least one block before parsing'
      clearPreview()
      setParseResult({ success: false, data: {}, blocks: [], error })
      message.warning(error)
      return
    }

    const execution = parseWorkbook(createUniverWorkbookReader(workbook), blocks, regions)
    const result = execution.result
    if (!result.success) {
      clearPreview()
      setParseResult(result)
      setDiagnosticsOpen(true)
      message.error(result.error || 'Parsing could not complete. Review the diagnostics for details.')
      return
    }

    for (const block of activeBlocks) {
      const filledValues = execution.snapshots.get(block.id)
      if (!filledValues) continue
      handleBlockChange(block.id, { dataSnapshot: filledValues as unknown[][] })
    }

    setParseResult(result)

    // Build preview data for all blocks and open modal
    const allPreviewData = new Map<string, PreviewData>()
    for (const block of activeBlocks) {
      const patchedBlock = {
        ...block,
        dataSnapshot: execution.snapshots.get(block.id) ?? block.dataSnapshot,
      }
      allPreviewData.set(block.id, adaptPreviewData(patchedBlock, result))
    }
    setPreviewModalData(allPreviewData)
    setPreviewRegionResults(result.regionResults || [])
    setPreviewActiveBlockId(activeBlockId || activeBlocks[0]?.id || '')
    setPreviewModalOpen(true)
  }, [univerAPI, blocks, regions, activeBlockId])

  const doExport = useCallback(async () => {
    if (!univerAPI) {
      message.error('Spreadsheet is not initialized')
      return
    }

    try {
      const blocksWithHeaderSnapshots = await Promise.all(blocks.map(async (block) => {
        if (block.headerRows.length === 0 || !block.range) return block
        const workbook = univerAPI.getActiveWorkbook()
        if (!workbook) return block
        const sheet = block.activeSheet
          ? workbook.getSheetByName(block.activeSheet)
          : workbook.getActiveSheet()
        if (!sheet) return block
        const range = sheet.getRange(block.range.a1Notation)
        const values = range.getValues() as unknown[][]
        const headerSnapshot: string[][] = []
        for (const r of block.headerRows) {
          if (r >= values.length) break
          const row = (values[r] || []).map(v => String(v ?? ''))
          for (let c = 1; c < row.length; c++) {
            if (row[c] === 'undefined' || row[c] === 'null' || row[c] === '') {
              row[c] = row[c - 1]
            }
          }
          headerSnapshot.push(row)
        }
        return { ...block, headerSnapshot }
      }))

      const regionsWithSnapshots = regions.map(region => ({
        ...region,
        blocks: region.blocks.map((b, i) => ({
          ...b,
          label: b.label || `block_${i + 1}`,
        })),
      }))

      const workbook = univerAPI.getActiveWorkbook()
      const freshParseResult = workbook
        ? parseWorkbook(createUniverWorkbookReader(workbook), blocks, regions).result
        : parseResult

      const session = serializeSession(
        blocksWithHeaderSnapshots as BlockConfig[],
        regionsWithSnapshots,
        activeBlockId,
        focusMode,
        freshParseResult,
      )

      const jsonStr = JSON.stringify(session, null, 2)
      const result = await getBridge().saveJson('session.json', jsonStr)
      if (result.success) {
        setHasUnsavedChanges(false)
        void getBridge().clearRecovery()
      } else {
        message.error(result.error || 'Unable to save the JSON file. Your workspace recovery remains available.')
        console.error('Save failed:', result.error)
      }
    } catch (err) {
      message.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
      console.error('Export failed:', err)
    }
  }, [blocks, regions, activeBlockId, focusMode, parseResult, univerAPI])

  const doExportRef = useRef(doExport)
  doExportRef.current = doExport

  const handleExportConfig = useCallback(async () => {
    const errors = validateBlocks(blocks)
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }
    await doExportRef.current()
  }, [blocks])

  const handleImportConfig = useCallback(async () => {
    setImportError(null)
    try {
      const result = await getBridge().openJson()
      if (!result) return // cancelled
      JSON.parse(result.content)

      const activeCount = blocksRef.current.filter(b => b.range).length
      if (activeCount > 0) {
        setPendingImportContent(result.content)
        setShowImportWarning(true)
      } else {
        applyImportContent(result.content)
      }
    } catch (err) {
      const detail = err instanceof SyntaxError ? err.message : String(err)
      const prefix = err instanceof SyntaxError ? 'Invalid config file' : 'Unable to import config'
      setImportError(`${prefix}: ${detail}`)
      console.error('Import failed:', err)
    }
  }, [applyImportContent])

  const handleConfirmImport = useCallback(() => {
    if (pendingImportContent) {
      applyImportContent(pendingImportContent)
    }
    setShowImportWarning(false)
    setPendingImportContent(null)
  }, [pendingImportContent])

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
    if (shouldReParse && blocks.length > 0) {
      setShouldReParse(false)
      if (blocks.some(b => b.range)) {
        handleParse()
      }
    }
  }, [shouldReParse, blocks, handleParse])

  useEffect(() => {
    if (!activeSheetName && sheetNames[0]) setActiveSheetName(sheetNames[0])
  }, [activeSheetName, sheetNames])

  const configurationDiagnostics = useMemo(() => validateBlocks(blocks), [blocks])
  const parseDiagnostics = parseResult?.diagnostics ?? []
  const diagnosticCount = configurationDiagnostics.length + parseDiagnostics.length

  const handleFocusDiagnostic = useCallback((diagnostic: NonNullable<ParseResult['diagnostics']>[number]) => {
    if (diagnostic.blockId) {
      const block = blocksRef.current.find(item => item.id === diagnostic.blockId)
      if (block) {
        handleActivateBlock(block.id)
        const workbook = univerAPIRef.current?.getActiveWorkbook()
        const sheet = block.activeSheet ? workbook?.getSheetByName(block.activeSheet) : workbook?.getActiveSheet()
        if (sheet && block.range) sheet.scrollToCell(Math.max(0, block.range.startRow - 2), Math.max(0, block.range.startCol - 1))
      }
    } else if (diagnostic.regionId) {
      handleActivateRegion(diagnostic.regionId)
      handleRegionRangeClick(diagnostic.regionId)
    }
    setDiagnosticsOpen(false)
  }, [handleActivateBlock, handleActivateRegion, handleRegionRangeClick])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) handleRedo(); else handleUndo(); return }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); handleRedo(); return }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); handleOpenFile(); return }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); handleExportConfig(); return }
      if (event.key === 'Enter' && blocksRef.current.some(block => block.range)) { event.preventDefault(); handleParse() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleExportConfig, handleOpenFile, handleParse, handleRedo, handleUndo])

  const navigator = <WorkspaceNavigator
    fileName={currentFileName}
    sheetNames={sheetNames}
    activeSheet={activeSheetName}
    blocks={blocks}
    regions={regions}
    activeBlockId={activeBlockId}
    activeRegionId={activeRegionId}
    onOpen={handleOpenFile}
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
            <small>Extraction workspace</small>
          </span>
        </div>
        <Tooltip title="Workspace navigation">
          <Button className="workspace-mobile-nav" aria-label="Workspace navigation" size="small" type="text" icon={<MenuOutlined />} onClick={() => setWorkspaceNavOpen(true)} />
        </Tooltip>
        {currentFileName && (
          <span className="workbook-chip" title={currentFileName}>
            <span className="workbook-chip-label">WORKBOOK</span>
            <span className="workbook-chip-name">
              {currentFileName}
            </span>
            <Tooltip title="Close file">
              <Button aria-label="Close workbook" size="small" type="text" icon={<CloseOutlined />} onClick={handleCloseFile} />
            </Tooltip>
          </span>
        )}
        <Space className="app-actions" size={6}>
          <Tooltip title="Undo">
            <Button aria-keyshortcuts="Control+Z Meta+Z" aria-label="Undo" icon={<UndoOutlined />} onClick={handleUndo} disabled={!historyRef.current.canUndo} />
          </Tooltip>
          <Tooltip title="Redo">
            <Button aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" aria-label="Redo" icon={<RedoOutlined />} onClick={handleRedo} disabled={!historyRef.current.canRedo} />
          </Tooltip>
          <Button aria-keyshortcuts="Control+O Meta+O" icon={<FolderOpenOutlined />} onClick={handleOpenFile}>
            Open Excel
          </Button>
          <Tooltip title="Parse data and open preview window">
            <Button
              icon={<PlayCircleOutlined />}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onClick={handleParse}
              disabled={!blocks.some(b => b.range)}
            >
              Parse & Preview
            </Button>
          </Tooltip>
          <Tooltip title="Save session (config + data)">
            <Button
              type="primary"
              icon={<ExportOutlined />}
              aria-keyshortcuts="Control+S Meta+S"
              disabled={blocks.length === 0}
              onClick={handleExportConfig}
            >
              Export
            </Button>
          </Tooltip>
          <Tooltip title="Restore saved session">
            <Button icon={<ImportOutlined />} onClick={handleImportConfig}>
              Import
            </Button>
          </Tooltip>
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
                <SpreadsheetPanel
                  activeBlockId={activeBlockId}
                  activeRegionId={activeRegionId}
                  activeColIndex={activeColIndex}
                  onSelectionChange={handleSelectionChange}
                  onActiveSheetChange={setActiveSheetName}
                  loadSignal={loadSignal}
                  onFileLoaded={handleFileLoaded}
                  lockedRanges={lockedRanges}
                  closeSignal={closeSignal}
                  onOpenWorkbook={handleOpenFile}
                />
              </section>
            </Splitter.Panel>
            <Splitter.Panel defaultSize="30%" min="18%">
              <aside className="inspector-panel" aria-label="Extraction inspector">
                <header className="panel-heading inspector-heading">
                  <div><span className="panel-kicker">CONFIGURE</span><strong>Extraction setup</strong></div>
                  <span>{blocks.filter(block => block.range).length} active</span>
                </header>
                <ConfigPanel
                  blocks={blocks}
                  activeBlockId={activeBlockId}
                  activeColIndex={activeColIndex}
                  focusMode={focusMode}
                  parseResult={parseResult}
                  regions={regions}
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
        title="Replace Existing Blocks?"
        open={showImportWarning}
        onCancel={() => { setShowImportWarning(false); setPendingImportContent(null) }}
        onOk={handleConfirmImport}
        okText="Replace All"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
      >
        <p>
          You have {blocks.filter(b => b.range).length} active block(s) with configured ranges.
          Importing will replace ALL blocks and their configurations.
        </p>
        <p>This action cannot be undone.</p>
      </Modal>
      <Modal
        title="Discard unsaved changes?"
        open={showDiscardConfirm}
        onCancel={() => { setShowDiscardConfirm(false); pendingFileActionRef.current = null }}
        onOk={handleConfirmDiscard}
        okText="Discard"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
      >
        <p>You have unsaved changes. Discarding will lose all modifications since your last export.</p>
      </Modal>
      <Modal
        title="Switch workbook?"
        open={showWorkbookSwitchConfirm}
        onCancel={() => { setShowWorkbookSwitchConfirm(false); pendingFileActionRef.current = null }}
        onOk={handleConfirmWorkbookSwitch}
        okText="Switch workbook"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
      >
        <p>Opening another workbook will replace the current workbook and its extraction setup.</p>
      </Modal>
      <Modal
        title="Close workbook?"
        open={showWorkbookCloseConfirm}
        onCancel={() => { setShowWorkbookCloseConfirm(false); pendingFileActionRef.current = null }}
        onOk={handleConfirmWorkbookClose}
        okText="Close workbook"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
      >
        <p>Closing will remove the current workbook and its extraction setup from this workspace.</p>
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
        <p>An unsaved workspace from a previous session is available.</p>
        <p>Recover it to continue where you left off, or discard it to start fresh.</p>
      </Modal>
      <Modal
        title="Validation errors"
        open={validationErrors !== null}
        onCancel={() => setValidationErrors(null)}
        onOk={() => { setValidationErrors(null); doExportRef.current() }}
        okText="Export anyway"
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

export function App() {
  return (
    <ConfigProvider>
      <UniverProvider>
        <AppContent />
      </UniverProvider>
    </ConfigProvider>
  )
}
