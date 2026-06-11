import type { PreviewData } from '../types'

const store = new Map<string, PreviewData>()

/**
 * Store preview data for a given block ID.
 */
export function setPreviewData(blockId: string, data: PreviewData): void {
  store.set(blockId, data)
}

/**
 * Retrieve preview data for a given block ID.
 * Returns `undefined` if no data has been stored for the block.
 */
export function getPreviewData(blockId: string): PreviewData | undefined {
  return store.get(blockId)
}

/**
 * Clear preview data.
 * If a blockId is provided, only that entry is cleared.
 * Otherwise, the entire store is cleared.
 */
export function clearPreviewData(blockId?: string): void {
  if (blockId) {
    store.delete(blockId)
  } else {
    store.clear()
  }
}
