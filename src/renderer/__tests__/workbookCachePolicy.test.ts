import { describe, expect, it } from 'vitest'
import { estimateWorkbookCacheBytes, MAX_CACHED_WORKBOOK_BYTES, workbookCacheEvictions } from '../services/workbookCachePolicy'

describe('workbook cache policy', () => {
  it('evicts the least recently used inactive workbooks until the byte budget fits', () => {
    expect(workbookCacheEvictions([
      { id: 'oldest', lastUsed: 1, estimatedBytes: 60 },
      { id: 'recent', lastUsed: 3, estimatedBytes: 40 },
      { id: 'active', lastUsed: 2, estimatedBytes: 70 },
    ], 'active', 120)).toEqual(['oldest'])
  })

  it('never evicts the active workbook even when it alone exceeds the budget', () => {
    expect(workbookCacheEvictions([
      { id: 'active', lastUsed: 1, estimatedBytes: 200 },
      { id: 'recent', lastUsed: 3, estimatedBytes: 30 },
      { id: 'older', lastUsed: 2, estimatedBytes: 40 },
    ], 'active', 100)).toEqual(['older', 'recent'])
  })

  it('keeps any number of small workbooks within the configured total budget', () => {
    expect(workbookCacheEvictions([
      { id: 'active', lastUsed: 3, estimatedBytes: 20 },
      { id: 'first', lastUsed: 1, estimatedBytes: 20 },
      { id: 'second', lastUsed: 2, estimatedBytes: 20 },
    ], 'active', 60)).toEqual([])
    expect(workbookCacheEvictions([{ id: 'active', lastUsed: 1, estimatedBytes: 1 }], 'active', MAX_CACHED_WORKBOOK_BYTES)).toEqual([])
  })

  it('accounts for decoded cells as well as the compressed source bytes', () => {
    const compact = estimateWorkbookCacheBytes(1024, { sheets: {} })
    const populated = estimateWorkbookCacheBytes(1024, {
      sheets: {
        Sheet1: {
          cellData: { 0: { 0: { v: 'long cell value'.repeat(100_000) }, 1: { v: 42 } } },
          mergeData: [{}],
        },
      },
    })
    expect(compact).toBeGreaterThanOrEqual(1024 * 1024)
    expect(populated).toBeGreaterThan(compact)
  })
})
