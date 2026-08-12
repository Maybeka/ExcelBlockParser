import { describe, expect, it } from 'vitest'
import { parseHeaderRowsInput } from '../components/config-panel/HeaderRowsEditor'

describe('parseHeaderRowsInput', () => {
  it('converts one-based rows and ranges to sorted zero-based indexes', () => {
    expect(parseHeaderRowsInput('3, 1-2, 5')).toEqual([0, 1, 2, 4])
  })

  it('deduplicates overlapping rows', () => {
    expect(parseHeaderRowsInput('1-3, 2, 3')).toEqual([0, 1, 2])
  })

  it.each(['', '0', '3-1', '1-', 'rows'])('rejects incomplete or invalid input: %s', input => {
    expect(parseHeaderRowsInput(input)).toBeNull()
  })
})
