import type { CellRange } from '../types'

export interface WorkbookSearchOptions {
  caseSensitive?: boolean
  wholeCell?: boolean
  maxResults?: number
}

export interface WorkbookSearchMatch {
  row: number
  column: number
  value: string
  range: CellRange
}

export function formatCellsAsTsv(values: readonly (readonly unknown[])[]): string {
  return values.map(row => row.map(value => String(value ?? '').replace(/\r?\n/g, '\n')).join('\t')).join('\n')
}

export function findWorkbookMatches(
  values: readonly (readonly unknown[])[],
  query: string,
  options: WorkbookSearchOptions = {},
): WorkbookSearchMatch[] {
  const normalizedQuery = normalize(query, options.caseSensitive === true)
  if (!normalizedQuery) return []

  const matches: WorkbookSearchMatch[] = []
  const maxResults = options.maxResults ?? Number.POSITIVE_INFINITY
  for (let row = 0; row < values.length && matches.length < maxResults; row += 1) {
    for (let column = 0; column < values[row].length && matches.length < maxResults; column += 1) {
      const value = String(values[row][column] ?? '')
      const candidate = normalize(value, options.caseSensitive === true)
      const matchesQuery = options.wholeCell ? candidate === normalizedQuery : candidate.includes(normalizedQuery)
      if (!matchesQuery) continue
      const a1 = `${columnToA1(column)}${row + 1}`
      matches.push({ row, column, value, range: { startRow: row, startCol: column, endRow: row, endCol: column, a1Notation: a1 } })
    }
  }
  return matches
}

export function findMatchesInSheets(
  sheets: ReadonlyArray<{ name: string; values: readonly (readonly unknown[])[] }>,
  query: string,
  options: WorkbookSearchOptions = {},
): Array<WorkbookSearchMatch & { sheetName: string }> {
  const matches: Array<WorkbookSearchMatch & { sheetName: string }> = []
  for (const sheet of sheets) {
    for (const match of findWorkbookMatches(sheet.values, query, options)) {
      matches.push({ ...match, sheetName: sheet.name })
    }
  }
  return matches
}

function normalize(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase()
}

function columnToA1(column: number): string {
  let result = ''
  let value = column + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}
