import { describe, it, expect } from 'vitest'
import { detectEmptyColumns, removeEmptyColumns } from '../services/columnFilter'

describe('detectEmptyColumns', () => {
  it('detects column with all empty strings', () => {
    const rows = [
      ['a', '', 'b'],
      ['c', '', 'd'],
      ['e', '', 'f'],
    ]
    expect(detectEmptyColumns(rows)).toEqual(new Set([1]))
  })

  it('does not mark column with one non-empty value', () => {
    const rows = [
      ['a', '', 'b'],
      ['', '', 'd'],
      ['', 'x', 'f'],
    ]
    // Column 1 has 'x' in row 2 → not empty
    expect(detectEmptyColumns(rows)).toEqual(new Set())
  })

  it('detects multiple empty columns', () => {
    const rows = [
      ['a', '', 'c', ''],
      ['d', '', 'f', ''],
      ['g', '', 'i', ''],
    ]
    expect(detectEmptyColumns(rows)).toEqual(new Set([1, 3]))
  })

  it('returns empty Set when no empty columns', () => {
    const rows = [
      ['a', 'b'],
      ['c', 'd'],
    ]
    expect(detectEmptyColumns(rows)).toEqual(new Set())
  })

  it('returns empty Set for empty rows array', () => {
    expect(detectEmptyColumns([])).toEqual(new Set())
  })

  it('treats whitespace-only cells as empty', () => {
    const rows = [
      ['a', '   ', 'b'],
      ['c', ' \t ', 'd'],
    ]
    expect(detectEmptyColumns(rows)).toEqual(new Set([1]))
  })

  it('treats null and undefined cells as empty', () => {
    const rows = [
      ['a', null, 'b'],
      ['c', undefined, 'd'],
    ]
    expect(detectEmptyColumns(rows)).toEqual(new Set([1]))
  })

  it('detects single row with single empty column', () => {
    const rows = [['a', '', 'b']]
    expect(detectEmptyColumns(rows)).toEqual(new Set([1]))
  })

  it('detects column with mixed null/empty/whitespace', () => {
    const rows = [
      ['a', null, 'b'],
      ['c', '', 'd'],
      ['e', '   ', 'f'],
    ]
    // Column 1 all empty (null, '', '   ')
    expect(detectEmptyColumns(rows)).toEqual(new Set([1]))
  })
})

describe('removeEmptyColumns', () => {
  it('removes empty column and adjusts keys and data', () => {
    const rows = [
      ['a', '', 'b'],
      ['c', '', 'd'],
    ]
    const keys = ['colA', 'colB', 'colC']
    const result = removeEmptyColumns(rows, keys)

    expect(result.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(result.keys).toEqual(['colA', 'colC'])
    expect(result.skipped).toEqual([1])
  })

  it('does not mutate input arrays', () => {
    const rows = [
      ['a', '', 'b'],
      ['c', '', 'd'],
    ]
    const keys = ['colA', 'colB', 'colC']
    const originalRows = rows.map(r => [...r])
    const originalKeys = [...keys]

    removeEmptyColumns(rows, keys)

    expect(rows).toEqual(originalRows)
    expect(keys).toEqual(originalKeys)
  })
})
