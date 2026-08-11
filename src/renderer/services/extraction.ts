import type { BlockConfig, BlockParseResult, CellRange, ColumnMapping, ColumnType, ParseDiagnostic, ParseResult, RegionBlockResult, RegionConfig, RegionParseResult } from '../types'
import { detectBlocks } from './regionDetector'
import { applyRowIgnoreRules } from './rowFilter'
import { detectEmptyColumns } from './columnFilter'
import { fillMergedCells, type WorkbookReader } from './workbook'

export function colIndexToLetter(index: number): string { let letter = ''; let n = index; while (n >= 0) { letter = String.fromCharCode((n % 26) + 65) + letter; n = Math.floor(n / 26) - 1 } return letter }
export function sanitizeToCamelCase(value: string): string { return value.trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').split(/[\s_-]+/).map((word, index) => { const lower = word.toLowerCase(); return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1) }).join('').replace(/^(\d)/, '_$1') || 'column' }
function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/.test(text)) return false
  const date = new Date(text)
  return !Number.isNaN(date.getTime()) && date.getFullYear() > 1900
}

export function inferColumnType(values: unknown[]): ColumnType { const samples = values.filter(value => value != null && value !== '').slice(0, 10); if (!samples.length) return 'string'; if (samples.every(value => typeof value === 'number' || (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))))) return samples.every(value => Number.isInteger(Number(value))) ? 'integer' : 'float'; if (samples.every(value => typeof value === 'boolean' || ['true', 'false', 'yes', 'no', '1', '0'].includes(String(value).trim().toLowerCase()))) return 'boolean'; if (samples.every(isDateLike)) return 'date'; return 'string' }
export function generateColumnMappings(range: CellRange): ColumnMapping[] { return Array.from({ length: range.endCol - range.startCol + 1 }, (_, offset) => { const colIndex = range.startCol + offset; const letter = colIndexToLetter(colIndex); return { colIndex, colLetter: letter, suggestedKey: `column_${letter}`, key: `column_${letter}`, type: 'auto', skip: false, valueMap: [] } }) }
export function suggestColumnMappings(values: unknown[][], range: CellRange, headerRows: number[]): ColumnMapping[] { const headers = new Set(headerRows); return generateColumnMappings(range).map((column, offset) => { const header = headerRows.map(row => values[row]?.[offset]).filter(value => value != null && String(value).trim()).map(String).join(' '); return { ...column, suggestedKey: header ? sanitizeToCamelCase(header) : column.suggestedKey, key: header ? sanitizeToCamelCase(header) : column.key, type: inferColumnType(values.filter((_, index) => !headers.has(index)).map(row => row[offset])) } }) }
export function suggestMappingsForWorkbook(workbook: WorkbookReader, range: CellRange, headerRows: number[], sheetName: string | null): ColumnMapping[] { const sheet = sheetName ? workbook.getSheet(sheetName) : workbook.getActiveSheet(); return sheet ? suggestColumnMappings(sheet.getValues(range), range, headerRows) : generateColumnMappings(range) }

function convertValue(raw: unknown, type: ColumnType): { value: unknown; failed: boolean } { if (raw == null) return { value: null, failed: false }; if (type === 'string') return { value: String(raw), failed: false }; if (type === 'integer') { const value = Number.parseInt(String(raw), 10); return { value: Number.isNaN(value) ? null : value, failed: Number.isNaN(value) } }; if (type === 'float') { const value = Number(raw); return { value: Number.isNaN(value) ? null : value, failed: Number.isNaN(value) } }; if (type === 'boolean') { if (typeof raw === 'boolean') return { value: raw, failed: false }; const value = String(raw).trim().toLowerCase(); if (['true', '1', 'yes'].includes(value)) return { value: true, failed: false }; if (['false', '0', 'no', ''].includes(value)) return { value: false, failed: false }; return { value: null, failed: true } }; if (type === 'date') { const date = raw instanceof Date ? raw : new Date(raw as string | number); return { value: Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10), failed: Number.isNaN(date.getTime()) } }; return { value: raw, failed: false } }
function validRange(range: CellRange): boolean { return Number.isInteger(range.startRow) && Number.isInteger(range.startCol) && range.startRow >= 0 && range.startCol >= 0 && range.endRow >= range.startRow && range.endCol >= range.startCol }
function failed(diagnostics: ParseDiagnostic[]): ParseResult { return { success: false, data: {}, blocks: [], diagnostics, error: diagnostics[0]?.message } }

export interface ExtractionExecution { result: ParseResult; snapshots: Map<string, unknown[][]> }
export interface RegionExecution { regionResults: RegionParseResult[]; diagnostics: ParseDiagnostic[] }

export function parseWorkbookRegions(workbook: WorkbookReader, regions: RegionConfig[]): RegionExecution {
  const diagnostics: ParseDiagnostic[] = []
  const regionResults: RegionParseResult[] = []
  for (const region of regions.filter(item => item.range)) {
    const sheet = region.activeSheet ? workbook.getSheet(region.activeSheet) : workbook.getActiveSheet()
    if (!sheet) {
      diagnostics.push({ code: 'sheet-missing', severity: 'error', regionId: region.id, message: `Region "${region.label}" references an unavailable sheet.` })
      continue
    }
    const values = sheet.getValues(region.range!)
    const strings = values.map(row => row.map(value => value == null ? '' : String(value)))
    const ranges = detectBlocks(region.range!, region.splitRules, (row, col) => strings[row - region.range!.startRow]?.[col - region.range!.startCol] ?? '')
    const resultBlocks: RegionBlockResult[] = ranges.map((range, index) => ({
      blockLabel: `block_${index + 1}`,
      range: {
        ...range,
        a1Notation: `${colIndexToLetter(range.startCol)}${range.startRow + 1}:${colIndexToLetter(range.endCol)}${range.endRow + 1}`,
      },
      rows: strings
        .slice(range.startRow - region.range!.startRow, range.endRow - region.range!.startRow + 1)
        .map(row => row.slice(range.startCol - region.range!.startCol, range.endCol - region.range!.startCol + 1)),
    }))
    regionResults.push({ regionId: region.id, label: region.label, blocks: resultBlocks })
  }
  return { regionResults, diagnostics }
}

export function parseWorkbook(workbook: WorkbookReader, blocks: BlockConfig[], regions: RegionConfig[]): ExtractionExecution {
  const diagnostics: ParseDiagnostic[] = []; const activeBlocks = blocks.filter(block => block.range)
  if (!activeBlocks.length) return { result: failed([{ code: 'invalid-range', severity: 'error', message: 'No blocks with a selected range' }]), snapshots: new Map() }
  for (const block of activeBlocks) { if (!validRange(block.range!)) diagnostics.push({ code: 'invalid-range', severity: 'error', blockId: block.id, message: `Block "${block.label}" has an invalid range.` }); const keys = block.columns.filter(column => !column.skip).map(column => column.key || column.suggestedKey); if (new Set(keys).size !== keys.length) diagnostics.push({ code: 'duplicate-key', severity: 'error', blockId: block.id, message: `Block "${block.label}" has duplicate output keys.` }) }
  if (diagnostics.length) return { result: failed(diagnostics), snapshots: new Map() }
  const snapshots = new Map<string, unknown[][]>(); const blockResults: BlockParseResult[] = []; const data: Record<string, unknown> = {}
  for (const block of activeBlocks) {
    const sheet = block.activeSheet ? workbook.getSheet(block.activeSheet) : workbook.getActiveSheet()
    if (!sheet) { diagnostics.push({ code: 'sheet-missing', severity: 'error', blockId: block.id, message: `Block "${block.label}" references unavailable sheet "${block.activeSheet ?? '(active)'}".` }); continue }
    const values = fillMergedCells(sheet.getValues(block.range!), block.range!, sheet.getMergedRanges()); snapshots.set(block.id, values)
    const headerRows = new Set(block.headerRows); let rows = values.filter((_, index) => !headerRows.has(index)); let columns = block.columns.filter(column => !column.skip)
    if (block.skipEmptyColumns) { const empty = detectEmptyColumns(rows); columns = columns.filter(column => !empty.has(column.colIndex - block.range!.startCol)) }
    if (!columns.length) { blockResults.push({ blockId: block.id, label: block.label, data: [], rowCount: 0 }); data[block.label] = []; continue }
    const keys = columns.map(column => column.key || column.suggestedKey)
    const sourceColumnOffsets = columns.map(column => column.colIndex - block.range!.startCol)
    const filteredRows = applyRowIgnoreRules(rows.map(row => row.map(value => value == null ? '' : String(value))), block.ignoreRules ?? [], keys, sourceColumnOffsets)
    rows = filteredRows
    const parsed = rows.map((row, rowIndex) => { const entry: Record<string, unknown> = {}; columns.forEach((column, index) => { const raw = row[column.colIndex - block.range!.startCol] ?? null; const map = column.valueMap.find(item => item.from === String(raw).trim()); const converted = map ? { value: map.to, failed: false } : convertValue(raw, column.type === 'valueMapping' ? (column.valueMapFallbackType ?? 'auto') : column.type); if (converted.failed) diagnostics.push({ code: 'type-conversion', severity: 'warning', blockId: block.id, row: rowIndex, column: keys[index], message: `Block "${block.label}", row ${rowIndex + 1}, column "${keys[index]}" could not be converted to ${column.type}.` }); entry[keys[index]] = converted.value }); return entry })
    blockResults.push({ blockId: block.id, label: block.label, data: parsed, rowCount: parsed.length }); data[block.label] = parsed
  }
  const regionExecution = parseWorkbookRegions(workbook, regions)
  diagnostics.push(...regionExecution.diagnostics)
  const regionResults = regionExecution.regionResults
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error'); return { result: { success: errors.length === 0, data, blocks: blockResults, regionResults, diagnostics, error: errors[0]?.message }, snapshots }
}

export function parseProjectRegions(
  workbooks: ReadonlyMap<string, WorkbookReader>,
  regions: RegionConfig[],
): RegionExecution {
  const diagnostics: ParseDiagnostic[] = []
  const regionResults: RegionParseResult[] = []
  const referencedWorkbookIds = new Set(regions.filter(region => region.range).map(region => region.workbookId ?? ''))
  for (const workbookId of referencedWorkbookIds) {
    if (!workbookId) {
      diagnostics.push({ code: 'invalid-range', severity: 'error', workbookId: null, message: 'A project item has no workbook mapping.' })
      continue
    }
    const workbook = workbooks.get(workbookId)
    if (!workbook) {
      diagnostics.push({ code: 'sheet-missing', severity: 'error', workbookId, message: `Workbook "${workbookId}" is not attached to this project.` })
      continue
    }
    const execution = parseWorkbookRegions(workbook, regions.filter(region => region.workbookId === workbookId))
    execution.regionResults.forEach(result => regionResults.push({ ...result, workbookId }))
    execution.diagnostics.forEach(diagnostic => diagnostics.push({ ...diagnostic, workbookId }))
  }
  return { regionResults, diagnostics }
}

/** Parses every workbook referenced by a project without allowing a block to
 * read another workbook's sheets. Project output is grouped by workbook ID to
 * keep duplicate block labels from overwriting each other. */
export function parseProjectWorkbooks(
  workbooks: Map<string, WorkbookReader>,
  blocks: BlockConfig[],
  regions: RegionConfig[],
): ExtractionExecution {
  const snapshots = new Map<string, unknown[][]>()
  const diagnostics: ParseDiagnostic[] = []
  const blockResults: BlockParseResult[] = []
  const regionResults: RegionParseResult[] = []
  const data: Record<string, unknown> = {}
  const referencedWorkbookIds = new Set([
    ...blocks.filter(block => block.range).map(block => block.workbookId ?? ''),
    ...regions.filter(region => region.range).map(region => region.workbookId ?? ''),
  ])

  for (const workbookId of referencedWorkbookIds) {
    if (!workbookId) {
      diagnostics.push({ code: 'invalid-range', severity: 'error', workbookId: null, message: 'A project item has no workbook mapping.' })
      continue
    }
    const workbook = workbooks.get(workbookId)
    if (!workbook) {
      diagnostics.push({ code: 'sheet-missing', severity: 'error', workbookId, message: `Workbook "${workbookId}" is not attached to this project.` })
      continue
    }
    const scopedBlocks = blocks.filter(block => block.workbookId === workbookId)
    const scopedRegions = regions.filter(region => region.workbookId === workbookId)
    const execution = parseWorkbook(workbook, scopedBlocks, scopedRegions)
    execution.snapshots.forEach((value, key) => snapshots.set(key, value))
    execution.result.blocks.forEach(result => blockResults.push({ ...result, workbookId }))
    execution.result.regionResults?.forEach(result => regionResults.push({ ...result, workbookId }))
    execution.result.diagnostics?.forEach(diagnostic => diagnostics.push({ ...diagnostic, workbookId }))
    data[workbookId] = execution.result.data
  }

  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  return {
    snapshots,
    result: {
      success: errors.length === 0,
      data,
      blocks: blockResults,
      regionResults,
      diagnostics,
      error: errors[0]?.message,
    },
  }
}
