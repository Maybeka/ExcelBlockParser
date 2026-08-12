import { describe, expect, it } from 'vitest'
import { columnKeyFromHeaders } from '../services/columnKey'
import { suggestColumnMappings } from '../services/extraction'
import type { CellRange } from '../types'

const range: CellRange = {
  startRow: 0,
  startCol: 0,
  endRow: 2,
  endCol: 1,
  a1Notation: 'A1:B3',
}

describe('column key generation', () => {
  it('uses the regenerate-button snake-case rules', () => {
    expect(columnKeyFromHeaders(['Customer Name'])).toBe('customer_name')
    expect(columnKeyFromHeaders(['Order Info', 'Total ($)'])).toBe('order_info_total')
    expect(columnKeyFromHeaders(['2026 Total'])).toBe('_2026_total')
  })

  it('uses the same keys when mappings are created from a selection', () => {
    const mappings = suggestColumnMappings([
      ['Order Info', 'Customer Name'],
      ['Total ($)', 'Primary Contact'],
      [12, 'Alice'],
    ], range, [0, 1])

    expect(mappings.map(column => column.key)).toEqual(['order_info_total', 'customer_name_primary_contact'])
    expect(mappings.map(column => column.suggestedKey)).toEqual(['order_info_total', 'customer_name_primary_contact'])
  })

  it('keeps the column-letter fallback when no header value exists', () => {
    expect(suggestColumnMappings([['', null], [1, 2]], range, [0]).map(column => column.key))
      .toEqual(['column_A', 'column_B'])
  })
})
