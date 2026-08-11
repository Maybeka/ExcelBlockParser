import type { RowIgnoreRule } from '../types'

function isEmpty(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}

function evaluateRule(
  cellValue: string | null | undefined,
  rule: RowIgnoreRule,
): boolean {
  const operator = rule.operator
  const raw = cellValue ?? ''
  const expected = rule.value ?? ''
  const lowerRaw = raw.toLowerCase()
  const lowerExpected = expected.toLowerCase()

  switch (operator) {
    case 'eq':
      return lowerRaw === lowerExpected

    case 'neq':
      return lowerRaw !== lowerExpected

    case 'contains':
      return lowerRaw.includes(lowerExpected)

    case 'empty':
      return isEmpty(cellValue)

    case 'regex':
      if (!expected) return false
      try {
        return new RegExp(expected).test(raw)
      } catch {
        return false
      }

    default:
      return true
  }
}

/**
 * Filter rows by ignore rules. ALL rules must pass (AND logic) for a row to be kept.
 *
 * When `rule.column === '$row'` the 0-based row index is compared instead of a cell value.
 * If `columnKeys` does not contain a rule's column name the row is rejected.
 *
 * Pure function — never mutates `rows`.
 */
export function applyRowIgnoreRules(
  rows: string[][],
  rules: RowIgnoreRule[],
  columnKeys: string[],
  sourceColumnOffsets: number[] = columnKeys.map((_, index) => index),
): string[][] {
  if (!rules || rules.length === 0) {
    return rows
  }

  return rows.filter((row, rowIndex) => {
    for (const rule of rules) {
      let cellValue: string | null | undefined

      if (rule.column === '$row') {
        cellValue = String(rowIndex)
      } else if (rule.column) {
        const colIndex = columnKeys.indexOf(rule.column)
        if (colIndex === -1) {
          return false
        }
        cellValue = row[sourceColumnOffsets[colIndex]]
      } else {
        continue
      }

      if (!evaluateRule(cellValue, rule)) {
        return false
      }
    }

    return true
  })
}
