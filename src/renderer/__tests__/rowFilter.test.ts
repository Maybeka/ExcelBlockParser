import { describe, expect, it } from 'vitest'
import { applyRowFilter, isCellConsideredEmpty } from '../services/rowFilter'
import type { RowFilterCondition, RowFilterConfig } from '../types'
import type { WorkbookCell } from '../services/workbook'

const COLUMNS = ['name', 'status', 'amount']
const cells = (rows: unknown[][], struck: Array<[number, number]> = []): WorkbookCell[][] => rows.map((row, rowIndex) => row.map((value, colIndex) => ({
  value,
  fullyStruck: struck.some(([r, c]) => r === rowIndex && c === colIndex),
})))
const ROWS = cells([
  ['alice', 'active', '100'],
  ['bob', 'cancelled', '200'],
  ['CAROL', 'active', '300'],
  ['dave', 'pending', ''],
  ['eve', 'active', '500'],
])

function config(condition: RowFilterCondition | null = null, overrides: Partial<RowFilterConfig> = {}): RowFilterConfig {
  return {
    removeEmptyRows: true,
    emptyCellConditions: { fullyStruck: true },
    condition,
    ...overrides,
  }
}

const rule = (column: string, operator: 'eq' | 'neq' | 'contains' | 'notContains' | 'empty' | 'notEmpty' | 'regex' | 'notRegex', value?: string): RowFilterCondition => ({
  type: 'rule', column, operator, ...(value === undefined ? {} : { value }),
})

describe('applyRowFilter', () => {
  it('keeps non-empty rows when no custom condition exists', () => {
    expect(applyRowFilter(ROWS, config(), COLUMNS)).toEqual(ROWS)
  })

  it('removes rows empty across enabled source offsets only', () => {
    const rows = cells([['', '', 'ignored content'], ['value', '', 'ignored content']])
    expect(applyRowFilter(rows, config(), ['name', 'status'], [0, 1])).toEqual([rows[1]])
  })

  it('preserves empty rows when removal is disabled', () => {
    const rows = cells([['', '']])
    expect(applyRowFilter(rows, config(null, { removeEmptyRows: false }), ['a', 'b'])).toEqual(rows)
  })

  it('treats fully struck cells as empty only when enabled', () => {
    const rows = cells([['deleted', '']], [[0, 0]])
    expect(applyRowFilter(rows, config(), ['a', 'b'])).toEqual([])
    expect(applyRowFilter(rows, config(null, { emptyCellConditions: { fullyStruck: false } }), ['a', 'b'])).toEqual(rows)
  })

  it('does not treat a non-struck value as empty', () => {
    expect(isCellConsideredEmpty({ value: 0, fullyStruck: false }, config())).toBe(false)
    expect(isCellConsideredEmpty({ value: false, fullyStruck: false }, config())).toBe(false)
  })

  it('supports equals, not equals, and case-insensitive matching', () => {
    expect(applyRowFilter(ROWS, config(rule('status', 'eq', 'ACTIVE')), COLUMNS).map(row => row[0].value)).toEqual(['alice', 'CAROL', 'eve'])
    expect(applyRowFilter(ROWS, config(rule('name', 'neq', 'ALICE')), COLUMNS)).toHaveLength(4)
  })

  it('supports in and not in value lists', () => {
    const inRule: RowFilterCondition = { type: 'rule', column: 'status', operator: 'in', values: ['ACTIVE', 'pending'] }
    const notInRule: RowFilterCondition = { type: 'rule', column: 'status', operator: 'notIn', values: ['cancelled', 'pending'] }
    expect(applyRowFilter(ROWS, config(inRule), COLUMNS)).toHaveLength(4)
    expect(applyRowFilter(ROWS, config(notInRule), COLUMNS).map(row => row[0].value)).toEqual(['alice', 'CAROL', 'eve'])
  })

  it('supports positive and negative string predicates', () => {
    expect(applyRowFilter(ROWS, config(rule('name', 'contains', 'ARO')), COLUMNS).map(row => row[0].value)).toEqual(['CAROL'])
    expect(applyRowFilter(ROWS, config(rule('name', 'notContains', 'a')), COLUMNS).map(row => row[0].value)).toEqual(['bob', 'eve'])
    expect(applyRowFilter(ROWS, config(rule('amount', 'empty')), COLUMNS).map(row => row[0].value)).toEqual(['dave'])
    expect(applyRowFilter(ROWS, config(rule('amount', 'notEmpty')), COLUMNS)).toHaveLength(4)
  })

  it('supports regex and not regex and rejects invalid patterns', () => {
    expect(applyRowFilter(ROWS, config(rule('name', 'regex', '^[a-z]+$')), COLUMNS)).toHaveLength(4)
    expect(applyRowFilter(ROWS, config(rule('name', 'notRegex', '^[a-z]+$')), COLUMNS).map(row => row[0].value)).toEqual(['CAROL'])
    expect(applyRowFilter(ROWS, config(rule('name', 'regex', '[')), COLUMNS)).toEqual([])
  })

  it('evaluates nested all and any condition groups', () => {
    const condition: RowFilterCondition = {
      type: 'all', conditions: [
        rule('status', 'neq', 'cancelled'),
        { type: 'any', conditions: [rule('amount', 'eq', '300'), rule('name', 'eq', 'eve')] },
      ],
    }
    expect(applyRowFilter(ROWS, config(condition), COLUMNS).map(row => row[0].value)).toEqual(['CAROL', 'eve'])
  })

  it('uses explicit source offsets when enabled columns are not contiguous', () => {
    const rows = cells([['skip', 'alice', 'skip', 'active'], ['skip', 'bob', 'skip', 'inactive']])
    expect(applyRowFilter(rows, config(rule('status', 'eq', 'active')), ['name', 'status'], [1, 3])).toEqual([rows[0]])
  })

  it('supports the data-row index and rejects unavailable columns', () => {
    expect(applyRowFilter(ROWS, config(rule('$row', 'eq', '2')), COLUMNS).map(row => row[0].value)).toEqual(['CAROL'])
    expect(applyRowFilter(ROWS, config(rule('missing', 'eq', 'x')), COLUMNS)).toEqual([])
  })

  it('uses struck-through emptiness in custom empty predicates', () => {
    const rows = cells([['deleted'], ['active']], [[0, 0]])
    expect(applyRowFilter(rows, config(rule('name', 'empty')), ['name'])).toEqual([])
    expect(applyRowFilter(rows, config(rule('name', 'empty'), { removeEmptyRows: false }), ['name'])).toEqual([rows[0]])
  })

  it('does not mutate inputs', () => {
    const copy = structuredClone(ROWS)
    const keys = [...COLUMNS]
    applyRowFilter(ROWS, config(rule('status', 'eq', 'active')), keys)
    expect(ROWS).toEqual(copy)
    expect(keys).toEqual(COLUMNS)
  })
})
