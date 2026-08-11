import { describe, expect, it } from 'vitest'
import { visibleCanvasRanges } from '../services/canvasRangeVisibility'

const ranges = [
  { itemId: 'sheet-a-block', activeSheet: 'Sheet A' },
  { itemId: 'sheet-b-block', activeSheet: 'Sheet B' },
  { itemId: 'active-sheet-block', activeSheet: null },
]

describe('visibleCanvasRanges', () => {
  it('shows active items from the active sheet only', () => {
    expect(visibleCanvasRanges(ranges, ranges.map(range => range.itemId), 'Sheet B').map(range => range.itemId))
      .toEqual(['sheet-b-block', 'active-sheet-block'])
  })

  it('does not retain the previous sheet range after switching', () => {
    const activeItems = ['sheet-a-block', 'sheet-b-block']
    expect(visibleCanvasRanges(ranges, activeItems, 'Sheet A').map(range => range.itemId)).toEqual(['sheet-a-block'])
    expect(visibleCanvasRanges(ranges, activeItems, 'Sheet B').map(range => range.itemId)).toEqual(['sheet-b-block'])
  })

  it('continues to enforce active item selection', () => {
    expect(visibleCanvasRanges(ranges, ['sheet-b-block'], 'Sheet B').map(range => range.itemId)).toEqual(['sheet-b-block'])
  })
})
