export const MAX_CACHED_WORKBOOKS = 2

export interface CachedWorkbookCandidate {
  id: string
  lastUsed: number
}

/**
 * Keep the active workbook and the most recently used inactive workbook.
 * Univer units are expensive enough that retaining every opened workbook makes
 * memory use grow without bound in long multi-workbook sessions.
 */
export function workbookCacheEvictions(
  candidates: readonly CachedWorkbookCandidate[],
  activeWorkbookId: string,
  maximum = MAX_CACHED_WORKBOOKS,
): string[] {
  const excess = Math.max(0, candidates.length - Math.max(1, maximum))
  if (excess === 0) return []
  return candidates
    .filter(candidate => candidate.id !== activeWorkbookId)
    .sort((left, right) => left.lastUsed - right.lastUsed || left.id.localeCompare(right.id))
    .slice(0, excess)
    .map(candidate => candidate.id)
}
