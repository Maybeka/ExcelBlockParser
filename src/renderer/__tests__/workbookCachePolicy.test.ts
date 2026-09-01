import { describe, expect, it } from 'vitest'
import { MAX_CACHED_WORKBOOKS, workbookCacheEvictions } from '../services/workbookCachePolicy'

describe('workbook cache policy', () => {
  it('keeps the active workbook and the most recently used inactive workbook', () => {
    expect(workbookCacheEvictions([
      { id: 'oldest', lastUsed: 1 },
      { id: 'recent', lastUsed: 3 },
      { id: 'active', lastUsed: 2 },
    ], 'active')).toEqual(['oldest'])
  })

  it('never evicts the active workbook when it is the least recently used', () => {
    expect(workbookCacheEvictions([
      { id: 'active', lastUsed: 1 },
      { id: 'recent', lastUsed: 3 },
      { id: 'older', lastUsed: 2 },
    ], 'active')).toEqual(['older'])
  })

  it('does not evict below the configured cache limit', () => {
    expect(workbookCacheEvictions([{ id: 'active', lastUsed: 1 }], 'active', MAX_CACHED_WORKBOOKS)).toEqual([])
  })
})
