export interface CellRange {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
  a1Notation: string
}

export type ColumnType = 'auto' | 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'valueMapping'

export type ValueMapFallbackType = Exclude<ColumnType, 'valueMapping'>

export interface ValueMapEntry {
  from: string
  to: unknown
}

export interface ColumnMapping {
  colIndex: number
  colLetter: string
  suggestedKey: string
  key: string
  type: ColumnType
  skip: boolean
  valueMap: ValueMapEntry[]
  valueMapFallbackType?: ValueMapFallbackType
}

export interface BlockConfig {
  id: string
  label: string
  range: CellRange | null
  activeSheet: string | null
  headerRows: number[]
  collapsed: boolean
  selectionLocked: boolean
  columns: ColumnMapping[]
  dataSnapshot: unknown[][] | null
}

export interface BlockParseResult {
  blockId: string
  label: string
  data: Record<string, unknown>[]
  rowCount: number
}

export interface ParseResult {
  success: boolean
  data: Record<string, unknown>
  blocks: BlockParseResult[]
  error?: string
}

export interface ExportedSession {
  version: 1
  exportedAt: string
  sourceFileName?: string
  config: SessionConfig
  data: Record<string, unknown>
  blockResults: BlockParseResult[]
}

export interface SessionConfig {
  blocks: BlockConfig[]
  activeBlockId: string
  focusMode: 'always-editable' | 'activate-first'
}

export interface ReconciliationReport {
  blockId: string
  label: string
  status: 'ok' | 'columns-mismatch' | 'rows-mismatch' | 'sheet-missing'
  issues: ReconciliationIssue[]
  suggestedFixes: SuggestedFix[]
}

export interface ReconciliationIssue {
  type: 'column-added' | 'column-removed' | 'column-shifted' | 'row-shifted' | 'sheet-missing' | 'value-map-unused' | 'value-map-new' | 'content-changed'
  severity: 'info' | 'warning' | 'error'
  message: string
  detail: unknown
}

export interface SuggestedFix {
  type: string
  description: string
  autoApply: boolean
  data: unknown
}
