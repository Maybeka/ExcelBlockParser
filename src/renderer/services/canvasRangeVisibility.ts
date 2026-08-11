export interface SheetCanvasRange {
  itemId: string
  activeSheet?: string | null
}

export function visibleCanvasRanges<T extends SheetCanvasRange>(ranges: T[], activeItemIds: string[], activeSheet: string | null): T[] {
  const activeIds = new Set(activeItemIds)
  return ranges.filter(range => activeIds.has(range.itemId)
    && (!range.activeSheet || range.activeSheet === activeSheet))
}
