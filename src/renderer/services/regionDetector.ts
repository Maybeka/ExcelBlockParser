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
 * Finds horizontal and vertical boundaries, then returns the rectangular
 * blocks between them. Boundary rows and columns are excluded.
 *
 * - `keyword`: row is a boundary if ANY cell in the column range matches the keyword exactly.
 * - `emptyRow`: row is a boundary if EVERY cell in the column range is empty (empty string after trim).
 * - `emptyColumn`: column is a boundary if every cell in the row range is empty.
 * - `minGap`: minimum consecutive empty rows or columns required for a boundary.
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

  function isRowBoundary(row: number): boolean {
    for (const rule of splitRules) {
      if (rule.type === 'keyword' && rule.keyword !== undefined) {
        // Boundary if ANY cell in the column range matches the keyword exactly
        for (let col = startCol; col <= endCol; col++) {
          if (getCell(row, col) === rule.keyword) {
            return true
          }
        }
      }
    }
    return false
  }

  function isEmptyColumn(col: number): boolean {
    for (let row = startRow; row <= endRow; row++) {
      if (getCell(row, col).trim() !== '') return false
    }
    return true
  }

  function qualifiedEmptyBoundaries(
    start: number,
    end: number,
    emptyAt: (index: number) => boolean,
    minGap: number,
  ): Set<number> {
    const boundaries = new Set<number>()
    let runStart = -1
    for (let index = start; index <= end + 1; index++) {
      if (index <= end && emptyAt(index)) {
        if (runStart < 0) runStart = index
        continue
      }
      if (runStart >= 0 && index - runStart >= minGap) {
        for (let boundary = runStart; boundary < index; boundary++) boundaries.add(boundary)
      }
      runStart = -1
    }
    return boundaries
  }

  const rowBoundaries = new Set<number>()
  for (let row = startRow; row <= endRow; row++) {
    if (isRowBoundary(row)) rowBoundaries.add(row)
  }
  for (const rule of splitRules.filter(rule => rule.type === 'emptyRow')) {
    const minimum = Math.max(1, Math.floor(rule.minGap ?? 1))
    qualifiedEmptyBoundaries(startRow, endRow, row => {
      for (let col = startCol; col <= endCol; col++) if (getCell(row, col).trim() !== '') return false
      return true
    }, minimum).forEach(row => rowBoundaries.add(row))
  }

  const columnBoundaries = new Set<number>()
  for (const rule of splitRules.filter(rule => rule.type === 'emptyColumn')) {
    const minimum = Math.max(1, Math.floor(rule.minGap ?? 1))
    qualifiedEmptyBoundaries(startCol, endCol, isEmptyColumn, minimum).forEach(col => columnBoundaries.add(col))
  }

  function segments(start: number, end: number, boundaries: Set<number>): Array<[number, number]> {
    const result: Array<[number, number]> = []
    let segmentStart = start
    for (let index = start; index <= end; index++) {
      if (!boundaries.has(index)) continue
      if (segmentStart < index) result.push([segmentStart, index - 1])
      segmentStart = index + 1
    }
    if (segmentStart <= end) result.push([segmentStart, end])
    return result
  }

  const rowSegments = segments(startRow, endRow, rowBoundaries)
  const columnSegments = segments(startCol, endCol, columnBoundaries)
  return rowSegments.flatMap(([blockStartRow, blockEndRow]) => columnSegments.map(([blockStartCol, blockEndCol]) => ({
    startRow: blockStartRow,
    endRow: blockEndRow,
    startCol: blockStartCol,
    endCol: blockEndCol,
  })))
}
