import type { BlockConfig, ParseResult, PreviewData } from '../types'

/**
 * Transform a BlockConfig + ParseResult into PreviewData for the table component.
 *
 * @param block - The block configuration containing column mappings and data snapshot
 * @param parseResult - The parse result containing parsed block data
 * @returns PreviewData structured for the table component
 */
export function adaptPreviewData(
  block: BlockConfig,
  parseResult: ParseResult,
): PreviewData {
  const activeColumns = block.columns.filter(col => !col.skip)
  const columns = activeColumns.map(col => col.key || col.suggestedKey)
  const startCol = block.range?.startCol ?? 0
  const rawColIndices = activeColumns.map(col => col.colIndex - startCol)

  const headerRowSet = new Set(block.headerRows)
  const rawRows = block.dataSnapshot
    ? block.dataSnapshot.filter((_, index) => !headerRowSet.has(index))
    : []

  const parsedBlock = parseResult.blocks.find(b => b.blockId === block.id)
  const parsedRows = parsedBlock ? parsedBlock.data : []

  return {
    blockId: block.id,
    label: block.label,
    columns,
    rawColIndices,
    rawRows,
    parsedRows,
    headerRows: block.headerRows,
  }
}
