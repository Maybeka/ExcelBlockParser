import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Button, Layout, Modal, Splitter, Space, theme, ConfigProvider, Tooltip, message, Alert } from 'antd'
import { FolderOpenOutlined, ExportOutlined, PlayCircleOutlined, ImportOutlined, CloseOutlined } from '@ant-design/icons'
import { UniverProvider } from './context/UniverContext'
import { SpreadsheetPanel } from './components/SpreadsheetPanel'
import { ConfigPanel } from './components/ConfigPanel'
import type { CellRange, ColumnMapping, ColumnType, BlockConfig, ParseResult, ExportedSession, ReconciliationReport } from './types'
import type { FocusMode } from './components/ConfigPanel'
import { useUniver } from './context/UniverContext'
import { runReconciliation } from './services/reconciliation'
import { getBridge } from './services/bridge'

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

function createDefaultBlock(existingCount: number): BlockConfig {
  const num = existingCount + 1
  return {
    id: nextBlockId(),
    label: `Block ${num}`,
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
  const { univerAPI } = useUniver()
  const univerAPIRef = useRef(univerAPI)
  univerAPIRef.current = univerAPI

  const defaultBlock = createDefaultBlock(0)
  const [blocks, setBlocks] = useState<BlockConfig[]>([defaultBlock])
  const [activeBlockId, setActiveBlockId] = useState<string>(defaultBlock.id)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [loadSignal, setLoadSignal] = useState(0)
  const [focusMode, setFocusMode] = useState<FocusMode>('always-editable')
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
  const [currentFileName, setCurrentFileName] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [closeSignal, setCloseSignal] = useState(0)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const pendingFileActionRef = useRef<(() => void) | null>(null)
  const pendingReconcilingRangeRef = useRef<{ range: CellRange; activeSheet: string | null } | null>(null)

  const activeBlockIdRef = useRef(activeBlockId)
  activeBlockIdRef.current = activeBlockId
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

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
    const config = imported.config

    // Filter out null/undefined entries, strip headerSnapshot, handle duplicate IDs, apply defaults
    const seenIds = new Set<string>()
    const validBlocks = (config.blocks || []).filter((b: any) => b != null)
    const cleanBlocks: BlockConfig[] = validBlocks.map((b: any, idx: number) => {
      // Keep headerSnapshot on the block for reconciliation (not part of BlockConfig type but used at runtime)
      const { headerSnapshot: _hs, ...block } = b
      let id: string = block.id || `block_${idx}`
      if (seenIds.has(id)) {
        id = `${id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      }
      seenIds.add(id)
      return {
        id,
        label: String(block.label || `Block ${idx}`).slice(0, 100),
        range: block.range || null,
        activeSheet: block.activeSheet || null,
        headerRows: Array.isArray(block.headerRows) ? block.headerRows : [0],
        collapsed: block.collapsed ?? false,
        selectionLocked: block.selectionLocked ?? false,
        columns: Array.isArray(block.columns) ? block.columns : [],
        dataSnapshot: Array.isArray((block as any).dataSnapshot) ? (block as any).dataSnapshot : null,
        ...(_hs ? { headerSnapshot: _hs as string[] } : {}),
      } as BlockConfig & { headerSnapshot?: string[] }
    })

    setBlocks(cleanBlocks)
    setActiveBlockId(config.activeBlockId || cleanBlocks[0]?.id || '')
    setFocusMode(config.focusMode || 'always-editable')

    if (imported.data && imported.blockResults) {
      setParseResult({ success: true, data: imported.data, blocks: imported.blockResults })
    } else {
      setParseResult(null)
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
    setCurrentFileName(fileName)
    setHasUnsavedChanges(false)
    blockCounter = 1
  }, [])

  const handleSelectionChange = useCallback(async (range: CellRange | null, activeSheet: string | null) => {
    const blockId = activeBlockIdRef.current
    const currentBlock = blocksRef.current.find(b => b.id === blockId)

    // When reconciling, track selection for Reselect Range even if locked
    if (reconcilingBlockIdRef.current && range) {
      pendingReconcilingRangeRef.current = { range, activeSheet }
    }

    if (range && currentBlock?.selectionLocked) return

    // Single-cell click (not a drag-selected range) — treat as no selection
    if (range && range.startRow === range.endRow && range.startCol === range.endCol) {
      range = null
    }

    if (!range) {
      // Don't clear range for locked blocks (e.g. sheet switch triggered by
      // handleActivateBlock should not wipe the locked block's configured range).
      if (currentBlock?.selectionLocked) return
      setBlocks(prev => prev.map(b =>
        b.id === blockId ? { ...b, range: null, columns: [] } : b,
      ))
      setParseResult(null)
      return
    }

    const headerRows = currentBlock?.headerRows ?? [0]
    const api = univerAPIRef.current
    const mappings = api
      ? await suggestColumnMappings(range, headerRows, currentBlock?.activeSheet ?? null, api)
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
    setActiveBlockId(blockId)
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
    const block = createDefaultBlock(blocksRef.current.length)
    setBlocks(prev => [...prev, block])
    setActiveBlockId(block.id)
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

    try {
      const blockResults = []
      const namedData: Record<string, unknown> = {}

      for (const block of activeBlocks) {
        const sheet = block.activeSheet
          ? workbook.getSheetByName(block.activeSheet)
          : workbook.getActiveSheet()

        if (!sheet) continue

        const frange = sheet.getRange(block.range!.a1Notation)
        const rawValues = frange.getValues() as unknown[][]
        handleBlockChange(block.id, { dataSnapshot: [...rawValues] as unknown[][] })

        const activeColumns = block.columns.filter(c => !c.skip)
        if (!activeColumns.length) {
          blockResults.push({ blockId: block.id, label: block.label, data: [], rowCount: 0 })
          namedData[block.label] = []
          continue
        }

        const headers = activeColumns.map(c => c.key || c.suggestedKey)
        const headerSet = new Set(block.headerRows)
        const dataRows = rawValues.filter((_, i) => !headerSet.has(i))
        const startCol = block.range!.startCol

        const data = dataRows.map(row => {
          const entry: Record<string, unknown> = {}
          activeColumns.forEach((col, mappedIdx) => {
            const raw = row[col.colIndex - startCol]
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

      setParseResult({ success: true, data: namedData, blocks: blockResults })
    } catch (err) {
      setParseResult({ success: false, data: {}, blocks: [], error: String(err) })
    }
  }, [univerAPI, blocks])

  const handleExportConfig = useCallback(async () => {
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
          // Replicate merged-cell values left-to-right (Univer returns empty for merged cells)
          for (let c = 1; c < row.length; c++) {
            if (row[c] === 'undefined' || row[c] === 'null' || row[c] === '') {
              row[c] = row[c - 1]
            }
          }
          headerSnapshot.push(row)
        }
        return { ...block, headerSnapshot }
      }))

      const session: ExportedSession = {
        version: 1,
        exportedAt: new Date().toISOString(),
        config: {
          blocks: blocksWithHeaderSnapshots as BlockConfig[] & { headerSnapshot?: string[][] }[],
          activeBlockId,
          focusMode,
        },
        data: parseResult?.data || {},
        blockResults: parseResult?.blocks || [],
      }

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
  }, [blocks, activeBlockId, focusMode, parseResult, univerAPI])

  const handleImportConfig = useCallback(async () => {
    setImportError(null)
    const result = await getBridge().openJson()
    if (!result) return // cancelled
    try {
      const parsed = JSON.parse(result.content)
      if (parsed.version !== 1) {
        if (typeof parsed.version === 'number') {
          message.warning(`Config was created by a different version (v${parsed.version}). Import may not work correctly.`)
        } else {
          setImportError('Invalid config file: missing or unsupported version')
          return
        }
      }
      if (!parsed.config || !Array.isArray(parsed.config.blocks)) {
        setImportError('Invalid config file: missing or invalid blocks array')
        return
      }
      if (typeof parsed.config.activeBlockId !== 'string') {
        setImportError('Invalid config file: missing or invalid activeBlockId')
        return
      }

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

    const reconciling = reconcilingBlockId
      ? blocks
          .filter(b => b.id === reconcilingBlockId && (reconcilingPreviewRange || b.range))
          .map(b => ({ blockId: b.id, range: reconcilingPreviewRange || b.range!, activeSheet: reconcilingPreviewSheet || b.activeSheet, color: '#fa8c16' }))
      : []

    return [...selectionLocked, ...reconciling]
  }, [blocks, reconcilingBlockId, reconcilingPreviewSheet, reconcilingPreviewRange])

  useEffect(() => {
    if (shouldReParse && blocks.length > 0) {
      setShouldReParse(false)
      if (blocks.some(b => b.range)) {
        handleParse()
      }
    }
  }, [shouldReParse, blocks, handleParse])

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
          <Button icon={<FolderOpenOutlined />} onClick={handleOpenFile}>
            Open Excel
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={handleParse}
            disabled={!blocks.some(b => b.range)}
          >
            Parse & Preview
          </Button>
          <Tooltip title="Save session (config + data)">
            <Button
              type="primary"
              icon={<ExportOutlined />}
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
      <Layout.Content style={{ overflow: 'hidden' }}>
        <div style={{ height: '100%', padding: 0 }}>
          <Splitter style={{ height: '100%' }}>
            <Splitter.Panel defaultSize="65%" min="40%" max="80%">
              <div style={{ height: '100%', overflow: 'hidden' }}>
                <SpreadsheetPanel
                  activeBlockId={activeBlockId}
                  activeColIndex={activeColIndex}
                  onSelectionChange={handleSelectionChange}
                  loadSignal={loadSignal}
                  onFileLoaded={handleFileLoaded}
                  lockedRanges={lockedRanges}
                  closeSignal={closeSignal}
                />
              </div>
            </Splitter.Panel>
            <Splitter.Panel defaultSize="35%" min="20%">
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
                  onActivateBlock={handleActivateBlock}
                  onBlockChange={handleBlockChange}
                  onAddBlock={handleAddBlock}
                  onDeleteBlock={handleDeleteBlock}
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
                    onClearParseResult={() => setParseResult(null)}
                />
              </div>
            </Splitter.Panel>
          </Splitter>
        </div>
      </Layout.Content>
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
