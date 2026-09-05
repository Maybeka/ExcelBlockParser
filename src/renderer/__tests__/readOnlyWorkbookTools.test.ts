import { describe, expect, it } from 'vitest'
import { findMatchesInSheets, findWorkbookMatches, formatCellsAsTsv } from '../services/readOnlyWorkbookTools'

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

  it('returns every match unless a caller supplies a limit', () => {
    const values = Array.from({ length: 300 }, () => ['match'])
    expect(findWorkbookMatches(values, 'match')).toHaveLength(300)
    expect(findWorkbookMatches(values, 'match', { maxResults: 4 })).toHaveLength(4)
  })

  it('collects matches across named sheets', () => {
    expect(findMatchesInSheets([
      { name: 'Sheet1', values: [['Ada'], ['Bob']] },
      { name: 'Products', values: [['Ada'], ['Kit']] },
    ], 'Ada').map(match => `${match.sheetName}!${match.range.a1Notation}`)).toEqual(['Sheet1!A1', 'Products!A1'])
  })

})
