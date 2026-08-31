import type { BlockConfig, CellRange, ColumnMapping } from '../../types'
import { suggestColumnMappings } from '../../services/extraction'

export type RangeMigrationMode = 'preserve' | 'regenerate'

export interface RangeMigrationImpact {
  preservedColumns: string[]
  regeneratedColumns: string[]
  unmatchedColumns: string[]
  affectedReferences: string[]
}

export interface BlockRangeUpdate {
  workbookId: string
  activeSheet: string
  range: CellRange
  columns: ColumnMapping[]
  headerSnapshot: string[][]
}

export function prepareBlockRangeUpdate(
  block: BlockConfig,
  source: Pick<BlockRangeUpdate, 'workbookId' | 'activeSheet' | 'range'>,
  values: unknown[][],
  mode: RangeMigrationMode,
): { update: BlockRangeUpdate; impact: RangeMigrationImpact } {
  const generated = suggestColumnMappings(values, source.range, block.headerRows)
  const headers = headerMatrix(values, block.headerRows)
  const originalHeaders = normalizeHeaderSnapshot(block.headerSnapshot)
  const previousByHeader = new Map<string, ColumnMapping>()
  block.columns.forEach((column, index) => {
    const header = normalizeHeader(originalHeaders.map(row => row[index]).join(' '))
    if (header && !previousByHeader.has(header)) previousByHeader.set(header, column)
  })

  const matched = new Set<ColumnMapping>()
  const columns = mode === 'regenerate' ? generated : generated.map((next, index) => {
    const header = normalizeHeader(headers.map(row => row[index]).join(' '))
    const previous = (header ? previousByHeader.get(header) : undefined) ?? block.columns[index]
    if (!previous || matched.has(previous)) return next
    matched.add(previous)
    return {
      ...next,
      key: previous.key,
      type: previous.type,
      skip: previous.skip,
      valueMap: previous.valueMap,
      valueMapFallbackType: previous.valueMapFallbackType,
    }
  })
  const unmatchedColumns = mode === 'regenerate' ? block.columns : block.columns.filter(column => !matched.has(column))
  const unmatchedKeys = new Set(unmatchedColumns.map(column => column.key || column.suggestedKey))
  return {
    update: { ...source, columns, headerSnapshot: headers },
    impact: {
      preservedColumns: mode === 'regenerate' ? [] : [...matched].map(column => column.key || column.suggestedKey),
      regeneratedColumns: mode === 'regenerate' ? columns.map(column => column.key || column.suggestedKey) : columns.filter(column => !block.columns.includes(column)).map(column => column.key || column.suggestedKey),
      unmatchedColumns: unmatchedColumns.map(column => column.key || column.suggestedKey),
      affectedReferences: referencedKeys(block).filter(key => unmatchedKeys.has(key)),
    },
  }
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function normalizeHeaderSnapshot(snapshot: BlockConfig['headerSnapshot']): string[][] {
  if (!snapshot?.length) return []
  return Array.isArray(snapshot[0]) ? snapshot as string[][] : [snapshot as string[]]
}

function headerMatrix(values: unknown[][], headerRows: number[]): string[][] {
  return headerRows.map(index => (values[index] ?? []).map(value => String(value ?? '')))
}

function referencedKeys(block: BlockConfig): string[] {
  const result = new Set<string>()
  const visit = (condition: BlockConfig['rowFilter'] extends infer _ ? any : never) => {
    if (!condition) return
    if (condition.type === 'rule') { if (condition.column !== '$row') result.add(condition.column); return }
    condition.conditions.forEach(visit)
  }
  visit(block.rowFilter?.condition)
  for (const property of block.computedProperties || []) {
    for (const key of block.columns.map(column => column.key || column.suggestedKey)) {
      if (new RegExp(`\\b${escapeRegExp(key)}\\b`).test(property.expression)) result.add(key)
    }
  }
  return [...result]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
