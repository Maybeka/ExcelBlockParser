/**
 * Detect and remove columns where all values are empty.
 *
 * A cell is considered empty if it is:
 * - null or undefined
 * - an empty string ""
 * - a whitespace-only string (e.g. "   ")
 *
 * Pure functions — never mutate inputs.
 */

function isEmptyCell(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

/**
 * Returns a Set of column indices where EVERY cell across ALL rows is empty.
 * Returns an empty Set if no empty columns are found, or if rows is empty.
 */
export function detectEmptyColumns(rows: unknown[][]): Set<number> {
  if (rows.length === 0) return new Set()

  const colCount = Math.max(0, ...rows.map(r => r.length))
  const emptyColumns = new Set<number>()

  for (let col = 0; col < colCount; col++) {
    let allEmpty = true
    for (let row = 0; row < rows.length; row++) {
      const cell = rows[row]?.[col]
      if (!isEmptyCell(cell)) {
        allEmpty = false
        break
      }
    }
    if (allEmpty) {
      emptyColumns.add(col)
    }
  }

  return emptyColumns
}

/**
 * Remove empty columns from a dataset.
 *
 * @param rows - 2D array of cell values (row-major)
 * @param columnKeys - Column key labels (parallel to columns)
 * @returns Filtered rows, keys, and the indices of removed (skipped) columns
 */
export function removeEmptyColumns(
  rows: unknown[][],
  columnKeys: string[],
): { rows: unknown[][]; keys: string[]; skipped: number[] } {
  const emptyCols = detectEmptyColumns(rows)
  const sorted = [...emptyCols].sort((a, b) => a - b)

  const filteredRows = rows.map(row =>
    row.filter((_, colIndex) => !emptyCols.has(colIndex)),
  )
  const filteredKeys = columnKeys.filter(
    (_, colIndex) => !emptyCols.has(colIndex),
  )

  return {
    rows: filteredRows,
    keys: filteredKeys,
    skipped: sorted,
  }
}
