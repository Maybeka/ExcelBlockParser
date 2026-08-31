import { describe, expect, it } from 'vitest'
import { findWorkbookMatches, formatCellsAsTsv } from '../services/readOnlyWorkbookTools'

describe('read-only workbook tools', () => {
  it('copies visible cells as tab-separated text', () => {
    expect(formatCellsAsTsv([['Name', 'Amount'], ['Ada', 12], [null, 'two\nlines']]))
      .toBe('Name\tAmount\nAda\t12\n\ttwo\nlines')
  })

  it('finds cells with case and full-value options', () => {
    const values = [['Alpha', 'alphabet'], ['ALPHA', 'Beta']]
    expect(findWorkbookMatches(values, 'alpha').map(match => match.range.a1Notation)).toEqual(['A1', 'B1', 'A2'])
    expect(findWorkbookMatches(values, 'Alpha', { caseSensitive: true, wholeCell: true }).map(match => match.range.a1Notation)).toEqual(['A1'])
  })
})
