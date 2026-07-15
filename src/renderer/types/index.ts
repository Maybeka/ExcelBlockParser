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
  ignoreRules?: RowIgnoreRule[]
  skipEmptyColumns?: boolean
  tags?: Tag[]
  computedProperties?: ComputedProperty[]
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
  regionResults?: RegionParseResult[]
  diagnostics?: ParseDiagnostic[]
  error?: string
}

export interface ParseDiagnostic {
  code: 'invalid-range' | 'duplicate-key' | 'type-conversion' | 'sheet-missing' | 'unsupported-content'
  severity: 'warning' | 'error'
  message: string
  blockId?: string
  regionId?: string
  row?: number
  column?: string
}

export interface ExportedSession {
  version: 2 | 1
  exportedAt: string
  sourceFileName?: string
  config: SessionConfig
  data: Record<string, unknown>
  blockResults: BlockParseResult[]
  regions?: RegionConfig[]
  regionResults?: RegionParseResult[]
}

export interface SessionConfig {
  blocks: BlockConfig[]
  activeBlockId: string
  focusMode: 'always-editable' | 'activate-first'
  regions?: RegionConfig[]
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

export interface PreviewRow {
  type: 'raw' | 'parsed'
  values: unknown[]
  displayValues: string[]
}

export interface PreviewData {
  /** Block identifier matching BlockConfig.id */
  blockId: string
  /** Human-readable block label */
  label: string
  /** Column header labels to display in table header */
  columns: string[]
  /** Positions in rawRows[i] for each column (colIndex - range.startCol) */
  rawColIndices: number[]
  /** Raw data rows (2D array from dataSnapshot, excluding header rows) */
  rawRows: unknown[][]
  /** Parsed data rows (from parseResult, keyed by column mapping keys) */
  parsedRows: Record<string, unknown>[]
  /** Indices of rows treated as headers (displayed above data rows) */
  headerRows: number[]
}

export interface PreviewWindowConfig {
  width: number
  height: number
}

export type SplitRuleType = 'keyword' | 'emptyRow' | 'emptyColumn'

export interface SplitRule {
  type: SplitRuleType
  keyword?: string
  minGap?: number
}

export type RowIgnoreOperator = 'eq' | 'neq' | 'contains' | 'empty' | 'regex'

export interface RowIgnoreRule {
  column?: string
  operator: RowIgnoreOperator
  value?: string
}

export type TagType = 'label' | 'kv'

export interface Tag {
  type: TagType
  key: string
  value?: string
}

export interface ComputedProperty {
  id: string
  label: string
  expression: string
}

export interface RegionConfig {
  id: string
  label: string
  range: CellRange | null
  activeSheet: string | null
  splitRules: SplitRule[]
  blocks: BlockConfig[]
  collapsed: boolean
  selectionLocked: boolean
  tags?: Tag[]
}

export interface RegionBlockResult {
  blockLabel: string
  rows: string[][]
}

export interface RegionParseResult {
  regionId: string
  label: string
  blocks: RegionBlockResult[]
}
