import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Badge, Button, Drawer, Layout, Modal, Splitter, Space, theme, ConfigProvider, Tooltip, message, Alert, Tabs, Table, Empty } from 'antd'
import { FolderOpenOutlined, ExportOutlined, PlayCircleOutlined, ImportOutlined, CloseOutlined, MenuOutlined, WarningOutlined } from '@ant-design/icons'
import { UniverProvider } from './context/UniverContext'
import { SpreadsheetPanel } from './components/SpreadsheetPanel'
import { ConfigPanel, validateBlocks } from './components/ConfigPanel'
import type { CellRange, ColumnMapping, ColumnType, BlockConfig, BlockParseResult, ParseResult, ExportedSession, ReconciliationReport, RegionConfig, RegionBlockResult, RegionParseResult } from './types'
import type { FocusMode } from './components/ConfigPanel'
import { useUniver } from './context/UniverContext'
import { runReconciliation } from './services/reconciliation'
import { detectBlocks } from './services/regionDetector'
import { getBridge } from './services/bridge'
import { adaptPreviewData } from './services/previewDataAdapter'
import { serializeSession, loadSession } from './services/serializer'
import { createUniverWorkbookReader } from './services/workbook'
import { parseWorkbook, suggestMappingsForWorkbook } from './services/extraction'
import { PreviewWindow } from './components/PreviewWindow'
import type { PreviewData } from './types'
import { WorkspaceNavigator } from './components/WorkspaceNavigator'
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer'

function colIndexToLetter(index: number): string {
  let letter = ''
  let n = index
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}

function sanitizeToCamelCase(str: string): string {
  return str
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .split(/[\s_-]+/)
    .map((word, i) => {
      if (!word) return ''
      const lower = word.toLowerCase()
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
    .replace(/^(\d)/, '_$1')
    || 'column'
}

function inferColumnType(values: unknown[]): ColumnType {
  const samples = values.filter(v => v !== null && v !== undefined && v !== '').slice(0, 10)
  if (samples.length === 0) return 'string'

  const allNumbers = samples.every(v =>
    typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))),
  )
  if (allNumbers) {
    const allIntegers = samples.every(v => Number.isInteger(Number(v)))
    return allIntegers ? 'integer' : 'float'
  }

  const allBooleans = samples.every(v => {
    if (typeof v === 'boolean') return true
    const s = String(v).trim().toLowerCase()
    return ['true', 'false', 'yes', 'no', '1', '0'].includes(s)
  })
  if (allBooleans) return 'boolean'

  const allDates = samples.every(v => {
    if (v instanceof Date) return true
    if (typeof v === 'number' && v > 45000 && v < 200000) return true
    const d = new Date(v as string | number)
    return !isNaN(d.getTime()) && d.getFullYear() > 1900
  })
  if (allDates) return 'date'

  return 'string'
}

function generateColumnMappings(range: CellRange): ColumnMapping[] {
  return Array.from({ length: range.endCol - range.startCol + 1 }, (_, i) => {
    const col = range.startCol + i
    const letter = colIndexToLetter(col)
    return {
      colIndex: col,
      colLetter: letter,
      suggestedKey: `column_${letter}`,
      key: `column_${letter}`,
      type: 'auto' as const,
      skip: false,
      valueMap: [],
    }
  })
}

async function suggestColumnMappings(
  range: CellRange,
  headerRows: number[],
  activeSheet: string | null,
  api: NonNullable<ReturnType<typeof useUniver>['univerAPI']>,
): Promise<ColumnMapping[]> {
  try {
    const workbook = api.getActiveWorkbook()
    if (!workbook) return generateColumnMappings(range)
    const sheet = activeSheet
      ? (workbook.getSheetByName(activeSheet) ?? workbook.getActiveSheet())
      : workbook.getActiveSheet()
    if (!sheet) return generateColumnMappings(range)

    const frange = sheet.getRange(range.a1Notation)
    const rawValues = frange.getValues() as unknown[][]

    const colCount = range.endCol - range.startCol + 1
    const columns: ColumnMapping[] = []

    const headerSet = new Set(headerRows)

    for (let i = 0; i < colCount; i++) {
      const col = range.startCol + i
      const letter = colIndexToLetter(col)

      let suggestedKey: string
      if (headerRows.length > 0 && rawValues[0]) {
        const keyParts: string[] = []
        for (const r of headerRows) {
          if (r >= rawValues.length) break
          const val = rawValues[r]?.[i]
          if (val != null && String(val).trim()) {
            keyParts.push(String(val).trim())
          }
        }
        suggestedKey = keyParts.length > 0
          ? sanitizeToCamelCase(keyParts.join(' '))
          : `column_${letter}`
      } else {
        suggestedKey = `column_${letter}`
      }

      const colValues = rawValues.filter((_, idx) => !headerSet.has(idx)).map(row =>
        row && i < row.length ? row[i] : null,
      )
      const inferredType = inferColumnType(colValues)

      columns.push({
        colIndex: col,
        colLetter: letter,
        suggestedKey,
        key: suggestedKey,
        type: inferredType,
        skip: false,
        valueMap: [],
      })
    }

    return columns
  } catch {
    return generateColumnMappings(range)
  }
}

function applyValueMap(raw: unknown, valueMap: { from: string; to: unknown }[]): { mapped: boolean; value: unknown } {
  if (raw === null || raw === undefined) return { mapped: false, value: null }
  const rawStr = String(raw).trim()
  const entry = valueMap.find(e => e.from === rawStr)
  if (entry) return { mapped: true, value: entry.to }
  return { mapped: false, value: raw }
}

function convertValue(raw: unknown, type: ColumnType): unknown {
  if (raw === null || raw === undefined) return null
  switch (type) {
    case 'string': return String(raw)
    case 'integer': {
      const n = parseInt(String(raw), 10)
      return isNaN(n) ? null : n
    }
    case 'float': {
      const n = Number(raw)
      return isNaN(n) ? null : n
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      const s = String(raw).trim().toLowerCase()
      if (s === 'true' || s === '1' || s === 'yes') return true
      if (s === 'false' || s === '0' || s === 'no' || s === '') return false
      return null
    }
    case 'date': {
      if (raw instanceof Date) return raw.toISOString().split('T')[0]
      const d = new Date(raw as string | number)
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
    }
    case 'valueMapping':
      return raw
    default: return raw
  }
}

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
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null)
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
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
    setTimeout(() => {
      runReconciliationIfNeededRef.current(cleanBlocks)
    }, 300)
  }, [])

  const handleOpenFile = useCallback(() => {
    if (hasUnsavedChanges) {
      pendingFileActionRef.current = () => {
        setLoadSignal(s => s + 1)
        setParseResult(null)
      }
      setShowDiscardConfirm(true)
      return
    }
    setLoadSignal(s => s + 1)
    setParseResult(null)
  }, [hasUnsavedChanges])

  const handleCloseFile = useCallback(() => {
    if (hasUnsavedChanges) {
      pendingFileActionRef.current = () => {
        const freshBlock = createDefaultBlock(0)
        setBlocks([freshBlock])
        setActiveBlockId(freshBlock.id)
        setRegions([])
        setActiveRegionId(null)
        setCloseSignal(s => s + 1)
        setCurrentFileName(null)
        setParseResult(null)
        blockCounter = 1
      }
      setShowDiscardConfirm(true)
      return
    }
    const freshBlock = createDefaultBlock(0)
    setBlocks([freshBlock])
    setActiveBlockId(freshBlock.id)
    setRegions([])
    setActiveRegionId(null)
    setCloseSignal(s => s + 1)
    setCurrentFileName(null)
    setParseResult(null)
    blockCounter = 1
  }, [hasUnsavedChanges])

  const handleConfirmDiscard = useCallback(() => {
    pendingFileActionRef.current?.()
    pendingFileActionRef.current = null
    setShowDiscardConfirm(false)
    setHasUnsavedChanges(false)
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
        setRegions(prev => prev.map(r =>
          r.id === regionId ? { ...r, range: null } : r,
        ))
        setParseResult(null)
        return
      }
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
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, ...partial } : b))
    setHasUnsavedChanges(true)
  }, [])

  const handleAddBlock = useCallback(() => {
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
  }, [])

  const handleDeleteBlock = useCallback((blockId: string) => {
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
  }, [])

  const handleAddRegion = useCallback(() => {
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
  }, [regions.length])

  const handleDeleteRegion = useCallback((regionId: string) => {
    setRegions(prev => prev.filter(r => r.id !== regionId))
    if (activeRegionId === regionId) setActiveRegionId(null)
    setHasUnsavedChanges(true)
  }, [activeRegionId])

  const handleRegionChange = useCallback((regionId: string, partial: Partial<RegionConfig>) => {
    setRegions(prev => prev.map(r => r.id === regionId ? { ...r, ...partial } : r))
    setHasUnsavedChanges(true)
  }, [])

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
    setBlocks(current => moveItem(current, blockId, direction))
    setHasUnsavedChanges(true)
  }, [])

  const handleMoveRegion = useCallback((regionId: string, direction: -1 | 1) => {
    setRegions(current => moveItem(current, regionId, direction))
    setHasUnsavedChanges(true)
  }, [])

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

  /* Superseded by parseWorkbook in services/extraction.ts.
  function performParse(
    workbook: any,
    regions: RegionConfig[],
    blocks: BlockConfig[],
  ): ParseResult | null {
    const regionResults: RegionParseResult[] = []

    for (const region of regions) {
      if (!region.range) continue
      const sheet = region.activeSheet
        ? workbook.getSheetByName(region.activeSheet)
        : workbook.getActiveSheet()
      if (!sheet) continue

      const frange = sheet.getRange(region.range.a1Notation)
      const rawValues = frange.getValues() as unknown[][]
      const stringRows: string[][] = rawValues.map(row =>
        row.map(cell => cell === null || cell === undefined ? '' : String(cell))
      )

      const blockRanges = detectBlocks(region.range, region.splitRules, (r, c) => {
        const rr = r - region.range!.startRow
        const cc = c - region.range!.startCol
        return (stringRows[rr] && stringRows[rr][cc]) || ''
      })

      const regionBlocks: RegionBlockResult[] = []
      for (let i = 0; i < blockRanges.length; i++) {
        const br = blockRanges[i]
        const blockRows = stringRows.slice(br.startRow - region.range.startRow, br.endRow - region.range.startRow + 1)
        regionBlocks.push({ blockLabel: `block_${i + 1}`, rows: blockRows })
      }

      regionResults.push({ regionId: region.id, label: region.label, blocks: regionBlocks })
    }

    const activeBlocks = blocks.filter(b => b.range)
    if (!activeBlocks.length) return null

    const blockResults: BlockParseResult[] = []
    const namedData: Record<string, unknown> = {}

    for (const block of activeBlocks) {
      const sheet = block.activeSheet
        ? workbook.getSheetByName(block.activeSheet)
        : workbook.getActiveSheet()
      if (!sheet) continue

      const frange = sheet.getRange(block.range!.a1Notation)
      const rawValues = frange.getValues() as unknown[][]

      const activeColumns = block.columns.filter(c => !c.skip)
      if (!activeColumns.length) {
        blockResults.push({ blockId: block.id, label: block.label, data: [], rowCount: 0 })
        namedData[block.label] = []
        continue
      }

      const headers = activeColumns.map(c => c.key || c.suggestedKey)
      const headerSet = new Set(block.headerRows)
      const dataRows = rawValues.filter((_, i) => !headerSet.has(i))

      const data = dataRows.map(row => {
        const entry: Record<string, unknown> = {}
        activeColumns.forEach((col, mappedIdx) => {
          const raw = col.colIndex < row.length ? row[col.colIndex] : null
          const effectiveType = col.type === 'valueMapping'
            ? (col.valueMapFallbackType ?? 'auto')
            : col.type
          if (col.valueMap.length > 0) {
            const { mapped, value } = applyValueMap(raw, col.valueMap)
            entry[headers[mappedIdx]] = mapped ? value : convertValue(value, effectiveType)
          } else {
            entry[headers[mappedIdx]] = convertValue(raw, effectiveType)
          }
        })
        return entry
      })

      blockResults.push({ blockId: block.id, label: block.label, data, rowCount: data.length })
      namedData[block.label] = data
    }

    return { success: true, data: namedData, blocks: blockResults, regionResults }
  }

  */
  const handleParse = useCallback(async () => {
    if (!univerAPI) {
      setParseResult({ success: false, data: {}, blocks: [], error: 'Univer not initialized' })
      return
    }
    const workbook = univerAPI.getActiveWorkbook()
    if (!workbook) {
      setParseResult({ success: false, data: {}, blocks: [], error: 'No workbook loaded' })
      return
    }

    const activeBlocks = blocks.filter(b => b.range)
    if (!activeBlocks.length) {
      setParseResult({ success: false, data: {}, blocks: [], error: 'No blocks with a selected range' })
      return
    }

    const execution = parseWorkbook(createUniverWorkbookReader(workbook), blocks, regions)
    const result = execution.result
    if (!result.success) {
      setParseResult(result)
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
      } else {
        console.error('Save failed:', result.error)
      }
    } catch (err) {
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
    const result = await getBridge().openJson()
    if (!result) return // cancelled
    try {
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
      setImportError(`Invalid config file: ${detail}`)
      console.error('Import parse error:', err)
    }
  }, [])

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
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); handleOpenFile(); return }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); handleExportConfig(); return }
      if (event.key === 'Enter' && blocksRef.current.some(block => block.range)) { event.preventDefault(); handleParse() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleExportConfig, handleOpenFile, handleParse])

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
    <Layout style={{ height: '100vh' }}>
      <Layout.Header style={{
        height: 48, lineHeight: '48px', padding: '0 16px',
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{ fontSize: 16, fontWeight: 600, marginRight: 8 }}>
          Excel Block Parser
        </span>
        <Tooltip title="Workspace navigation">
          <Button className="workspace-mobile-nav" aria-label="Workspace navigation" size="small" type="text" icon={<MenuOutlined />} onClick={() => setWorkspaceNavOpen(true)} style={{ marginRight: 4 }} />
        </Tooltip>
        {currentFileName && (
          <>
            <span style={{
              fontSize: 12, color: token.colorTextSecondary,
              maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', marginRight: 4,
            }} title={currentFileName}>
              {currentFileName}
            </span>
            <Tooltip title="Close file">
              <Button size="small" type="text" icon={<CloseOutlined />}
                onClick={handleCloseFile} style={{ marginRight: 12 }} />
            </Tooltip>
          </>
        )}
        <Space>
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
      <Layout.Content style={{ overflow: 'hidden', display: 'flex' }}>
        <aside className="workspace-desktop-nav" style={{ width: 224, flex: '0 0 224px', borderRight: `1px solid ${token.colorBorderSecondary}` }}>
          {navigator}
        </aside>
        <div style={{ height: '100%', minWidth: 0, flex: 1 }}>
          <Splitter style={{ height: '100%' }}>
            <Splitter.Panel defaultSize="70%" min="45%" max="82%">
              <div style={{ height: '100%', overflow: 'hidden' }}>
                <SpreadsheetPanel
                  activeBlockId={activeBlockId}
                  activeRegionId={activeRegionId}
                  activeColIndex={activeColIndex}
                  onSelectionChange={handleSelectionChange}
                  loadSignal={loadSignal}
                  onFileLoaded={handleFileLoaded}
                  lockedRanges={lockedRanges}
                  closeSignal={closeSignal}
                />
              </div>
            </Splitter.Panel>
            <Splitter.Panel defaultSize="30%" min="18%">
              <div style={{
                height: '100%', overflow: 'auto',
                borderLeft: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
              }}>
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
                  onFocusModeChange={setFocusMode}
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
              </div>
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
        <Button
          type="text"
          icon={<CloseOutlined style={{ fontSize: 18, color: '#fff' }} />}
          onClick={() => setPreviewModalOpen(false)}
          style={{
            position: 'absolute',
            top: -18,
            right: -18,
            zIndex: 1001,
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)', borderRadius: '50%',
          }}
        />
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
