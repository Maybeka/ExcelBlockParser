import type { RowFilterCondition, RowFilterConfig, RowFilterRule } from '../types'
import type { WorkbookCell } from './workbook'

export const MAX_ROW_FILTER_DEPTH = 10

export const DEFAULT_ROW_FILTER: RowFilterConfig = {
  removeEmptyRows: true,
  emptyCellConditions: { fullyStruck: true },
  matchMode: 'include',
  condition: null,
}

function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

export function isCellConsideredEmpty(cell: WorkbookCell, config: RowFilterConfig): boolean {
  return isBlank(cell.value) || (config.emptyCellConditions.fullyStruck && cell.fullyStruck)
}

function ruleMatches(rawValue: unknown, rule: RowFilterRule, empty: boolean): boolean {
  const raw = rawValue == null ? '' : String(rawValue)
  const expected = rule.value ?? ''
  const lowerRaw = raw.toLowerCase()
  const lowerExpected = expected.toLowerCase()
  const values = (rule.values ?? []).map(value => value.toLowerCase())

  switch (rule.operator) {
    case 'eq': return lowerRaw === lowerExpected
    case 'neq': return lowerRaw !== lowerExpected
    case 'in': return values.includes(lowerRaw)
    case 'notIn': return !values.includes(lowerRaw)
    case 'contains': return lowerRaw.includes(lowerExpected)
    case 'notContains': return !lowerRaw.includes(lowerExpected)
    case 'empty': return empty
    case 'notEmpty': return !empty
    case 'regex':
    case 'notRegex': {
      if (!expected) return false
      try {
        const matches = new RegExp(expected).test(raw)
        return rule.operator === 'regex' ? matches : !matches
      } catch {
        return false
      }
    }
  }
}

function conditionMatches(
  condition: RowFilterCondition,
  row: WorkbookCell[],
  rowIndex: number,
  columnKeys: string[],
  sourceColumnOffsets: number[],
  config: RowFilterConfig,
): boolean {
  if (condition.type !== 'rule') {
    return condition.type === 'all'
      ? condition.conditions.every(child => conditionMatches(child, row, rowIndex, columnKeys, sourceColumnOffsets, config))
      : condition.conditions.some(child => conditionMatches(child, row, rowIndex, columnKeys, sourceColumnOffsets, config))
  }
  if (condition.column === '$row') return ruleMatches(rowIndex, condition, false)
  const columnIndex = columnKeys.indexOf(condition.column)
  if (columnIndex < 0) return false
  const cell = row[sourceColumnOffsets[columnIndex]] ?? { value: null, fullyStruck: false }
  return ruleMatches(cell.value, condition, isCellConsideredEmpty(cell, config))
}

export function applyRowFilter(
  rows: WorkbookCell[][],
  configured: RowFilterConfig | undefined,
  columnKeys: string[],
  sourceColumnOffsets: number[] = columnKeys.map((_, index) => index),
): WorkbookCell[][] {
  const config = configured ?? DEFAULT_ROW_FILTER
  return rows.filter((row, rowIndex) => {
    if (config.removeEmptyRows) {
      const empty = sourceColumnOffsets.every(offset => isCellConsideredEmpty(row[offset] ?? { value: null, fullyStruck: false }, config))
      if (empty) return false
    }
    if (!config.condition) return true
    const matches = conditionMatches(config.condition, row, rowIndex, columnKeys, sourceColumnOffsets, config)
    return (config.matchMode ?? 'include') === 'include' ? matches : !matches
  })
}
