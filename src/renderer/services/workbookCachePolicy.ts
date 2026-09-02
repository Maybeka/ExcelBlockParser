/**
 * Approximate retained Univer data at 384 MiB. This is deliberately a data
 * budget, not a count: several small workbooks should remain instant to switch
 * between while a large workbook must not cause every other unit to be evicted.
 */
export const MAX_CACHED_WORKBOOK_BYTES = 384 * 1024 * 1024

export interface CachedWorkbookCandidate {
  id: string
  lastUsed: number
  estimatedBytes: number
}

/**
 * Keep the active workbook and retain least-recently-used inactive workbooks
 * only while the estimated Univer data stays inside the cache budget. The
 * active workbook is always retained, even when it alone exceeds the budget.
 */
export function workbookCacheEvictions(
  candidates: readonly CachedWorkbookCandidate[],
  activeWorkbookId: string,
  maximumBytes = MAX_CACHED_WORKBOOK_BYTES,
): string[] {
  const budget = Math.max(0, maximumBytes)
  let retainedBytes = candidates.reduce((total, candidate) => total + Math.max(0, candidate.estimatedBytes), 0)
  if (retainedBytes <= budget) return []

  const evictions: string[] = []
  for (const candidate of candidates
    .filter(candidate => candidate.id !== activeWorkbookId)
    .sort((left, right) => left.lastUsed - right.lastUsed || left.id.localeCompare(right.id))) {
    if (retainedBytes <= budget) break
    retainedBytes -= Math.max(0, candidate.estimatedBytes)
    evictions.push(candidate.id)
  }
  return evictions
}

/**
 * Browser runtimes do not expose reliable per-Univer-unit heap usage. Estimate
 * retained memory from the decoded cell model and source file instead. The
 * fixed per-cell allowance covers Univer's rendered-cell and object overhead;
 * source bytes prevent image/style-heavy workbooks from looking free.
 */
export function estimateWorkbookCacheBytes(sourceBytes: number, workbookData: {
  sheets?: Record<string, { cellData?: Record<number, Record<number, { v?: unknown; p?: unknown; s?: unknown }>>; mergeData?: unknown[]; rowData?: Record<number, unknown>; columnData?: Record<number, unknown> }>
  styles?: Record<string, unknown>
}): number {
  let estimated = Math.max(0, sourceBytes) * 4
  let cells = 0
  let stringCharacters = 0
  let richTextCharacters = 0
  let metadataEntries = Object.keys(workbookData.styles ?? {}).length

  for (const sheet of Object.values(workbookData.sheets ?? {})) {
    metadataEntries += sheet.mergeData?.length ?? 0
    metadataEntries += Object.keys(sheet.rowData ?? {}).length
    metadataEntries += Object.keys(sheet.columnData ?? {}).length
    for (const row of Object.values(sheet.cellData ?? {})) {
      for (const cell of Object.values(row)) {
        cells += 1
        if (typeof cell.v === 'string') stringCharacters += cell.v.length
        if (typeof cell.p === 'string') richTextCharacters += cell.p.length
      }
    }
  }

  // 512 B/cell is intentionally conservative; large, richly formatted sheets
  // are the cases where cache thrashing is most disruptive.
  estimated += cells * 512
  estimated += (stringCharacters + richTextCharacters) * 2
  estimated += metadataEntries * 128
  return Math.max(1024 * 1024, Math.ceil(estimated))
}
