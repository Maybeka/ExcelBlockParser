import { describe, it, expect } from 'vitest'
import { detectBlocks, type BlockRange } from '../services/regionDetector'
import type { CellRange, SplitRule } from '../types'

// ── Test helpers ────────────────────────────────────────────────────────────

interface GridSpec {
  rows: string[][]
  cols: number
}

function makeGetCell(
  grid: GridSpec,
): (row: number, col: number) => string {
  return (row, col) => {
    if (row < 0 || row >= grid.rows.length) return ''
    const rowData = grid.rows[row]
    if (col < 0 || col >= rowData.length) return ''
    return rowData[col]
  }
}

function makeRange(grid: GridSpec): CellRange {
  return {
    startRow: 0,
    startCol: 0,
    endRow: grid.rows.length - 1,
    endCol: grid.cols - 1,
    a1Notation: `A1:${String.fromCharCode(65 + grid.cols - 1)}${grid.rows.length}`,
  }
}

/** 10 rows × 3 cols of non-empty filler data, useful for most tests. */
function fillerGrid(overrides?: Record<number, string[]>): GridSpec {
  const rows: string[][] = []
  for (let r = 0; r < 10; r++) {
    rows.push(
      overrides?.[r] ?? ['data', 'data', 'data'],
    )
  }
  return { rows, cols: 3 }
}

function makeBlock(
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): BlockRange {
  return { startRow, endRow, startCol, endCol }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('detectBlocks', () => {
  // 1. Keyword split
  it('splits on keyword rows, excluding the keyword rows themselves', () => {
    const grid = fillerGrid({
      3: ['---', 'data', 'data'],
      7: ['data', '---', 'data'],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'keyword', keyword: '---' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 2, 0, 2),
      makeBlock(4, 6, 0, 2),
      makeBlock(8, 9, 0, 2),
    ])
  })

  // 2. Empty row split
  it('splits on fully-empty rows', () => {
    const grid = fillerGrid({
      5: ['', '', ''],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'emptyRow' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 4, 0, 2),
      makeBlock(6, 9, 0, 2),
    ])
  })

  // 3. No boundaries
  it('returns one block covering the entire range when no rules match', () => {
    const grid = fillerGrid()
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'keyword', keyword: '---' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(0, 9, 0, 2)])
  })

  // 4. All rows are boundaries
  it('returns empty array when every row is a boundary', () => {
    const rows: string[][] = Array.from({ length: 5 }, () => ['', '', ''])
    const grid: GridSpec = { rows, cols: 3 }
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'emptyRow' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([])
  })

  // 5. Single row range
  it('returns one block for a single non-boundary row', () => {
    const grid: GridSpec = { rows: [['x']], cols: 1 }
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'emptyRow' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(0, 0, 0, 0)])
  })

  // 6. Empty range (0 rows)
  it('returns empty array for a range with zero rows', () => {
    const range: CellRange = {
      startRow: 5,
      startCol: 0,
      endRow: 4,
      endCol: 2,
      a1Notation: 'A5:C4',
    }
    const rules: SplitRule[] = [{ type: 'emptyRow' }]
    const getCell = () => 'data'

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([])
  })

  // 7. Consecutive boundaries
  it('skips zero-height blocks between consecutive boundary rows', () => {
    const rows: string[][] = [
      ['a'], // row 0
      ['b'], // row 1
      [''],  // row 2  ← boundary
      [''],  // row 3  ← boundary
      [''],  // row 4  ← boundary
      ['c'], // row 5
      ['d'], // row 6
    ]
    const grid: GridSpec = { rows, cols: 1 }
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'emptyRow' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 1, 0, 0),
      makeBlock(5, 6, 0, 0),
    ])
  })

  // 8. Mixed rules
  it('treats a row as boundary when ANY rule matches (OR logic)', () => {
    const grid = fillerGrid({
      2: ['---', 'data', 'data'], // keyword match
      5: ['', '', ''],            // empty match
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [
      { type: 'keyword', keyword: '---' },
      { type: 'emptyRow' },
    ]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 1, 0, 2),
      makeBlock(3, 4, 0, 2),
      makeBlock(6, 9, 0, 2),
    ])
  })

  // 9. Boundary at first row
  it('handles a boundary at the very first row of the range', () => {
    const grid = fillerGrid({
      0: ['---', 'data', 'data'],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'keyword', keyword: '---' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(1, 9, 0, 2)])
  })

  // 10. Boundary at last row
  it('handles a boundary at the very last row of the range', () => {
    const grid = fillerGrid({
      9: ['---', 'data', 'data'],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'keyword', keyword: '---' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(0, 8, 0, 2)])
  })

  // 11. No split rules at all
  it('returns one block spanning entire range when splitRules is empty', () => {
    const grid = fillerGrid()
    const range = makeRange(grid)
    const rules: SplitRule[] = []
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(0, 9, 0, 2)])
  })

  // 12. Empty-column rules create vertical blocks.
  it('splits into rectangular blocks at qualified empty columns', () => {
    const rows = Array.from({ length: 4 }, () => ['left', '', '', 'right'])
    const grid = { rows, cols: 4 }
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'emptyColumn', minGap: 2 }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 3, 0, 0),
      makeBlock(0, 3, 3, 3),
    ])
  })

  it('does not split when an empty-row run is shorter than minGap', () => {
    const grid = fillerGrid({ 4: ['', '', ''] })
    const blocks = detectBlocks(makeRange(grid), [{ type: 'emptyRow', minGap: 2 }], makeGetCell(grid))
    expect(blocks).toEqual([makeBlock(0, 9, 0, 2)])
  })

  // 13. Multiple keyword rules
  it('splits on any of multiple keyword rules', () => {
    const grid = fillerGrid({
      2: ['===', 'data', 'data'],
      6: ['***', 'data', 'data'],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [
      { type: 'keyword', keyword: '===' },
      { type: 'keyword', keyword: '***' },
    ]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 1, 0, 2),
      makeBlock(3, 5, 0, 2),
      makeBlock(7, 9, 0, 2),
    ])
  })

  // 14. Non-zero column range
  it('respects a non-zero startCol / endCol range', () => {
    // Grid with columns 0..4; range only covers columns 1..3
    const rows: string[][] = Array.from({ length: 5 }, (_, r) =>
      r === 2
        ? ['x', '---', '---', '---', 'x']
        : ['x', 'data', 'data', 'data', 'x'],
    )
    const range: CellRange = {
      startRow: 0,
      startCol: 1,
      endRow: 4,
      endCol: 3,
      a1Notation: 'B1:D5',
    }
    const rules: SplitRule[] = [{ type: 'keyword', keyword: '---' }]
    // getCell still receives absolute col indices
    const getCell = (row: number, col: number) => rows[row]?.[col] ?? ''

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 1, 1, 3),
      makeBlock(3, 4, 1, 3),
    ])
  })

  // 15. Whitespace-only cells are treated as empty
  it('treats whitespace-only cells as empty for emptyRow rule', () => {
    const grid = fillerGrid({
      4: ['   ', '\t', '  '],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'emptyRow' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([
      makeBlock(0, 3, 0, 2),
      makeBlock(5, 9, 0, 2),
    ])
  })

  // 16. Boundary at both first and last row
  it('handles boundaries at both edges of the range', () => {
    const grid = fillerGrid({
      0: ['---', 'data', 'data'],
      9: ['---', 'data', 'data'],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'keyword', keyword: '---' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(1, 8, 0, 2)])
  })

  // 17. Keyword rule without keyword property (edge case)
  it('ignores keyword rule when keyword is undefined', () => {
    const grid = fillerGrid({
      3: ['---', 'data', 'data'],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'keyword' }] // no keyword set
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(0, 9, 0, 2)])
  })

  // 18. Partial empty row (some cells non-empty)
  it('does NOT treat a partially-empty row as a boundary', () => {
    const grid = fillerGrid({
      5: ['data', '', ''],
    })
    const range = makeRange(grid)
    const rules: SplitRule[] = [{ type: 'emptyRow' }]
    const getCell = makeGetCell(grid)

    const blocks = detectBlocks(range, rules, getCell)

    expect(blocks).toEqual([makeBlock(0, 9, 0, 2)])
  })
})
