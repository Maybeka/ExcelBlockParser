import type { ColumnMapping } from '../types'

/**
 * Convert a 0-based column index to Excel column letter.
 * 0 → A, 1 → B, 25 → Z, 26 → AA, 27 → AB, ...
 */
function colIndexToLetter(index: number): string {
  let letter = ''
  let n = index
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}

function sanitizeForMatch(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase().trim()
}

function createDefaultColumn(colIndex: number): ColumnMapping {
  const letter = colIndexToLetter(colIndex)
  return {
    colIndex,
    colLetter: letter,
    suggestedKey: `column_${letter}`,
    key: `column_${letter}`,
    type: 'auto' as const,
    skip: false,
    valueMap: [],
  }
}

/**
 * Re-map existing column configurations to a new column count and header set.
 *
 * Algorithm:
 * 1. Name-first matching — compare sanitized newHeaders[i] against sanitized
 *    existingColumn.key (or suggestedKey). First match wins.
 * 2. Position-fallback — remaining unmatched existing columns are assigned to
 *    remaining unmatched positions in original colIndex order.
 * 3. Extra existing columns beyond newColCount become orphans:
 *    skip: true, high colIndex.
 * 4. New positions without existing config get createDefaultColumn.
 *
 * Pure function — never mutates inputs. All returned objects are shallow copies
 * of original configs (new refs, no mutation of valueMap arrays).
 *
 * @param existingColumns - Current column mappings (may include orphans)
 * @param newHeaders - Header strings for new positions (length ≤ newColCount)
 * @param newColCount - Total number of columns in the new range
 * @returns Re-mapped ColumnMapping[] (length ≥ newColCount, includes orphans)
 */
export function remapColumns(
  existingColumns: ColumnMapping[],
  newHeaders: string[],
  newColCount: number,
): ColumnMapping[] {
  // Normalize new headers once
  const normalizedHeaders = newHeaders.map(h => sanitizeForMatch(h))

  // Helper: get normalized match key from an existing column
  const normalizeColumn = (col: ColumnMapping): string =>
    sanitizeForMatch(col.key || col.suggestedKey || '')

  // Pre-compute normalized keys for existing columns
  const normalizedExisting = existingColumns.map(normalizeColumn)

  // Track which existing columns have been matched
  const usedExisting = new Set<number>()

  // --- Phase 1: Name-first matching ---
  const nameMatched = new Map<number, number>() // position → existingColIndex

  for (let pos = 0; pos < newColCount; pos++) {
    const normHeader = normalizedHeaders[pos]
    if (!normHeader) continue // empty header — skip name matching, fall through to position

    for (let ei = 0; ei < existingColumns.length; ei++) {
      if (usedExisting.has(ei)) continue
      if (normalizedExisting[ei] === normHeader) {
        nameMatched.set(pos, ei)
        usedExisting.add(ei)
        break // first match wins
      }
    }
  }

  // --- Phase 2: Position-fallback ---
  const unmatchedPositions: number[] = []
  for (let pos = 0; pos < newColCount; pos++) {
    if (!nameMatched.has(pos)) {
      unmatchedPositions.push(pos)
    }
  }

  const unmatchedExisting: number[] = []
  for (let ei = 0; ei < existingColumns.length; ei++) {
    if (!usedExisting.has(ei)) {
      unmatchedExisting.push(ei)
    }
  }

  // Sort unmatched existing by original colIndex for deterministic position assignment
  unmatchedExisting.sort((a, b) => existingColumns[a].colIndex - existingColumns[b].colIndex)

  const fallbackMatched = new Map<number, number>() // position → existingColIndex
  const assignCount = Math.min(unmatchedPositions.length, unmatchedExisting.length)
  for (let k = 0; k < assignCount; k++) {
    fallbackMatched.set(unmatchedPositions[k], unmatchedExisting[k])
    usedExisting.add(unmatchedExisting[k])
  }

  // --- Build result ---
  const result: ColumnMapping[] = []

  for (let pos = 0; pos < newColCount; pos++) {
    const ei = nameMatched.get(pos) ?? fallbackMatched.get(pos)
    if (ei !== undefined) {
      const existing = existingColumns[ei]
      result.push({
        ...existing,
        colIndex: pos,
        colLetter: colIndexToLetter(pos),
      })
    } else {
      result.push(createDefaultColumn(pos))
    }
  }

  return result
}
