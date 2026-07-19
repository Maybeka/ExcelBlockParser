import { useCallback, useState, useRef, useEffect, useMemo, Fragment } from 'react'
import { Input, InputNumber, Select, Checkbox, Button, Switch, Segmented, Tooltip, Modal, Typography, AutoComplete, Divider, Tag, Dropdown } from 'antd'
import { PlusOutlined, DeleteOutlined, CaretDownOutlined, CaretRightOutlined, SettingOutlined, SearchOutlined, ClearOutlined, ReloadOutlined, CloseOutlined, EditOutlined, CheckOutlined, ExpandOutlined, CompressOutlined, TagOutlined } from '@ant-design/icons'
import type { CellRange, ColumnType, ColumnMapping, BlockConfig, ValueMapEntry, ParseResult, ValueMapFallbackType, ReconciliationReport, RegionConfig, Tag as TagType } from '../types'
import { useUniver } from '../context/UniverContext'
import { remapColumns } from '../services/columnMapper'
import { runReconciliation } from '../services/reconciliation'
import { addTag, removeTag, filterBlocksByTag, getAllTags } from '../services/tagUtils'
import { validateExpression } from '../services/pythonValidator'
import { RegionPanel } from './RegionPanel'
import { BlockCard } from './BlockCard'

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: 'auto', label: 'auto' },
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
  { value: 'valueMapping', label: 'value mapping' },
]

const FALLBACK_TYPE_OPTIONS: { value: ValueMapFallbackType; label: string }[] = [
  { value: 'auto', label: 'auto' },
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
]

export type FocusMode = 'always-editable' | 'activate-first'

interface ConfigPanelProps {
  blocks: BlockConfig[]
  activeBlockId: string
  activeColIndex: number | null
  focusMode: FocusMode
  parseResult: ParseResult | null
  regions: RegionConfig[]
  activeRegionId: string | null
  onActivateBlock: (blockId: string) => void
  onBlockChange: (blockId: string, partial: Partial<BlockConfig>) => void
  onAddBlock: () => void
  onDeleteBlock: (blockId: string) => void
  onAddRegion: () => void
  onDeleteRegion: (regionId: string) => void
  onRegionChange: (regionId: string, partial: Partial<RegionConfig>) => void
  onActivateRegion?: (regionId: string) => void
  onRegionRangeClick?: (regionId: string) => void
  onFocusModeChange: (mode: FocusMode) => void
  onColumnFocus: (colIndex: number | null) => void
  onParse: () => void
  onReconcilingChange?: (blockId: string | null) => void
  onReselectRange?: (onRange: (range: CellRange) => void) => void
  onPreviewSheet?: (sheetName: string | null) => void
}

function parseToValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (raw !== '' && !isNaN(Number(raw))) return Number(raw)
  return raw
}

function headerRowsToKey(parts: string[]): string {
  return parts
    .map(p => p.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').toLowerCase())
    .filter(Boolean)
    .join('_')
    .replace(/^(\d)/, '_$1')
    || 'column'
}

export function isValidVariableName(name: string): boolean {
  if (!name.trim()) return true
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
}

export function validateBlocks(blocks: BlockConfig[]): string[] {
  const errors: string[] = []

  const labelCounts = new Map<string, number>()
  blocks.forEach(b => { const l = (b.label || '').trim(); if (l) labelCounts.set(l, (labelCounts.get(l) || 0) + 1) })
  labelCounts.forEach((count, l) => { if (count > 1) errors.push(`Duplicate block name: "${l}"`) })

  blocks.forEach(b => {
    if (b.label && !isValidVariableName(b.label)) {
      errors.push(`Invalid block name: "${b.label}"`)
    }
  })

  blocks.forEach(b => {
    const keyCounts = new Map<string, number>()
    b.columns.forEach(c => {
      const k = c.key || c.suggestedKey
      if (k) {
        keyCounts.set(k, (keyCounts.get(k) || 0) + 1)
        if (!isValidVariableName(k)) errors.push(`Invalid key in "${b.label || 'block'}": "${k}"`)
      }
    })
    keyCounts.forEach((count, k) => { if (count > 1) errors.push(`Duplicate key in "${b.label || 'block'}": "${k}"`) })
  })

  return errors
}

/**
 * Parse "1-3, 5" → [0, 1, 2, 4] (0-based, deduplicated, sorted).
 * "1,2,3" → [0, 1, 2]
 * "4" → [3]
 * Returns null for invalid input (empty, letters only, zero, negative).
 */
const renderOption = (option: { label?: unknown; value?: unknown }) => {
  const label = typeof option.label === 'string' ? option.label : String(option.value ?? '')
  return <span title={label}>{option.label as React.ReactNode}</span>
}

function parseHeaderRowsInput(input: string): number[] | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Reject partial/incomplete input so user can keep typing
  if (/[-,]$/.test(trimmed)) return null

  const rows = new Set<number>()
  const parts = trimmed.split(/\s*,\s*/)

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (start < 1 || end < 1 || start > end) return null
      for (let r = start; r <= end; r++) rows.add(r - 1)
    } else if (/^\d+$/.test(part)) {
      const single = parseInt(part, 10)
      if (single < 1) return null
      rows.add(single - 1)
    } else {
      return null
    }
  }

  if (rows.size === 0) return null
  return [...rows].sort((a, b) => a - b)
}

function ReconciliationTabs({ report, block, onApply, onClose, onReselectRange, sheetNames, univerRef, onPreviewSheet, onColumnFocus }: {
  report: ReconciliationReport
  block: BlockConfig
  onApply: (block: BlockConfig) => void
  onClose: () => void
  onReselectRange?: (onRange: (range: CellRange) => void) => void
  sheetNames: string[]
  univerRef: { current: any }
  onPreviewSheet?: (sheetName: string | null) => void
  onColumnFocus?: (colIndex: number | null) => void
}) {
  const [step, setStep] = useState(0)
  const [columns, setColumns] = useState(block.columns)
  const [selectedSheet, setSelectedSheet] = useState(block.activeSheet || '')
  const [selectedRange, setSelectedRange] = useState(block.range)
  const [hoveredColIndex, setHoveredColIndex] = useState<number | null>(null)

  const colToLetter = (index: number) => {
    let letter = ''
    let n = index
    while (n >= 0) {
      letter = String.fromCharCode((n % 26) + 65) + letter
      n = Math.floor(n / 26) - 1
    }
    return letter
  }

  const switchSheet = (sheetName: string) => {
    setSelectedSheet(sheetName || '')
    onPreviewSheet?.(sheetName || null)
    const api = univerRef.current
    if (!api) return
    const wb = api.getActiveWorkbook()
    if (wb) wb.setActiveSheet(sheetName)
  }

  useEffect(() => {
    const range = selectedRange || block.range
    if (!range) return
    const colCount = range.endCol - range.startCol + 1
    const remapped = remapColumns(block.columns, [], colCount)
    const visible = remapped
      .filter(c => c.colIndex < colCount)
      .map(c => ({
        ...c,
        colIndex: c.colIndex + range.startCol,
        colLetter: colToLetter(c.colIndex + range.startCol),
      }))
    setColumns(visible)
  }, [selectedRange?.a1Notation])

  const existingKeys = block.columns
    .filter(c => !c.skip)
    .map(c => ({ value: c.key }))

  const handleCancel = () => {
    const api = univerRef.current
    if (api && block.activeSheet) {
      const wb = api.getActiveWorkbook()
      if (wb) wb.setActiveSheet(block.activeSheet)
    }
    onClose()
  }

  const handleReselectRange = () => {
    onReselectRange?.((range) => {
      setSelectedRange(range)
    })
  }

  const steps = [
    { title: 'Sheet', key: 'sheet' },
    { title: 'Range', key: 'range' },
    { title: 'Columns', key: 'columns' },
  ]

  const circled = ['①', '②', '③']

  const stepLabel = (i: number) => `${circled[i]} ${steps[i].title}`

  const renderStepIndicator = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <span style={{ color: '#d9d9d9', fontSize: 11, margin: '0 2px' }}>→</span>}
          <span
            style={{
              fontSize: 12,
              fontWeight: i === step ? 600 : 400,
              color: i === step ? '#1677ff' : i < step ? '#52c41a' : '#999',
              cursor: i < step ? 'pointer' : 'default',
            }}
            onClick={i < step ? () => setStep(i) : undefined}
          >
            {i < step ? '✓ ' : ''}{stepLabel(i)}
          </span>
        </Fragment>
      ))}
    </div>
  )

  const renderFooter = () => (
    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid #f0f0f0' }}>
      {step > 0 && (
        <Button size="small" onClick={() => setStep(step - 1)}>
          Prev: {steps[step - 1].title}
        </Button>
      )}
      {step < 2 && (
        <Button type="primary" size="small" onClick={() => setStep(step + 1)}>
          Next: {steps[step + 1].title}
        </Button>
      )}
      <Button type="primary" size="small" onClick={() => onApply({
        ...block,
        columns,
        activeSheet: selectedSheet || block.activeSheet,
        range: selectedRange || block.range,
      })}>
        Apply & Close
      </Button>
      <Button size="small" onClick={handleCancel}>Cancel</Button>
    </div>
  )

  const renderStep0 = () => (
    <div style={{ padding: '8px 12px' }}>
      <Typography.Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
        Choose which sheet this block should reference.
      </Typography.Text>
      <Select
        size="small"
        style={{ width: '100%' }}
        value={selectedSheet || undefined}
        placeholder="Auto (active sheet)"
        onChange={switchSheet}
        options={sheetNames.map(s => ({ value: s, label: s }))}
        allowClear
        optionRender={renderOption}
      />
    </div>
  )

  const renderStep1 = () => (
    <div style={{ padding: '8px 12px' }}>
      <Typography.Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
        Current range: <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>
          {selectedRange?.a1Notation || block.range?.a1Notation}
        </span>
      </Typography.Text>
      <Typography.Text style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 8 }}>
        {report.issues.filter(i => ['row-shifted', 'content-changed'].includes(i.type)).map(i => i.message).join('; ') || 'No range issues detected.'}
      </Typography.Text>
      <Button size="small" onClick={handleReselectRange}>Reselect Range</Button>
    </div>
  )

  const renderStep2 = () => {
    const dupKeys = new Set<string>()
    const keyCounts = new Map<string, number>()
    columns.filter(c => !c.skip).forEach(c => {
      const k = c.key || c.suggestedKey
      keyCounts.set(k, (keyCounts.get(k) || 0) + 1)
    })
    keyCounts.forEach((count, k) => { if (count > 1) dupKeys.add(k) })

    return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 36px', gap: '4px 6px', alignItems: 'center', padding: '2px 0', fontSize: 11, color: '#999' }}>
        <span>Col</span>
        <span>Key</span>
        <span>Type</span>
        <span>Skip</span>
      </div>
      {columns.map(col => (
        <div key={col.colIndex} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 36px', gap: '4px 6px', alignItems: 'center', marginBottom: 4,
          background: hoveredColIndex === col.colIndex ? 'rgba(250, 140, 22, 0.06)' : 'transparent', borderRadius: 4, padding: '2px 6px' }}
          onMouseEnter={() => { setHoveredColIndex(col.colIndex); onColumnFocus?.(col.colIndex) }}
          onMouseLeave={() => { setHoveredColIndex(null); onColumnFocus?.(null) }}
        >
          <span
            style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#666', cursor: 'pointer' }}
            onClick={() => {
              const range = selectedRange || block.range
              if (!range) return
              const api = univerRef.current
              if (!api) return
              const wb = api.getActiveWorkbook()
              if (!wb) return
              const activeSheet = selectedSheet || block.activeSheet
              if (activeSheet) wb.setActiveSheet(activeSheet)
              const sheet = activeSheet ? wb.getSheetByName(activeSheet) : wb.getActiveSheet()
              if (sheet) sheet.scrollToCell(Math.max(0, range.startRow - 1), Math.max(0, col.colIndex - 3))
            }}
          >{col.colLetter}</span>
          <AutoComplete
            size="small"
            value={col.key}
            onChange={v => setColumns(prev => prev.map(c => c.colIndex === col.colIndex ? { ...c, key: v } : c))}
            options={existingKeys}
            style={{ fontSize: 13 }}
            status={dupKeys.has(col.key || col.suggestedKey) || (col.key && !isValidVariableName(col.key)) ? 'error' : undefined}
          />
          {dupKeys.has(col.key || col.suggestedKey) && (
            <div style={{ gridColumn: '2', fontSize: 10, color: '#ff4d4f', lineHeight: 1.2, marginTop: -2 }}>
              Duplicate key
            </div>
          )}
          {col.key && !isValidVariableName(col.key) && (
            <div style={{ gridColumn: '2', fontSize: 10, color: '#ff4d4f', lineHeight: 1.2, marginTop: -2 }}>
              Invalid variable name
            </div>
          )}
          <Select size="small" value={col.type} onChange={v => setColumns(prev => prev.map(c => c.colIndex === col.colIndex ? { ...c, type: v } : c))} options={[{value:'auto',label:'auto'},{value:'string',label:'string'},{value:'integer',label:'integer'},{value:'float',label:'float'},{value:'boolean',label:'boolean'},{value:'date',label:'date'}]} style={{ width: 90 }} optionRender={renderOption} />
          <Checkbox checked={col.skip} onChange={e => setColumns(prev => prev.map(c => c.colIndex === col.colIndex ? { ...c, skip: e.target.checked } : c))} />
        </div>
      ))}
    </div>
  )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {renderStepIndicator()}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 4 }}>
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
      </div>
      {renderFooter()}
    </div>
  )
}

export function ConfigPanel({
  blocks,
  activeBlockId,
  activeColIndex,
  focusMode,
  parseResult,
  regions,
  activeRegionId,
  onActivateBlock,
  onBlockChange,
  onAddBlock,
  onDeleteBlock,
  onAddRegion,
  onDeleteRegion,
  onRegionChange,
  onActivateRegion,
  onRegionRangeClick,
  onFocusModeChange,
  onColumnFocus,
  onParse,
  onReconcilingChange,
  onReselectRange,
  onPreviewSheet,
}: ConfigPanelProps) {
  const [expandedMaps, setExpandedMaps] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string; type: 'block' | 'region' } | null>(null)
  const [reconcilingBlockId, setReconcilingBlockId] = useState<string | null>(null)
  const [reconReports, setReconReports] = useState<Record<string, ReconciliationReport>>({})
  const [reconHeights, setReconHeights] = useState<Record<string, number>>({})
  const normalContentRef = useRef<Record<string, HTMLDivElement | null>>({})
  const blockContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const blockInputRefs = useRef<Record<string, { focus: () => void; select: () => void } | null>>({})
  const shouldAutoFocus = useRef(false)
  const prevBlockCountRef = useRef(blocks.length)
  const { univerAPI, sheetNames } = useUniver()

  const [searchText, setSearchText] = useState('')
  const [searchTarget, setSearchTarget] = useState<'all' | 'title' | 'columnName' | 'tag'>('all')
  const [tagFilter, setTagFilter] = useState<string | undefined>(undefined)
  const [expandedRowFilters, setExpandedRowFilters] = useState<Set<string>>(new Set())
  const [expandedComputedProps, setExpandedComputedProps] = useState<Set<string>>(new Set())
  const [showTagsBlocks, setShowTagsBlocks] = useState<Set<string>>(new Set())
  const [addingTagForBlock, setAddingTagForBlock] = useState<string | null>(null)
  const [newTagInput, setNewTagInput] = useState('')

  const allTags = useMemo(() => getAllTags(blocks), [blocks])

  const filteredBlocks = useMemo(() => {
    let result = blocks
    if (searchText.trim()) {
      const query = searchText.toLowerCase().trim()
      result = result.filter(block => {
        const label = (block.label || '').toLowerCase()
        const columns = block.columns || []

        switch (searchTarget) {
          case 'title':
            return label.includes(query)
          case 'columnName':
            return columns.some(c => {
              const effectiveKey = (c.key || c.suggestedKey || '').toLowerCase()
              return effectiveKey.includes(query)
            })
          case 'tag':
            return (block.tags || []).some(t => {
              const tagKey = t.key.toLowerCase()
              const tagVal = (t.value || '').toLowerCase()
              return tagKey.includes(query) || tagVal.includes(query)
            })
          default:
            if (label.includes(query)) return true
            return columns.some(c => {
              const effectiveKey = (c.key || c.suggestedKey || '').toLowerCase()
              return effectiveKey.includes(query)
            })
        }
      })
    }
    if (tagFilter) {
      result = filterBlocksByTag(result, tagFilter)
    }
    return result
  }, [blocks, searchText, searchTarget, tagFilter])

  interface ColumnTableState {
    active: boolean
    loading: boolean
    values: Array<{ value: string; count: number }> | null
    search: string
  }
  const [columnTables, setColumnTables] = useState<Record<string, ColumnTableState>>({})
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const univerRef = useRef(univerAPI)
  univerRef.current = univerAPI

  const handleAdd = useCallback(() => {
    shouldAutoFocus.current = true
    onAddBlock()
  }, [onAddBlock])

  useEffect(() => {
    if (shouldAutoFocus.current && blocks.length > prevBlockCountRef.current) {
      shouldAutoFocus.current = false
      const lastBlock = blocks[blocks.length - 1]
      requestAnimationFrame(() => {
        blockContainerRefs.current[lastBlock.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        const input = blockInputRefs.current[lastBlock.id]
        input?.focus()
        input?.select()
      })
    }
    prevBlockCountRef.current = blocks.length
  }, [blocks])

  const scrollToCellCenter = (sheet: any, row: number, col: number) => {
    sheet.scrollToCell(Math.max(0, row - 3), Math.max(0, col - 1))
  }

  const fetchColumnData = useCallback(async (mapKey: string, blockId: string, colIndex: number) => {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block?.range) {
      setColumnTables(prev => ({ ...prev, [mapKey]: { ...prev[mapKey], loading: false } }))
      return
    }
    try {
      const api = univerRef.current
      if (!api) { setColumnTables(prev => ({ ...prev, [mapKey]: { ...prev[mapKey], loading: false } })); return }
      const workbook = api.getActiveWorkbook()
      if (!workbook) { setColumnTables(prev => ({ ...prev, [mapKey]: { ...prev[mapKey], loading: false } })); return }
      const sheet = block.activeSheet ? workbook.getSheetByName(block.activeSheet) : workbook.getActiveSheet()
      if (!sheet) { setColumnTables(prev => ({ ...prev, [mapKey]: { ...prev[mapKey], loading: false } })); return }
      const frange = sheet.getRange(block.range.a1Notation)
      const rawValues = frange.getValues() as unknown[][]
      const startCol = block.range.startCol
      const headerSet = new Set(block.headerRows)
      const dataRows = rawValues.filter((_, i) => !headerSet.has(i))
      const countMap = new Map<string, number>()
      const order: string[] = []
      for (const row of dataRows) {
        const val = row[colIndex - startCol]
        if (val !== null && val !== undefined && val !== '') {
          const str = String(val).trim()
          if (!countMap.has(str)) order.push(str)
          countMap.set(str, (countMap.get(str) || 0) + 1)
        }
      }
      const values = order.map(value => ({ value, count: countMap.get(value)! }))
      setColumnTables(prev => ({
        ...prev,
        [mapKey]: { ...prev[mapKey], loading: false, values, search: prev[mapKey]?.search || '' },
      }))
    } catch {
      setColumnTables(prev => ({ ...prev, [mapKey]: { ...prev[mapKey], loading: false } }))
    }
  }, [])

  const toggleTableView = useCallback((mapKey: string, blockId: string, colIndex: number) => {
    setColumnTables(prev => {
      const current = prev[mapKey]
      if (current?.active) return { ...prev, [mapKey]: { ...current, active: false } }
      return { ...prev, [mapKey]: { active: true, loading: true, values: current?.values || null, search: current?.search || '' } }
    })
    fetchColumnData(mapKey, blockId, colIndex)
  }, [fetchColumnData])

  const setColumnSearch = useCallback((mapKey: string, search: string) => {
    setColumnTables(prev => {
      const current = prev[mapKey]
      if (!current) return prev
      return { ...prev, [mapKey]: { ...current, search } }
    })
  }, [])

  const addMappingForValue = useCallback((blockId: string, colIndex: number, fromValue: string) => {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return
    const col = block.columns.find(c => c.colIndex === colIndex)
    if (!col) return
    const exists = col.valueMap.some(e => e.from === fromValue)
    if (exists) return
    onBlockChange(blockId, {
      columns: block.columns.map(c =>
        c.colIndex === colIndex
          ? { ...c, valueMap: [...c.valueMap, { from: fromValue, to: '' }] }
          : c,
      ),
    })
  }, [onBlockChange])

  const removeMappingForValue = useCallback((blockId: string, colIndex: number, fromValue: string) => {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return
    const col = block.columns.find(c => c.colIndex === colIndex)
    if (!col) return
    onBlockChange(blockId, {
      columns: block.columns.map(c =>
        c.colIndex === colIndex
          ? { ...c, valueMap: c.valueMap.filter(e => e.from !== fromValue) }
          : c,
      ),
    })
  }, [onBlockChange])

  const addAllUnmapped = useCallback((blockId: string, colIndex: number) => {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return
    const col = block.columns.find(c => c.colIndex === colIndex)
    if (!col) return
    const mapKey = `${blockId}-${colIndex}`
    const tableState = columnTables[mapKey]
    if (!tableState?.values) return
    const existingFroms = new Set(col.valueMap.map(e => e.from))
    const newEntries = tableState.values
      .filter(v => !existingFroms.has(v.value))
      .map(v => ({ from: v.value, to: '' as unknown }))
    if (!newEntries.length) return
    onBlockChange(blockId, {
      columns: block.columns.map(c =>
        c.colIndex === colIndex
          ? { ...c, valueMap: [...c.valueMap, ...newEntries] }
          : c,
      ),
    })
  }, [onBlockChange, columnTables])

  const clearAllMappings = useCallback((blockId: string, colIndex: number) => {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return
    onBlockChange(blockId, {
      columns: block.columns.map(c =>
        c.colIndex === colIndex ? { ...c, valueMap: [] } : c,
      ),
    })
  }, [onBlockChange])

  const toggleValueMap = useCallback((key: string) => {
    setExpandedMaps(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const updateColumn = useCallback((blockId: string, colIndex: number, partial: Partial<ColumnMapping>) => {
    onBlockChange(blockId, {
      columns: blocks.find(b => b.id === blockId)?.columns.map(c =>
        c.colIndex === colIndex ? { ...c, ...partial } : c,
      ),
    })
  }, [blocks, onBlockChange])

  const regenerateColumnKey = useCallback((blockId: string, colIndex: number) => {
    const block = blocks.find(b => b.id === blockId)
    if (!block?.range) return
    const api = univerRef.current
    if (!api) return
    const workbook = api.getActiveWorkbook()
    if (!workbook) return
    const sheet = block.activeSheet ? workbook.getSheetByName(block.activeSheet) : workbook.getActiveSheet()
    if (!sheet) return
    const frange = sheet.getRange(block.range.a1Notation)
    const rawValues = frange.getValues() as unknown[][]
    const relCol = colIndex - block.range.startCol
    const keyParts: string[] = []
    for (const r of block.headerRows) {
      if (r >= rawValues.length) break
      const val = rawValues[r]?.[relCol]
      if (val != null && String(val).trim()) {
        keyParts.push(String(val).trim())
      }
    }
    const newKey = keyParts.length > 0
      ? headerRowsToKey(keyParts)
      : block.columns.find(c => c.colIndex === colIndex)?.colLetter
        ? `column_${block.columns.find(c => c.colIndex === colIndex)!.colLetter}`
        : 'column'
    updateColumn(blockId, colIndex, { key: newKey })
  }, [blocks, updateColumn])

  const regenerateAllColumnKeys = useCallback((blockId: string) => {
    const block = blocks.find(b => b.id === blockId)
    if (!block?.range) return
    const api = univerRef.current
    if (!api) return
    const workbook = api.getActiveWorkbook()
    if (!workbook) return
    const sheet = block.activeSheet ? workbook.getSheetByName(block.activeSheet) : workbook.getActiveSheet()
    if (!sheet) return
    const frange = sheet.getRange(block.range.a1Notation)
    const rawValues = frange.getValues() as unknown[][]

    const updatedColumns = block.columns.map(col => {
      const relCol = col.colIndex - block.range!.startCol
      const keyParts: string[] = []
      for (const r of block.headerRows) {
        if (r >= rawValues.length) break
        const val = rawValues[r]?.[relCol]
        if (val != null && String(val).trim()) {
          keyParts.push(String(val).trim())
        }
      }
      const newKey = keyParts.length > 0
        ? headerRowsToKey(keyParts)
        : `column_${col.colLetter}`
      return { ...col, key: newKey }
    })

    onBlockChange(blockId, { columns: updatedColumns })
  }, [blocks, onBlockChange])

  const addValueMapEntry = useCallback((blockId: string, colIndex: number) => {
    const block = blocks.find(b => b.id === blockId)
    if (!block) return
    const col = block.columns.find(c => c.colIndex === colIndex)
    if (!col) return
    onBlockChange(blockId, {
      columns: block.columns.map(c =>
        c.colIndex === colIndex
          ? { ...c, valueMap: [...c.valueMap, { from: '', to: '' }] }
          : c,
      ),
    })
  }, [blocks, onBlockChange])

  const updateValueMapEntry = useCallback((
    blockId: string, colIndex: number, entryIndex: number, field: 'from' | 'to', value: string,
  ) => {
    const block = blocks.find(b => b.id === blockId)
    if (!block) return
    const col = block.columns.find(c => c.colIndex === colIndex)
    if (!col) return
    const newMap = col.valueMap.map((e, i) =>
      i === entryIndex ? { ...e, [field]: field === 'to' ? parseToValue(value) : value } : e,
    )
    onBlockChange(blockId, {
      columns: block.columns.map(c =>
        c.colIndex === colIndex ? { ...c, valueMap: newMap } : c,
      ),
    })
  }, [blocks, onBlockChange])

  const removeValueMapEntry = useCallback((blockId: string, colIndex: number, entryIndex: number) => {
    const block = blocks.find(b => b.id === blockId)
    if (!block) return
    const col = block.columns.find(c => c.colIndex === colIndex)
    if (!col) return
    onBlockChange(blockId, {
      columns: block.columns.map(c =>
        c.colIndex === colIndex
          ? { ...c, valueMap: col.valueMap.filter((_, i) => i !== entryIndex) }
          : c,
      ),
    })
  }, [blocks, onBlockChange])

  if (!blocks.length) {
    return (
      <div style={{ padding: 16 }}><Dropdown.Button style={{ width: '100%' }} icon={<PlusOutlined />} onClick={handleAdd} menu={{ items: [{ key: 'add-region', label: 'Add Region', onClick: onAddRegion }] }}>Add</Dropdown.Button></div>
    )
  }

  const dupLabels = new Set<string>()
  const labelCounts = new Map<string, number>()
  blocks.forEach(b => {
    const l = (b.label || '').trim()
    if (l) labelCounts.set(l, (labelCounts.get(l) || 0) + 1)
  })
  labelCounts.forEach((count, l) => { if (count > 1) dupLabels.add(l) })

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>
            Blocks
            <span style={{ fontSize: 12, color: '#999', marginLeft: 8, fontWeight: 400 }}>
              {searchText ? `${filteredBlocks.length}/${blocks.length}` : blocks.length}
            </span>
          </h3>
          <Tooltip title="Collapse all">
            <Button
              size="small" type="text"
              icon={<CompressOutlined />}
              onClick={() => {
                blocks.forEach(b => { if (!b.collapsed) onBlockChange(b.id, { collapsed: true }) })
                regions.forEach(r => { if (!r.collapsed) onRegionChange(r.id, { collapsed: true }) })
              }}
            />
          </Tooltip>
          <Tooltip title="Expand all">
            <Button
              size="small" type="text"
              icon={<ExpandOutlined />}
              onClick={() => {
                blocks.forEach(b => { if (b.collapsed) onBlockChange(b.id, { collapsed: false }) })
                regions.forEach(r => { if (r.collapsed) onRegionChange(r.id, { collapsed: false }) })
              }}
            />
          </Tooltip>
          <Divider type="vertical" style={{ margin: '0 4px' }} />
          <Tooltip title={showSearch ? 'Hide search' : 'Search blocks'}>
            <Button
              size="small" type="text"
              icon={<SearchOutlined />}
              onClick={() => {
                const next = !showSearch
                setShowSearch(next)
                if (!next) setSearchText('')
              }}
              style={{ color: showSearch ? '#1677ff' : undefined }}
            />
          </Tooltip>
          <Tooltip title="Settings">
            <Button
              size="small" type="text"
              icon={<SettingOutlined />}
              onClick={() => setShowSettings(s => !s)}
              style={{ color: showSettings ? '#1677ff' : undefined }}
            />
          </Tooltip>
          <span style={{ marginLeft: 12, flexShrink: 0 }}>
            <Dropdown.Button
              size="small"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              menu={{
                items: [{ key: 'add-region', label: 'Add Region', onClick: onAddRegion }],
              }}
            >
              Add
            </Dropdown.Button>
          </span>
        </div>

      <Divider style={{ margin: '0 0 8px 0' }} />

      {showSettings && (
        <div style={{ marginBottom: 12, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Lock controls in inactive blocks</span>
          <Switch
            size="small"
            checked={focusMode === 'activate-first'}
            onChange={v => onFocusModeChange(v ? 'activate-first' : 'always-editable')}
          />
        </div>
      )}

      {showSettings && showSearch && <Divider style={{ margin: '0 0 8px 0' }} />}

      {showSearch && (
        <>
          <div style={{ marginBottom: 12, display: 'flex', gap: 6 }}>
            <Select
              size="small"
              value={searchTarget}
              onChange={setSearchTarget}
              style={{ width: 96, flexShrink: 0 }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'title', label: 'Title' },
                { value: 'columnName', label: 'Key' },
                { value: 'tag', label: 'Tag' },
              ]}
              optionRender={renderOption}
            />
            <Input
              size="small"
              placeholder="Search blocks..."
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              allowClear
              style={{ flex: 1 }}
            />
          </div>
          {allTags.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Select
                size="small"
                value={tagFilter}
                onChange={setTagFilter}
                allowClear
                placeholder="Filter by tag..."
                style={{ width: '100%' }}
                options={allTags.map(t => ({ value: t.key, label: t.type === 'kv' ? `${t.key}:${t.value || ''}` : t.key }))}
              />
            </div>
          )}
        </>
      )}

      {(showSearch || showSettings) && <Divider style={{ margin: '0 0 8px 0' }} />}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
      {filteredBlocks.map((block) => {
        const isActive = block.id === activeBlockId
        const controlsLocked = focusMode === 'activate-first' && !isActive
        const isReconciling = reconcilingBlockId !== null
        const isOtherBlockInReconciling = isReconciling && block.id !== reconcilingBlockId
        const effectivelyCollapsed = block.collapsed || isOtherBlockInReconciling
        const headerLabel = block.label?.trim() || `block_${blocks.indexOf(block) + 1}`
        const visibleColumns = block.columns

        const dupKeys = new Set<string>()
        const keyCounts = new Map<string, number>()
        visibleColumns.filter(c => !c.skip).forEach(c => {
          const k = c.key || c.suggestedKey
          keyCounts.set(k, (keyCounts.get(k) || 0) + 1)
        })
        ;(block.computedProperties || []).forEach(p => {
          const l = p.label?.trim()
          if (l) keyCounts.set(l, (keyCounts.get(l) || 0) + 1)
        })
        keyCounts.forEach((count, k) => { if (count > 1) dupKeys.add(k) })

        return (
          <div
            key={block.id}
            ref={(el) => { blockContainerRefs.current[block.id] = el }}
            onMouseDown={() => { if (!isOtherBlockInReconciling) onActivateBlock(block.id) }}
            style={{
              marginBottom: 8,
              border: `1px solid ${isActive ? '#1677ff' : '#d9d9d9'}`,
              borderRadius: 6,
              borderLeft: isActive ? '3px solid #1677ff' : '3px solid transparent',
              background: isActive ? '#f0f5ff' : '#fafafa',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                borderBottom: effectivelyCollapsed ? 'none' : '1px solid #f0f0f0',
              }}
            >
              <span
                onClick={() => { if (!isOtherBlockInReconciling) onBlockChange(block.id, { collapsed: !block.collapsed }) }}
                style={{ color: isOtherBlockInReconciling ? '#d9d9d9' : '#999', cursor: isOtherBlockInReconciling ? 'default' : 'pointer', fontSize: 12 }}
              >
                {effectivelyCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
              </span>
              <Input
                size="small"
                ref={(el) => { blockInputRefs.current[block.id] = el }}
                value={block.label}
                onChange={e => onBlockChange(block.id, { label: e.target.value })}
                placeholder={headerLabel}
                style={{ flex: 1, fontSize: 13, fontWeight: 600 }}
                variant="borderless"
                disabled={controlsLocked || isOtherBlockInReconciling}
                status={
                  (block.label && !isValidVariableName(block.label)) || dupLabels.has(block.label?.trim() || '')
                    ? 'error' : undefined
                }
              />
              {block.range && (
                <Tooltip title={`${block.activeSheet || '(active sheet)'}!${block.range.a1Notation} — click to go`}>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isOtherBlockInReconciling) return
                      onActivateBlock(block.id)
                      const api = univerRef.current
                      if (!api) return
                      const wb = api.getActiveWorkbook()
                      if (!wb) return
                      if (block.activeSheet) wb.setActiveSheet(block.activeSheet)
                      const targetSheet = block.activeSheet ? wb.getSheetByName(block.activeSheet) : wb.getActiveSheet()
                      if (targetSheet && block.range) {
                        scrollToCellCenter(targetSheet, block.range.startRow, block.range.startCol)
                      }
                    }}
                    onMouseDown={e => e.stopPropagation()}
                    style={{
                      fontSize: 12, color: '#1677ff', fontFamily: 'monospace',
                      maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      cursor: 'pointer',
                    }}>
                    {block.activeSheet ? `${block.activeSheet}!` : ''}{block.range.a1Notation}
                  </span>
                </Tooltip>
              )}
              {!block.selectionLocked && block.range && !isOtherBlockInReconciling && (
                <Tooltip title="Confirm block">
                  <Button
                    size="small" type="text"
                    icon={<CheckOutlined style={{ color: '#52c41a' }} />}
                    onClick={() => onBlockChange(block.id, { selectionLocked: true })}
                    onMouseDown={e => e.stopPropagation()}
                  />
                </Tooltip>
              )}
              {block.selectionLocked && (
                <Tooltip title={reconcilingBlockId === block.id ? 'Discard editing' : 'Edit block'}>
                  <Button
                    size="small" type="text"
                    icon={reconcilingBlockId === block.id ? <CloseOutlined /> : <EditOutlined />}
                    onClick={async (e) => {
                    e.stopPropagation()
                    if (controlsLocked || !block?.range) return
                    onActivateBlock(block.id)
                    if (reconcilingBlockId === block.id) {
                      const a = univerRef.current
                      if (a && block.activeSheet) {
                        const w = a.getActiveWorkbook()
                        if (w) w.setActiveSheet(block.activeSheet)
                      }
                      setReconcilingBlockId(null)
                      onReconcilingChange?.(null)
                      return
                    }
                    const api = univerRef.current
                    if (!api) return
                    const wb = api.getActiveWorkbook()
                    if (block.activeSheet && wb) {
                      wb.setActiveSheet(block.activeSheet)
                    }
                    const el = normalContentRef.current[block.id]
                    if (el) setReconHeights(prev => ({ ...prev, [block.id]: el.offsetHeight }))
                    const sheets: string[] = []
                    if (wb) {
                      const fs = wb.getSheets()
                      if (fs) for (const s of fs) sheets.push(s.getSheetName())
                    }
                    const report = await runReconciliation(block, api, sheets)
                    setReconReports(prev => ({ ...prev, [block.id]: report }))
                    onPreviewSheet?.(block.activeSheet || wb?.getActiveSheet()?.getSheetName() || null)
                    setReconcilingBlockId(block.id)
                    onReconcilingChange?.(block.id)
                  }}
                  disabled={controlsLocked || !block.range || (reconcilingBlockId !== null && reconcilingBlockId !== block.id)}
                  style={{ opacity: block.range ? 1 : 0.3, color: reconcilingBlockId === block.id ? '#1677ff' : undefined }}
                />
              </Tooltip>
              )}
              <Divider type="vertical" style={{ margin: '0 2px', borderColor: '#d9d9d9' }} />
              <Tooltip title={showTagsBlocks.has(block.id) ? 'Hide tags' : 'Show tags'}>
                <Button
                  size="small" type="text"
                  icon={<TagOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    const next = new Set(showTagsBlocks)
                    showTagsBlocks.has(block.id) ? next.delete(block.id) : next.add(block.id)
                    setShowTagsBlocks(next)
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  style={{ color: showTagsBlocks.has(block.id) ? '#1677ff' : undefined }}
                >
                  {block.tags?.length ? <span style={{ fontSize: 11, marginLeft: 4 }}>{block.tags.length}</span> : null}
                </Button>
              </Tooltip>
              <Divider type="vertical" style={{ margin: '0 2px', borderColor: '#d9d9d9' }} />
              <Button
                size="small" type="text" danger
                icon={<DeleteOutlined />}
                onClick={() => setDeleteTarget({ id: block.id, label: headerLabel, type: 'block' })}
                onMouseDown={e => e.stopPropagation()}
                disabled={controlsLocked}
              />
            </div>

            {/* Tag chips */}
            {!effectivelyCollapsed && showTagsBlocks.has(block.id) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px 4px 34px', overflow: 'auto' }}>
                {(block.tags || []).map((tag, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, fontSize: 11, color: '#1677ff', whiteSpace: 'nowrap' }}>
                    {i > 0 && <span style={{ color: '#bbb', margin: '0 2px' }}>/</span>}
                    <Tag
                      closable
                      onClose={() => {
                        const tags = removeTag({ ...block, tags: block.tags }, tag.key).tags || []
                        onBlockChange(block.id, { tags })
                      }}
                      style={{ margin: 0, fontSize: 11 }}
                    >
                      {tag.type === 'kv' ? `${tag.key}:${tag.value || ''}` : tag.key}
                    </Tag>
                  </span>
                ))}
                {block.tags && block.tags.length > 0 && <span style={{ color: '#bbb', margin: '0 2px' }}>/</span>}
                <Button size="small" type="dashed" icon={<PlusOutlined />}
                  onClick={() => setAddingTagForBlock(block.id)}
                  style={{ fontSize: 11, height: 22, padding: '0 6px', flexShrink: 0 }}>
                  Tag
                </Button>
                {addingTagForBlock === block.id && (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    <Input
                      size="small"
                      value={newTagInput}
                      onChange={e => setNewTagInput(e.target.value)}
                      placeholder="tag or key:value"
                      onPressEnter={() => {
                        if (!newTagInput.trim()) return
                        const colonIdx = newTagInput.indexOf(':')
                        const tag: TagType = colonIdx > 0
                          ? { type: 'kv', key: newTagInput.slice(0, colonIdx).trim(), value: newTagInput.slice(colonIdx + 1).trim() || undefined }
                          : { type: 'label', key: newTagInput.trim() }
                        onBlockChange(block.id, { tags: addTag({ ...block, tags: block.tags }, tag).tags })
                        setAddingTagForBlock(null)
                        setNewTagInput('')
                      }}
                      style={{ width: 130, fontSize: 12 }}
                    />
                    <Button size="small" type="link" onClick={() => {
                      if (!newTagInput.trim()) return
                      const colonIdx = newTagInput.indexOf(':')
                      const tag: TagType = colonIdx > 0
                        ? { type: 'kv', key: newTagInput.slice(0, colonIdx).trim(), value: newTagInput.slice(colonIdx + 1).trim() || undefined }
                        : { type: 'label', key: newTagInput.trim() }
                      onBlockChange(block.id, { tags: addTag({ ...block, tags: block.tags }, tag).tags })
                      setAddingTagForBlock(null)
                      setNewTagInput('')
                    }}>✓</Button>
                    <Button size="small" type="text" onClick={() => { setAddingTagForBlock(null); setNewTagInput('') }}>✗</Button>
                  </div>
                )}
              </div>
            )}

            {block.label && !isValidVariableName(block.label) && (
              <div style={{ padding: '0 10px 6px 10px', fontSize: 10, color: '#ff4d4f', lineHeight: 1.2 }}>
                Invalid variable name
              </div>
            )}
            {block.label?.trim() && dupLabels.has(block.label.trim()) && (
              <div style={{ padding: '0 10px 6px 10px', fontSize: 10, color: '#ff4d4f', lineHeight: 1.2 }}>
                Duplicate block name
              </div>
            )}

            {reconcilingBlockId === block.id && reconReports[block.id] ? (
              <div style={{ overflow: 'auto', height: reconHeights[block.id] || 'auto' }}>
                <ReconciliationTabs report={reconReports[block.id]} block={block} onReselectRange={onReselectRange} onPreviewSheet={onPreviewSheet} sheetNames={sheetNames} univerRef={univerRef} onColumnFocus={onColumnFocus} onApply={(updatedBlock) => {
                  onBlockChange(updatedBlock.id, updatedBlock)
                  setReconcilingBlockId(null)
                  onReconcilingChange?.(null)
                }} onClose={() => {
                  setReconcilingBlockId(null)
                  onReconcilingChange?.(null)
                }} />
              </div>
            ) : (
              !effectivelyCollapsed && (
              <div ref={(el) => { normalContentRef.current[block.id] = el }} style={{ padding: '8px 12px', opacity: controlsLocked ? 0.5 : 1 }}>
                {!block.range ? (
                  <div style={{ color: '#999', fontSize: 13, padding: '8px 0' }}>
                    Click and drag in the spreadsheet to select a data range.
                  </div>
                ) : (
                  <>
                    <div style={{
                      background: '#f5f5f5', padding: '6px 10px', borderRadius: 4,
                      fontSize: 12, fontFamily: 'monospace', marginBottom: 8,
                    }}>
                      {block.range.endRow - block.range.startRow + 1} rows
                      {' × '}
                      {block.range.endCol - block.range.startCol + 1} cols
                      {block.headerRows.length > 0 && (
                        <span style={{ fontSize: 12, color: '#999' }}>
                          {' → '}{Math.max(0, (block.range?.endRow ?? 0) - (block.range?.startRow ?? 0) + 1 - block.headerRows.length)} data rows
                        </span>
                      )}
                    </div>

                    <div style={{ marginTop: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>Header Rows</span>
                      <Input
                        size="small"
                        defaultValue={block.headerRows.length ? block.headerRows.map(r => r + 1).join(', ') : ''}
                        onBlur={(e) => {
                          const parsed = parseHeaderRowsInput(e.target.value)
                          if (parsed !== null) {
                            onBlockChange(block.id, { headerRows: parsed })
                          } else if (e.target.value.trim() === '') {
                            onBlockChange(block.id, { headerRows: [0] })
                          }
                        }}
                        onPressEnter={(e) => {
                          const parsed = parseHeaderRowsInput(e.currentTarget.value)
                          if (parsed !== null) {
                            onBlockChange(block.id, { headerRows: parsed })
                          } else if (e.currentTarget.value.trim() === '') {
                            onBlockChange(block.id, { headerRows: [0] })
                          }
                        }}
                        placeholder="e.g. 1-3, 5"
                        style={{ flex: 1, fontSize: 13 }}
                      />
                      <span style={{ fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap' }}>
                        → {block.headerRows.length === 0 ? '1 header row' : block.headerRows.length === 1 ? '1 header row' : `${block.headerRows.length} header rows`}
                      </span>
                    </div>

                    <div style={{ marginBottom: 4 }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '28px 1fr 100px 36px',
                        gap: '4px 6px', alignItems: 'center',
                        padding: '2px 6px', fontSize: 11, color: '#999',
                      }}>
                        <span>Col</span>
                        <span>
                          Key
                          <Tooltip title="Regenerate all keys from header rows">
                            <ReloadOutlined
                              style={{
                                cursor: controlsLocked || !block.range ? 'not-allowed' : 'pointer',
                                color: controlsLocked || !block.range ? '#d9d9d9' : '#999',
                                fontSize: 11,
                                marginLeft: 4,
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (controlsLocked || !block.range) return
                                regenerateAllColumnKeys(block.id)
                              }}
                            />
                          </Tooltip>
                        </span>
                        <span>Type</span>
                        <span>Skip</span>
                      </div>

                      {block.columns.length === 0 && (
                        <div style={{ fontSize: 12, color: '#bbb', padding: '4px 6px' }}>
                          No columns in range
                        </div>
                      )}

                      {visibleColumns.map(col => {
                        const mapKey = `${block.id}-${col.colIndex}`
                        const mapExpanded = expandedMaps.has(mapKey)
                        const hasMappings = col.valueMap.length > 0

                        return (
                          <div
                            key={col.colIndex}
                            style={{ marginBottom: 2 }}
                            onMouseEnter={() => { if (isActive) onColumnFocus(col.colIndex) }}
                            onMouseLeave={() => { if (isActive) onColumnFocus(null) }}
                          >
                            <div style={{
                              display: 'grid', gridTemplateColumns: '28px 1fr 100px 36px',
                              gap: '4px 6px', alignItems: 'center',
                              padding: '2px 6px', borderRadius: 4,
                              opacity: col.skip || controlsLocked ? 0.35 : 1,
                              background: activeColIndex === col.colIndex ? 'rgba(250, 140, 22, 0.06)' : 'transparent',
                            }}>
                              <span style={{
                                fontSize: 12, fontFamily: 'monospace',
                                fontWeight: 600, color: '#666',
                                cursor: 'pointer',
                              }}
                              onClick={() => {
                                if (!block.range) return
                                const api = univerRef.current
                                if (!api) return
                                const wb = api.getActiveWorkbook()
                                if (!wb) return
                                if (block.activeSheet) wb.setActiveSheet(block.activeSheet)
                                const sheet = block.activeSheet ? wb.getSheetByName(block.activeSheet) : wb.getActiveSheet()
                                if (sheet) sheet.scrollToCell(Math.max(0, block.range.startRow - 1), Math.max(0, col.colIndex - 3))
                              }}>
                                {col.colLetter}
                              </span>
                              <Input
                                size="small"
                                value={col.key}
                                onChange={e => updateColumn(block.id, col.colIndex, { key: e.target.value })}
                                disabled={controlsLocked || col.skip}
                                status={dupKeys.has(col.key || col.suggestedKey) || (col.key && !isValidVariableName(col.key)) ? 'error' : undefined}
                                onFocus={() => { if (isActive) onColumnFocus(col.colIndex) }}
                                onBlur={() => onColumnFocus(null)}
                                suffix={
                                  <Tooltip title="Regenerate from header rows">
                                    <ReloadOutlined
                                      style={{
                                        cursor: controlsLocked || col.skip || !block.range ? 'not-allowed' : 'pointer',
                                        color: controlsLocked || col.skip || !block.range ? '#d9d9d9' : '#999',
                                        fontSize: 11,
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (controlsLocked || col.skip || !block.range) return
                                        regenerateColumnKey(block.id, col.colIndex)
                                      }}
                                    />
                                  </Tooltip>
                                }
                                style={{ fontSize: 13 }}
                              />
                              <Select
                                size="small"
                                value={col.type}
                                onChange={v => updateColumn(block.id, col.colIndex, { type: v })}
                                options={TYPE_OPTIONS}
                                disabled={controlsLocked || col.skip}
                                style={{ fontSize: 13 }}
                                optionRender={renderOption}
                                onFocus={() => { if (isActive) onColumnFocus(col.colIndex) }}
                                onBlur={() => onColumnFocus(null)}
                              />
                              <Checkbox
                                checked={col.skip}
                                onChange={e => updateColumn(block.id, col.colIndex, { skip: e.target.checked })}
                                disabled={controlsLocked}
                                onFocus={() => { if (isActive) onColumnFocus(col.colIndex) }}
                                onBlur={() => onColumnFocus(null)}
                              />
                            </div>

                            {dupKeys.has(col.key || col.suggestedKey) && (
                              <div style={{ fontSize: 10, color: '#ff4d4f', padding: '0 6px 4px', lineHeight: 1.2 }}>
                                Duplicate key
                              </div>
                            )}
                            {col.key && !isValidVariableName(col.key) && (
                              <div style={{ fontSize: 10, color: '#ff4d4f', padding: '0 6px 4px', lineHeight: 1.2 }}>
                                Invalid variable name
                              </div>
                            )}

                            {col.type === 'valueMapping' && (
                              <div style={{ paddingLeft: 34 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span
                                    onClick={() => toggleValueMap(mapKey)}
                                    style={{
                                      fontSize: 11, color: hasMappings ? '#1677ff' : '#999',
                                      cursor: controlsLocked ? 'default' : 'pointer', userSelect: 'none',
                                      pointerEvents: controlsLocked ? 'none' : 'auto',
                                    }}
                                  >
                                    {mapExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                                    {' '}Value Map{col.valueMap.length > 0 ? ` (${col.valueMap.length})` : ''}
                                  </span>
                                  {mapExpanded && (
                                    <Segmented
                                      size="small"
                                      value={columnTables[mapKey]?.active ? 'table' : 'kv'}
                                      onChange={() => toggleTableView(mapKey, block.id, col.colIndex)}
                                      options={[
                                        { label: 'KV', value: 'kv' },
                                        { label: 'Table', value: 'table' },
                                      ]}
                                      disabled={controlsLocked}
                                      style={{ fontSize: 11 }}
                                    />
                                  )}
                                </div>

                                {mapExpanded && columnTables[mapKey]?.active && (
                                  <>
                                    <div style={{ marginTop: 4, display: 'flex', gap: 4, marginBottom: 4 }}>
                                      <Input
                                        size="small"
                                        placeholder="Search values..."
                                        prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 11 }} />}
                                        value={columnTables[mapKey]?.search || ''}
                                        onChange={e => setColumnSearch(mapKey, e.target.value)}
                                        disabled={controlsLocked}
                                        allowClear
                                        style={{ fontSize: 11, flex: 1 }}
                                      />
                                      <Tooltip title="Add all unmapped as entries">
                                        <Button
                                          size="small"
                                          icon={<PlusOutlined />}
                                          onClick={() => addAllUnmapped(block.id, col.colIndex)}
                                          disabled={controlsLocked || !columnTables[mapKey]?.values?.length}
                                        />
                                      </Tooltip>
                                      <Tooltip title="Clear all mappings">
                                        <Button
                                          size="small"
                                          danger
                                          icon={<ClearOutlined />}
                                          onClick={() => clearAllMappings(block.id, col.colIndex)}
                                          disabled={controlsLocked || !col.valueMap.length}
                                        />
                                      </Tooltip>
                                    </div>

                                    <div style={{
                                      maxHeight: 220, overflow: 'auto',
                                      border: '1px solid #f0f0f0', borderRadius: 4,
                                      marginBottom: 4,
                                    }}>
                                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                        <thead>
                                          <tr style={{ background: '#fafafa', position: 'sticky', top: 0, zIndex: 1 }}>
                                            <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 500, color: '#666', borderBottom: '1px solid #f0f0f0' }}>Value</th>
                                            <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 500, color: '#666', borderBottom: '1px solid #f0f0f0', width: 48 }}>#</th>
                                            <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 500, color: '#666', borderBottom: '1px solid #f0f0f0' }}>Maps to</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(columnTables[mapKey]?.values || [])
                                            .filter(v => !columnTables[mapKey]?.search || v.value.toLowerCase().includes(columnTables[mapKey]!.search.toLowerCase()))
                                            .map((item, idx) => {
                                              const mappedEntry = col.valueMap.find(e => e.from === item.value)
                                              return (
                                                <tr
                                                  key={item.value}
                                                  style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}
                                                >
                                                  <td style={{ padding: '2px 8px', borderBottom: '1px solid #f5f5f5', fontFamily: 'monospace' }}>
                                                    {item.value || <span style={{ color: '#ccc' }}>(empty)</span>}
                                                  </td>
                                                  <td style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #f5f5f5', color: '#999' }}>
                                                    {item.count}
                                                  </td>
                                                  <td style={{ padding: '2px 8px', borderBottom: '1px solid #f5f5f5' }}>
                                                    {mappedEntry ? (
                                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <span style={{ color: '#999', fontSize: 10 }}>→</span>
                                                        <Input
                                                          size="small"
                                                          value={String(mappedEntry.to ?? '')}
                                                          onChange={e => {
                                                            const ei = col.valueMap.indexOf(mappedEntry)
                                                            if (ei >= 0) updateValueMapEntry(block.id, col.colIndex, ei, 'to', e.target.value)
                                                          }}
                                                          style={{ fontSize: 11, flex: 1 }}
                                                          disabled={controlsLocked}
                                                          variant="borderless"
                                                        />
                                                        <Button
                                                          size="small" type="text" danger
                                                          icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                                                          onClick={() => removeMappingForValue(block.id, col.colIndex, item.value)}
                                                          style={{ padding: 0, minWidth: 16, height: 16 }}
                                                          disabled={controlsLocked}
                                                        />
                                                      </div>
                                                    ) : (
                                                      <Button
                                                        size="small" type="link"
                                                        onClick={() => addMappingForValue(block.id, col.colIndex, item.value)}
                                                        disabled={controlsLocked}
                                                        style={{ padding: 0, fontSize: 11, height: 20 }}
                                                      >
                                                        + add mapping
                                                      </Button>
                                                    )}
                                                  </td>
                                                </tr>
                                              )
                                            })}
                                          {(!columnTables[mapKey]?.values || columnTables[mapKey]!.values!.length === 0) && !columnTables[mapKey]?.loading && (
                                            <tr>
                                              <td colSpan={3} style={{ padding: 12, textAlign: 'center', color: '#bbb', fontSize: 11 }}>No data in column</td>
                                            </tr>
                                          )}
                                          {columnTables[mapKey]?.loading && (
                                            <tr>
                                              <td colSpan={3} style={{ padding: 12, textAlign: 'center', color: '#bbb', fontSize: 11 }}>Loading...</td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </>
                                )}

                                {mapExpanded && !columnTables[mapKey]?.active && (
                                  <div style={{ marginTop: 4 }}>
                                    {col.valueMap.map((entry, ei) => (
                                      <div
                                        key={ei}
                                        style={{
                                          display: 'grid', gridTemplateColumns: '1fr 18px 1fr 24px',
                                          gap: '4px 6px', alignItems: 'center',
                                          marginBottom: 2,
                                        }}
                                      >
                                        <Input
                                          size="small"
                                          placeholder="match"
                                          value={entry.from}
                                          onChange={e => updateValueMapEntry(block.id, col.colIndex, ei, 'from', e.target.value)}
                                          style={{ fontSize: 12 }}
                                          disabled={controlsLocked}
                                        />
                                        <span style={{ textAlign: 'center', color: '#999' }}>→</span>
                                        <Input
                                          size="small"
                                          placeholder="output"
                                          value={String(entry.to ?? '')}
                                          onChange={e => updateValueMapEntry(block.id, col.colIndex, ei, 'to', e.target.value)}
                                          style={{ fontSize: 12 }}
                                          disabled={controlsLocked}
                                        />
                                        <Button
                                          size="small" type="text" danger
                                          icon={<DeleteOutlined />}
                                          onClick={() => removeValueMapEntry(block.id, col.colIndex, ei)}
                                          style={{ padding: 0, minWidth: 20 }}
                                          disabled={controlsLocked}
                                        />
                                      </div>
                                    ))}
                                    <Button
                                      size="small" type="dashed" block
                                      icon={<PlusOutlined />}
                                      onClick={() => addValueMapEntry(block.id, col.colIndex)}
                                      style={{ fontSize: 12, marginTop: 2 }}
                                      disabled={controlsLocked}
                                    >
                                      Add mapping
                                    </Button>
                                  </div>
                                )}

                                {mapExpanded && (
                                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>Default:</span>
                                    <Select
                                      size="small"
                                      value={col.valueMapFallbackType || 'auto'}
                                      onChange={v => updateColumn(block.id, col.colIndex, { valueMapFallbackType: v as ValueMapFallbackType })}
                                      options={FALLBACK_TYPE_OPTIONS}
                                      disabled={controlsLocked}
                                      style={{ flex: 1, fontSize: 11 }}
                                      optionRender={renderOption}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Row Filters */}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#999', cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => {
                            const next = new Set(expandedRowFilters)
                            expandedRowFilters.has(block.id) ? next.delete(block.id) : next.add(block.id)
                            setExpandedRowFilters(next)
                          }}>
                          {expandedRowFilters.has(block.id) ? <CaretDownOutlined /> : <CaretRightOutlined />}
                          {' '}Row Filters {block.ignoreRules?.length ? `(${block.ignoreRules.length})` : ''}
                        </span>
                        {expandedRowFilters.has(block.id) && (
                          <Button size="small" type="link" icon={<PlusOutlined />}
                            onClick={() => {
                              const rules = [...(block.ignoreRules || []), { operator: 'eq' as const, column: '', value: '' }]
                              onBlockChange(block.id, { ignoreRules: rules })
                            }}>
                            Add Rule
                          </Button>
                        )}
                      </div>
                      {expandedRowFilters.has(block.id) && (block.ignoreRules || []).map((rule, i) => {
                        const columnKeys = block.columns.filter(c => !c.skip).map(c => c.key || c.suggestedKey)
                        return (
                          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                            <Select size="small" value={rule.column || ''} style={{ width: 100, height: 22, fontSize: 13 }}
                              onChange={v => {
                                const rules = [...(block.ignoreRules || [])]
                                rules[i] = { ...rules[i], column: v || undefined }
                                onBlockChange(block.id, { ignoreRules: rules })
                              }}
                              options={[
                                { value: '$row', label: '$row (index)' },
                                ...columnKeys.map(k => ({ value: k, label: k })),
                              ]}
                            />
                            <Select size="small" value={rule.operator} style={{ width: 90, height: 22, fontSize: 13 }}
                              onChange={v => {
                                const rules = [...(block.ignoreRules || [])]
                                rules[i] = { ...rules[i], operator: v }
                                onBlockChange(block.id, { ignoreRules: rules })
                              }}
                              options={[
                                { value: 'eq', label: 'equals' },
                                { value: 'neq', label: 'not equals' },
                                { value: 'contains', label: 'contains' },
                                { value: 'empty', label: 'empty' },
                                { value: 'regex', label: 'regex' },
                              ]}
                            />
                            {rule.operator !== 'empty' && (
                              <Input size="small" value={rule.value || ''} placeholder="value"
                                onChange={e => {
                                  const rules = [...(block.ignoreRules || [])]
                                  rules[i] = { ...rules[i], value: e.target.value }
                                  onBlockChange(block.id, { ignoreRules: rules })
                                }}
                                style={{ flex: 1, height: 22, fontSize: 13 }}
                              />
                            )}
                            <Button size="small" type="text" danger icon={<DeleteOutlined />}
                              onClick={() => {
                                const rules = (block.ignoreRules || []).filter((_, j) => j !== i)
                                onBlockChange(block.id, { ignoreRules: rules })
                              }}
                            />
                          </div>
                        )
                      })}
                      {expandedRowFilters.has(block.id) && (!block.ignoreRules || block.ignoreRules.length === 0) && (
                        <div style={{ fontSize: 11, color: '#bbb' }}>No row filters</div>
                      )}
                    </div>

                    {/* Computed Properties */}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#999', cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => {
                            const next = new Set(expandedComputedProps)
                            expandedComputedProps.has(block.id) ? next.delete(block.id) : next.add(block.id)
                            setExpandedComputedProps(next)
                          }}>
                          {expandedComputedProps.has(block.id) ? <CaretDownOutlined /> : <CaretRightOutlined />}
                          {' '}Computed Properties {block.computedProperties?.length ? `(${block.computedProperties.length})` : ''}
                        </span>
                        {expandedComputedProps.has(block.id) && (
                          <Button size="small" type="link" icon={<PlusOutlined />}
                            onClick={() => {
                              const props = [...(block.computedProperties || []), { id: `cp-${Date.now()}`, label: '', expression: '' }]
                              onBlockChange(block.id, { computedProperties: props })
                            }}>
                            Add
                          </Button>
                        )}
                      </div>
                      {expandedComputedProps.has(block.id) && (block.computedProperties || []).map((prop, i) => {
                        const validation = prop.expression ? validateExpression(prop.expression,
                          block.columns.filter(c => !c.skip).map(c => c.key || c.suggestedKey)
                        ) : { valid: true, errors: [] }
                        return (
                          <div key={prop.id} style={{ marginBottom: 6 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <Input size="small" value={prop.label} placeholder="name"
                                status={dupKeys.has(prop.label?.trim() || '') ? 'error' : undefined}
                                onChange={e => {
                                  const props = [...(block.computedProperties || [])]
                                  props[i] = { ...props[i], label: e.target.value }
                                  onBlockChange(block.id, { computedProperties: props })
                                }}
                                style={{ width: 100, height: 22, fontSize: 13 }}
                              />
                              <Input size="small" value={prop.expression} placeholder="key1 * key2"
                                onChange={e => {
                                  const props = [...(block.computedProperties || [])]
                                  props[i] = { ...props[i], expression: e.target.value }
                                  onBlockChange(block.id, { computedProperties: props })
                                }}
                                style={{ flex: 1, fontFamily: 'monospace', height: 22, fontSize: 13 }}
                                status={prop.expression && !validation.valid ? 'error' : undefined}
                              />
                              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                                onClick={() => {
                                  const props = (block.computedProperties || []).filter((_, j) => j !== i)
                                  onBlockChange(block.id, { computedProperties: props })
                                }}
                              />
                            </div>
                            {prop.expression && !validation.valid && validation.errors.map((err, ei) => (
                              <div key={ei} style={{ fontSize: 10, color: '#ff4d4f' }}>{err}</div>
                            ))}
                            {prop.expression && validation.valid && (
                              <div style={{ fontSize: 10, color: '#52c41a' }}>✓ Valid</div>
                            )}
                            {dupKeys.has(prop.label?.trim() || '') && (
                              <div style={{ fontSize: 10, color: '#ff4d4f' }}>Duplicate property label</div>
                            )}
                          </div>
                        )
                      })}
                      {expandedComputedProps.has(block.id) && (!block.computedProperties || block.computedProperties.length === 0) && (
                        <div style={{ fontSize: 11, color: '#bbb' }}>No computed properties</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          )}
          </div>
        )
      })}

      {searchText && filteredBlocks.length === 0 && blocks.length > 0 && (
        <div style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '16px 0' }}>
          No blocks matching "{searchText}"
        </div>
      )}

      <RegionPanel
        regions={regions}
        activeRegionId={activeRegionId}
        onActivateRegion={onActivateRegion || (() => {})}
        onRegionChange={onRegionChange}
        onDeleteRegion={(regionId, label) => setDeleteTarget({ id: regionId, label, type: 'region' })}
        onRangeClick={onRegionRangeClick}
      />


      <Modal
        title={deleteTarget?.type === 'region' ? 'Delete region' : 'Delete block'}
        open={!!deleteTarget}
        onOk={() => {
          if (deleteTarget) {
            if (deleteTarget.type === 'region') onDeleteRegion(deleteTarget.id)
            else onDeleteBlock(deleteTarget.id)
          }
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
        okText="Delete"
        okType="danger"
        cancelText="Cancel"
      >
        Delete "{deleteTarget?.label}"? This cannot be undone.
      </Modal>

    </div>
    </div>
  )
}
