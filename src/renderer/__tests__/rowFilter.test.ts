import { describe, it, expect } from 'vitest'
import { applyRowIgnoreRules } from '../services/rowFilter'
import type { RowIgnoreRule } from '../types'

const COLUMNS = ['name', 'status', 'amount']
const ROWS = [
  ['alice', 'active', '100'],
  ['bob',   'cancelled', '200'],
  ['CAROL', 'active', '300'],
  ['dave',  'pending', ''],
  ['eve',   'active', '500'],
]

function r(column: string | undefined, operator: string, value?: string): RowIgnoreRule {
  return { column, operator, value } as RowIgnoreRule
}

describe('applyRowIgnoreRules', () => {
  it('returns all rows unchanged when rules array is empty', () => {
    const result = applyRowIgnoreRules(ROWS, [], COLUMNS)
    expect(result).toEqual(ROWS)
  })

  it('eq: keeps rows where the column matches the value', () => {
    const result = applyRowIgnoreRules(ROWS, [r('status', 'eq', 'active')], COLUMNS)
    expect(result).toHaveLength(3)
    expect(result.map(r => r[0])).toEqual(['alice', 'CAROL', 'eve'])
  })

  it('neq: skips rows where the column matches the value', () => {
    const result = applyRowIgnoreRules(ROWS, [r('status', 'neq', 'cancelled')], COLUMNS)
    expect(result).toHaveLength(4)
    expect(result.map(r => r[0])).toEqual(['alice', 'CAROL', 'dave', 'eve'])
  })

  it('contains: keeps rows where the column value contains the substring', () => {
    const result = applyRowIgnoreRules(ROWS, [r('name', 'contains', 'li')], COLUMNS)
    expect(result).toHaveLength(1)
    expect(result[0][0]).toBe('alice')
  })

  it('empty: skips rows where the column is non-empty (keeps only empty)', () => {
    const result = applyRowIgnoreRules(ROWS, [r('amount', 'empty')], COLUMNS)
    expect(result).toHaveLength(1)
    expect(result[0][0]).toBe('dave')
  })

  it('empty: rejects rows where the column IS empty when operator is empty and value is non-empty', () => {
    const rules: RowIgnoreRule[] = [{ column: 'amount', operator: 'empty' }]
    const result = applyRowIgnoreRules(ROWS, rules, COLUMNS)
    expect(result).toHaveLength(1)
  })

  it('regex: keeps only rows matching the pattern', () => {
    const result = applyRowIgnoreRules(ROWS, [r('name', 'regex', '^[a-z]+$')], COLUMNS)
    expect(result).toHaveLength(4)
    expect(result.map(r => r[0])).toEqual(['alice', 'bob', 'dave', 'eve'])
  })

  it('$row eq: keeps only the specified row index', () => {
    const result = applyRowIgnoreRules(ROWS, [r('$row', 'eq', '2')], COLUMNS)
    expect(result).toHaveLength(1)
    expect(result[0][0]).toBe('CAROL')
  })

  it('$row neq: skips the specified row index', () => {
    const result = applyRowIgnoreRules(ROWS, [r('$row', 'neq', '3')], COLUMNS)
    expect(result).toHaveLength(4)
    expect(result.map(r => r[0])).toEqual(['alice', 'bob', 'CAROL', 'eve'])
  })

  it('multiple rules: AND logic — both must pass', () => {
    const rules: RowIgnoreRule[] = [
      { column: 'status', operator: 'eq', value: 'active' },
      { column: 'amount', operator: 'neq', value: '300' },
    ]
    const result = applyRowIgnoreRules(ROWS, rules, COLUMNS)
    expect(result).toHaveLength(2)
    expect(result.map(r => r[0])).toEqual(['alice', 'eve'])
  })

  it('uses explicit source offsets when filtered columns are not contiguous', () => {
    const rows = [
      ['skip-a', 'keep', 'skip-b', 'active'],
      ['skip-a', 'keep', 'skip-b', 'inactive'],
    ]
    const result = applyRowIgnoreRules(rows, [r('status', 'eq', 'active')], ['name', 'status'], [1, 3])
    expect(result).toEqual([rows[0]])
  })

  it('no matching rows returns an empty array', () => {
    const result = applyRowIgnoreRules(ROWS, [r('status', 'eq', 'nonexistent')], COLUMNS)
    expect(result).toEqual([])
  })

  it('all rows match returns all rows', () => {
    const result = applyRowIgnoreRules(ROWS, [r('status', 'neq', 'nonexistent')], COLUMNS)
    expect(result).toHaveLength(5)
  })

  it('unknown column name rejects the row', () => {
    const result = applyRowIgnoreRules(ROWS, [r('unknown', 'eq', 'x')], COLUMNS)
    expect(result).toEqual([])
  })

  it('case-insensitive matching for eq', () => {
    const result = applyRowIgnoreRules(ROWS, [r('name', 'eq', 'CAROL')], COLUMNS)
    expect(result).toHaveLength(1)
    expect(result[0][0]).toBe('CAROL')
  })

  it('case-insensitive matching for neq', () => {
    const result = applyRowIgnoreRules(ROWS, [r('name', 'neq', 'ALICE')], COLUMNS)
    expect(result).toHaveLength(4)
  })

  it('case-insensitive matching for contains', () => {
    const result = applyRowIgnoreRules(ROWS, [r('name', 'contains', 'ARO')], COLUMNS)
    expect(result).toHaveLength(1)
    expect(result[0][0]).toBe('CAROL')
  })

  it('whitespace-only cells are treated as empty for the empty operator', () => {
    const rows = [
      ['x', '   ', 'y'],
      ['a', 'b',    'c'],
    ]
    const result = applyRowIgnoreRules(rows, [r('status', 'empty')], COLUMNS)
    expect(result).toHaveLength(1)
    expect(result[0][0]).toBe('x')
  })

  it('empty columnKeys array with a column rule rejects all rows', () => {
    const result = applyRowIgnoreRules(ROWS, [r('status', 'eq', 'active')], [])
    expect(result).toEqual([])
  })

  it('empty columnKeys array with $row rule still works', () => {
    const result = applyRowIgnoreRules(ROWS, [r('$row', 'eq', '0')], [])
    expect(result).toHaveLength(1)
    expect(result[0][0]).toBe('alice')
  })

  it('regex with invalid pattern rejects the row', () => {
    const result = applyRowIgnoreRules(ROWS, [r('name', 'regex', '[invalid')], COLUMNS)
    expect(result).toEqual([])
  })

  it('rule with no column and not $row is skipped (does not reject)', () => {
    const rule: RowIgnoreRule = { operator: 'eq', value: 'x' } as RowIgnoreRule
    const result = applyRowIgnoreRules(ROWS, [rule], COLUMNS)
    expect(result).toHaveLength(5)
  })

  it('does not mutate the input rows array', () => {
    const copy = ROWS.map(r => [...r])
    applyRowIgnoreRules(ROWS, [r('status', 'eq', 'active')], COLUMNS)
    expect(ROWS).toEqual(copy)
  })

  it('does not mutate the input columnKeys array', () => {
    const keys = [...COLUMNS]
    applyRowIgnoreRules(ROWS, [r('status', 'eq', 'active')], keys)
    expect(keys).toEqual(COLUMNS)
  })
})
