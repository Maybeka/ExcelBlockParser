import { useCallback, useRef, useState } from 'react'
import type { BlockConfig, ColumnMapping } from '../../types'
import type { SpreadsheetCapability } from '../../services/spreadsheetCapability'
import { columnKeyFromHeaders } from '../../services/columnKey'

export interface ColumnTableState {
  active: boolean
  loading: boolean
  values: Array<{ value: string; count: number }> | null
  search: string
}

export interface ColumnConfigurationController {
  expandedMaps: Set<string>
  columnTables: Record<string, ColumnTableState>
  toggleValueMap(key: string): void
  toggleTableView(mapKey: string, blockId: string, colIndex: number): void
  setColumnSearch(mapKey: string, search: string): void
  addMappingForValue(blockId: string, colIndex: number, fromValue: string): void
  removeMappingForValue(blockId: string, colIndex: number, fromValue: string): void
  addAllUnmapped(blockId: string, colIndex: number): void
  clearAllMappings(blockId: string, colIndex: number): void
  updateColumn(blockId: string, colIndex: number, partial: Partial<ColumnMapping>): void
  regenerateColumnKey(blockId: string, colIndex: number): void
  regenerateAllColumnKeys(blockId: string): void
  addValueMapEntry(blockId: string, colIndex: number): void
  updateValueMapEntry(blockId: string, colIndex: number, entryIndex: number, field: 'from' | 'to', value: string): void
  removeValueMapEntry(blockId: string, colIndex: number, entryIndex: number): void
}

function parseToValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

export function useColumnConfiguration(
  blocks: BlockConfig[],
  spreadsheet: SpreadsheetCapability,
  onBlockChange: (blockId: string, partial: Partial<BlockConfig>) => void,
): ColumnConfigurationController {
  const [expandedMaps, setExpandedMaps] = useState<Set<string>>(new Set())
  const [columnTables, setColumnTables] = useState<Record<string, ColumnTableState>>({})
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  const updateColumn = useCallback((blockId: string, colIndex: number, partial: Partial<ColumnMapping>) => {
    const block = blocksRef.current.find(item => item.id === blockId)
    if (!block) return
    onBlockChange(blockId, { columns: block.columns.map(column => column.colIndex === colIndex ? { ...column, ...partial } : column) })
  }, [onBlockChange])

  const fetchColumnData = useCallback(async (mapKey: string, blockId: string, colIndex: number) => {
    const block = blocksRef.current.find(item => item.id === blockId)
    if (!block?.range) {
      setColumnTables(current => ({ ...current, [mapKey]: { ...current[mapKey], loading: false } }))
      return
    }
    try {
      const rawValues = spreadsheet.readRange(block.activeSheet, block.range)
      if (!rawValues) {
        setColumnTables(current => ({ ...current, [mapKey]: { ...current[mapKey], loading: false } }))
        return
      }
      const headerRows = new Set(block.headerRows)
      const counts = new Map<string, number>()
      const order: string[] = []
      rawValues.filter((_, index) => !headerRows.has(index)).forEach(row => {
        const value = row[colIndex - block.range!.startCol]
        if (value === null || value === undefined || value === '') return
        const normalized = String(value).trim()
        if (!counts.has(normalized)) order.push(normalized)
        counts.set(normalized, (counts.get(normalized) || 0) + 1)
      })
      setColumnTables(current => ({
        ...current,
        [mapKey]: {
          ...current[mapKey],
          loading: false,
          values: order.map(value => ({ value, count: counts.get(value)! })),
          search: current[mapKey]?.search || '',
        },
      }))
    } catch {
      setColumnTables(current => ({ ...current, [mapKey]: { ...current[mapKey], loading: false } }))
    }
  }, [spreadsheet])

  const toggleValueMap = useCallback((key: string) => {
    setExpandedMaps(current => {
      const next = new Set(current)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  const toggleTableView = useCallback((mapKey: string, blockId: string, colIndex: number) => {
    setColumnTables(current => {
      const table = current[mapKey]
      return {
        ...current,
        [mapKey]: table?.active
          ? { ...table, active: false }
          : { active: true, loading: true, values: table?.values || null, search: table?.search || '' },
      }
    })
    void fetchColumnData(mapKey, blockId, colIndex)
  }, [fetchColumnData])

  const setColumnSearch = useCallback((mapKey: string, search: string) => {
    setColumnTables(current => current[mapKey] ? { ...current, [mapKey]: { ...current[mapKey], search } } : current)
  }, [])

  const updateValueMap = useCallback((blockId: string, colIndex: number, transform: (column: ColumnMapping) => ColumnMapping) => {
    const block = blocksRef.current.find(item => item.id === blockId)
    if (!block) return
    onBlockChange(blockId, { columns: block.columns.map(column => column.colIndex === colIndex ? transform(column) : column) })
  }, [onBlockChange])

  const addMappingForValue = useCallback((blockId: string, colIndex: number, from: string) => {
    updateValueMap(blockId, colIndex, column => column.valueMap.some(entry => entry.from === from)
      ? column
      : { ...column, valueMap: [...column.valueMap, { from, to: '' }] })
  }, [updateValueMap])

  const removeMappingForValue = useCallback((blockId: string, colIndex: number, from: string) => {
    updateValueMap(blockId, colIndex, column => ({ ...column, valueMap: column.valueMap.filter(entry => entry.from !== from) }))
  }, [updateValueMap])

  const addAllUnmapped = useCallback((blockId: string, colIndex: number) => {
    const values = columnTables[`${blockId}-${colIndex}`]?.values
    if (!values) return
    updateValueMap(blockId, colIndex, column => {
      const existing = new Set(column.valueMap.map(entry => entry.from))
      const additions = values.filter(item => !existing.has(item.value)).map(item => ({ from: item.value, to: '' as unknown }))
      return additions.length ? { ...column, valueMap: [...column.valueMap, ...additions] } : column
    })
  }, [columnTables, updateValueMap])

  const clearAllMappings = useCallback((blockId: string, colIndex: number) => {
    updateValueMap(blockId, colIndex, column => ({ ...column, valueMap: [] }))
  }, [updateValueMap])

  const generatedKey = useCallback((block: BlockConfig, column: ColumnMapping, rawValues: unknown[][]): string => {
    const relativeColumn = column.colIndex - block.range!.startCol
    const parts = block.headerRows.flatMap(row => {
      const value = rawValues[row]?.[relativeColumn]
      return value != null && String(value).trim() ? [String(value).trim()] : []
    })
    return parts.length ? columnKeyFromHeaders(parts) : `column_${column.colLetter}`
  }, [])

  const regenerateColumnKey = useCallback((blockId: string, colIndex: number) => {
    const block = blocksRef.current.find(item => item.id === blockId)
    if (!block?.range) return
    const values = spreadsheet.readRange(block.activeSheet, block.range)
    const column = block.columns.find(item => item.colIndex === colIndex)
    if (!values || !column) return
    updateColumn(blockId, colIndex, { key: generatedKey(block, column, values) })
  }, [generatedKey, spreadsheet, updateColumn])

  const regenerateAllColumnKeys = useCallback((blockId: string) => {
    const block = blocksRef.current.find(item => item.id === blockId)
    if (!block?.range) return
    const values = spreadsheet.readRange(block.activeSheet, block.range)
    if (!values) return
    onBlockChange(blockId, { columns: block.columns.map(column => ({ ...column, key: generatedKey(block, column, values) })) })
  }, [generatedKey, onBlockChange, spreadsheet])

  const addValueMapEntry = useCallback((blockId: string, colIndex: number) => {
    updateValueMap(blockId, colIndex, column => ({ ...column, valueMap: [...column.valueMap, { from: '', to: '' }] }))
  }, [updateValueMap])

  const updateValueMapEntry = useCallback((blockId: string, colIndex: number, entryIndex: number, field: 'from' | 'to', value: string) => {
    updateValueMap(blockId, colIndex, column => ({
      ...column,
      valueMap: column.valueMap.map((entry, index) => index === entryIndex
        ? { ...entry, [field]: field === 'to' ? parseToValue(value) : value }
        : entry),
    }))
  }, [updateValueMap])

  const removeValueMapEntry = useCallback((blockId: string, colIndex: number, entryIndex: number) => {
    updateValueMap(blockId, colIndex, column => ({ ...column, valueMap: column.valueMap.filter((_, index) => index !== entryIndex) }))
  }, [updateValueMap])

  return {
    expandedMaps,
    columnTables,
    toggleValueMap,
    toggleTableView,
    setColumnSearch,
    addMappingForValue,
    removeMappingForValue,
    addAllUnmapped,
    clearAllMappings,
    updateColumn,
    regenerateColumnKey,
    regenerateAllColumnKeys,
    addValueMapEntry,
    updateValueMapEntry,
    removeValueMapEntry,
  }
}
