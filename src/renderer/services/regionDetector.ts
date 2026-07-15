import type { CellRange, SplitRule } from '../types'

export interface BlockRange {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

/**
 * Auto-detect sub-blocks within a region's spreadsheet range using configurable split rules.
 *
 * Walks each row in the range and checks all split rules. A row is a boundary
 * (split point) if it matches ANY split rule. Boundary rows are NOT included in
 * any block. Blocks are formed from the rows between boundaries.
 *
 * - `keyword`: row is a boundary if ANY cell in the column range matches the keyword exactly.
 * - `emptyRow`: row is a boundary if EVERY cell in the column range is empty (empty string after trim).
 * - `emptyColumn`: skipped — column-based splitting is handled separately as a pre-filter.
 */
export function detectBlocks(
  range: CellRange,
  splitRules: SplitRule[],
  getCell: (row: number, col: number) => string,
): BlockRange[] {
  const { startRow, endRow, startCol, endCol } = range

  // Edge case: range with no rows
  if (startRow > endRow) {
    return []
  }

  /**
   * Determine whether a row is a boundary (split point).
   * A row is a boundary if ANY split rule matches.
   */
  function isBoundary(row: number): boolean {
    for (const rule of splitRules) {
      if (rule.type === 'keyword' && rule.keyword !== undefined) {
        // Boundary if ANY cell in the column range matches the keyword exactly
        for (let col = startCol; col <= endCol; col++) {
          if (getCell(row, col) === rule.keyword) {
            return true
          }
        }
      } else if (rule.type === 'emptyRow') {
        // Boundary if EVERY cell in the column range is empty
        let allEmpty = true
        for (let col = startCol; col <= endCol; col++) {
          if (getCell(row, col).trim() !== '') {
            allEmpty = false
            break
          }
        }
        if (allEmpty) {
          return true
        }
      }
      // emptyColumn: skipped — handled separately as a pre-filter
    }
    return false
  }

  // Collect boundary row indices
  const boundaries: number[] = []
  for (let row = startRow; row <= endRow; row++) {
    if (isBoundary(row)) {
      boundaries.push(row)
    }
  }

  // No boundaries → one block covering the entire range
  if (boundaries.length === 0) {
    return [{ startRow, endRow, startCol, endCol }]
  }

  // Build blocks from the rows between boundaries.
  // Boundary rows themselves are excluded from all blocks.
  const blocks: BlockRange[] = []

  // Block before the first boundary
  if (boundaries[0] > startRow) {
    blocks.push({
      startRow,
      endRow: boundaries[0] - 1,
      startCol,
      endCol,
    })
  }

  // Blocks between consecutive boundaries
  for (let i = 0; i < boundaries.length - 1; i++) {
    const blockStart = boundaries[i] + 1
    const blockEnd = boundaries[i + 1] - 1
    if (blockStart <= blockEnd) {
      blocks.push({
        startRow: blockStart,
        endRow: blockEnd,
        startCol,
        endCol,
      })
    }
  }

  // Block after the last boundary
  const lastBoundary = boundaries[boundaries.length - 1]
  if (lastBoundary < endRow) {
    blocks.push({
      startRow: lastBoundary + 1,
      endRow,
      startCol,
      endCol,
    })
  }

  return blocks
}
