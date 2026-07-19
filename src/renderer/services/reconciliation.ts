import type { BlockConfig, CellRange, ColumnMapping, ReconciliationIssue, ReconciliationReport, SuggestedFix } from '../types'
import { remapColumns } from './columnMapper'

export function detectSheetMismatch(
  blockSheet: string | null,
  availableSheets: string[]
): { exists: boolean; suggestion?: string } {
  if (!blockSheet) {
    // No sheet specified — use active sheet suggestion
    return { exists: true, suggestion: availableSheets[0] || undefined }
  }

  if (availableSheets.includes(blockSheet)) {
    return { exists: true }
  }

  return {
    exists: false,
    suggestion: availableSheets[0] || undefined,
  }
}

export function generateSheetIssues(
  result: ReturnType<typeof detectSheetMismatch>,
  blockLabel: string,
  blockSheet: string | null
): ReconciliationIssue[] {
  if (result.exists && !blockSheet) return [] // null sheet with active fallback is OK

  if (result.exists) return [] // sheet found

  return [{
    type: 'sheet-missing' as const,
    severity: 'error' as const,
    message: `Block "${blockLabel}": Sheet "${blockSheet}" not found in current workbook. Available: ${result.suggestion ? `"${result.suggestion}" suggested.` : 'none.'}`,
    detail: { missingSheet: blockSheet, availableSheets: result.suggestion ? [result.suggestion] : [] },
  }]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function headersMatch(saved: string[][], current: string[][]): boolean {
  if (saved.length === 0 || current.length === 0) return false
  if (saved.length !== current.length) return false
  return saved.every((savedRow, rowIdx) => {
    const currentRow = current[rowIdx]
    if (!currentRow || savedRow.length !== currentRow.length) return false
    return savedRow.every((s, colIdx) => s.toLowerCase().trim() === currentRow[colIdx].toLowerCase().trim())
  })
}

function colToA1(index: number): string {
  let letter = ''
  let n = index
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}

export function applyRowAdjustFix(range: CellRange, fix: SuggestedFix): CellRange | null {
  if (fix.type !== 'row-adjust' || !fix.data || typeof fix.data !== 'object') return null
  const { newStartRow, newEndRow } = fix.data as Partial<{ newStartRow: unknown; newEndRow: unknown }>
  if (typeof newStartRow !== 'number' || typeof newEndRow !== 'number'
    || !Number.isInteger(newStartRow) || !Number.isInteger(newEndRow)
    || newStartRow < 0 || newEndRow < newStartRow) {
    return null
  }

  return {
    ...range,
    startRow: newStartRow,
    endRow: newEndRow,
    a1Notation: `${colToA1(range.startCol)}${newStartRow + 1}:${colToA1(range.endCol)}${newEndRow + 1}`,
  }
}

// ── Column Detection ───────────────────────────────────────────────────────

export function detectColumnChanges(
  savedHeaders: string[][],
  currentHeaders: string[][]
): { matched: Map<number, number>; added: number[]; removed: number[] } {
  // Flatten: for each column index, join all header rows with space
  const maxSavedCols = Math.max(0, ...savedHeaders.map(r => r.length))
  const maxCurrentCols = Math.max(0, ...currentHeaders.map(r => r.length))

  const savedFlat = Array.from({ length: maxSavedCols }, (_, col) =>
    savedHeaders.map(row => row[col] || '').join(' ').trim()
  )
  const currentFlat = Array.from({ length: maxCurrentCols }, (_, col) =>
    currentHeaders.map(row => row[col] || '').join(' ').trim()
  )

  const matched = new Map<number, number>()
  const usedCurrent = new Set<number>()

  savedFlat.forEach((saved, savedIdx) => {
    const savedLower = saved.toLowerCase().trim()
    for (let curIdx = 0; curIdx < currentFlat.length; curIdx++) {
      if (usedCurrent.has(curIdx)) continue
      if (currentFlat[curIdx].toLowerCase().trim() === savedLower) {
        matched.set(savedIdx, curIdx)
        usedCurrent.add(curIdx)
        break
      }
    }
  })

  const removed: number[] = []
  savedFlat.forEach((_, idx) => {
    if (!matched.has(idx)) removed.push(idx)
  })

  const added: number[] = []
  currentFlat.forEach((_, idx) => {
    if (!usedCurrent.has(idx)) added.push(idx)
  })

  return { matched, added, removed }
}

// ── Row Shift Detection ────────────────────────────────────────────────────

export function detectRowShift(
  blockRange: CellRange,
  headerSnapshot: string[][],
  sheet: any,  // FWorksheet — use 'any' to avoid Univer import complexity
  headerRowsLen: number
): { found: boolean; newStartRow?: number; newEndRow?: number; shift?: number } {
  const { startRow, endRow, startCol, endCol } = blockRange

  // Helper to read headers from a given 0-based row
  const readHeadersAtRow = (row: number): string[][] => {
    try {
      const rows: string[][] = []
      for (let r = 0; r < headerRowsLen; r++) {
        const a1 = `${colToA1(startCol)}${row + r + 1}:${colToA1(endCol)}${row + r + 1}`
        const range = sheet.getRange(a1)
        const values = range.getValues() as unknown[][]
        rows.push(values.length > 0 ? values[0].map(String) : [])
      }
      return rows
    } catch (_e) {
      return []
    }
  }

  // Check exact position first
  const exactHeaders = readHeadersAtRow(startRow)
  if (headersMatch(headerSnapshot, exactHeaders)) {
    return { found: true, newStartRow: startRow, newEndRow: endRow, shift: 0 }
  }

  // Scan ±10 rows
  const SCAN_RANGE = 10
  for (let offset = -SCAN_RANGE; offset <= SCAN_RANGE; offset++) {
    if (offset === 0) continue
    const checkRow = startRow + offset
    if (checkRow < 0) continue
    const currentHeaders = readHeadersAtRow(checkRow)
    if (headersMatch(headerSnapshot, currentHeaders)) {
      const shift = checkRow - startRow
      return {
        found: true,
        newStartRow: startRow + shift,
        newEndRow: endRow + shift,
        shift,
      }
    }
  }

  return { found: false }
}

// ── Issue Generators ───────────────────────────────────────────────────────

export function generateRowShiftIssues(
  result: ReturnType<typeof detectRowShift>,
  blockLabel: string
): ReconciliationIssue[] {
  if (result.found && result.shift === 0) return []

  if (!result.found) {
    return [{
      type: 'row-shifted' as const,
      severity: 'error' as const,
      message: `Block "${blockLabel}": Cannot find matching header row within ±10 rows of saved position.`,
      detail: { startRow: 0, shift: 0 },
    }]
  }

  return [{
    type: 'row-shifted' as const,
    severity: 'warning' as const,
    message: `Block "${blockLabel}": Data shifted by ${result.shift} rows (now at row ${(result.newStartRow ?? 0) + 1}).`,
    detail: { newStartRow: result.newStartRow, newEndRow: result.newEndRow, shift: result.shift },
  }]
}

export function generateColumnIssues(
  columnMatch: ReturnType<typeof detectColumnChanges>,
  blockLabel: string
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = []

  for (const idx of columnMatch.removed) {
    issues.push({
      type: 'column-removed' as const,
      severity: 'warning' as const,
      message: `Block "${blockLabel}": Column at index ${idx} no longer exists in Excel.`,
      detail: { columnIndex: idx },
    })
  }

  for (const idx of columnMatch.added) {
    issues.push({
      type: 'column-added' as const,
      severity: 'info' as const,
      message: `Block "${blockLabel}": New column detected at index ${idx}.`,
      detail: { columnIndex: idx },
    })
  }

  for (const [savedIdx, currentIdx] of columnMatch.matched) {
    if (savedIdx !== currentIdx) {
      issues.push({
        type: 'column-shifted' as const,
        severity: 'info' as const,
        message: `Block "${blockLabel}": Column shifted from index ${savedIdx} to ${currentIdx}.`,
        detail: { fromIndex: savedIdx, toIndex: currentIdx },
      })
    }
  }

  return issues
}

// ── Value Map Conflict Detection ────────────────────────────────────────────

export function detectValueMapConflicts(
  columnMapping: { type: string; valueMap: Array<{ from: string; to: unknown }> },
  currentColumnValues: string[]
): { unusedEntries: Array<{ from: string; to: unknown }>; newUnmappedValues: string[] } {
  if (columnMapping.type !== 'valueMapping') {
    return { unusedEntries: [], newUnmappedValues: [] }
  }

  const uniqueValues = [...new Set(currentColumnValues.map(String))]
  const mapKeys = new Set(columnMapping.valueMap.map(e => String(e.from)))

  const unusedEntries = columnMapping.valueMap.filter(e => !uniqueValues.includes(String(e.from)))

  const newUnmappedValues = uniqueValues.filter(v => !mapKeys.has(v))

  return { unusedEntries, newUnmappedValues }
}

export function generateValueMapIssues(
  conflicts: ReturnType<typeof detectValueMapConflicts>,
  columnLabel: string
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = []

  if (conflicts.unusedEntries.length > 0) {
    issues.push({
      type: 'value-map-unused' as const,
      severity: 'warning' as const,
      message: `Column "${columnLabel}": ${conflicts.unusedEntries.length} value map entr${conflicts.unusedEntries.length === 1 ? 'y' : 'ies'} no longer match data (unused: ${conflicts.unusedEntries.map(e => `"${e.from}"`).join(', ')}).`,
      detail: { unusedEntries: conflicts.unusedEntries },
    })
  }

  if (conflicts.newUnmappedValues.length > 0) {
    const sample = conflicts.newUnmappedValues.slice(0, 5)
    const suffix = conflicts.newUnmappedValues.length > 5 ? ` and ${conflicts.newUnmappedValues.length - 5} more` : ''
    issues.push({
      type: 'value-map-new' as const,
      severity: 'info' as const,
      message: `Column "${columnLabel}": ${conflicts.newUnmappedValues.length} new value(s) need mapping: ${sample.map(v => `"${v}"`).join(', ')}${suffix}.`,
      detail: { newUnmappedValues: conflicts.newUnmappedValues },
    })
  }

  return issues
}

// ── Content Snapshot Diff ──────────────────────────────────────────────────

export function compareContentSnapshot(
  dataSnapshot: unknown[][] | null,
  currentValues: unknown[][],
): {
  changedCells: Array<{ row: number; col: number; oldValue: unknown; newValue: unknown }>
  changedRowCount: number
  changedColCount: number
} {
  if (!dataSnapshot) return { changedCells: [], changedRowCount: 0, changedColCount: 0 }

  const changed: Array<{ row: number; col: number; oldValue: unknown; newValue: unknown }> = []
  const changedRows = new Set<number>()
  const changedCols = new Set<number>()

  const maxRows = Math.max(dataSnapshot.length, currentValues.length)

  for (let r = 0; r < maxRows; r++) {
    const savedRow = dataSnapshot[r] || []
    const currentRow = currentValues[r] || []
    const maxCols = Math.max(savedRow.length, currentRow.length)

    for (let c = 0; c < maxCols; c++) {
      const oldVal = savedRow[c]
      const newVal = currentRow[c]
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        changed.push({ row: r, col: c, oldValue: oldVal, newValue: newVal })
        changedRows.add(r)
        changedCols.add(c)
      }
    }
  }

  return {
    changedCells: changed,
    changedRowCount: changedRows.size,
    changedColCount: changedCols.size,
  }
}

// ── Range Reselection ─────────────────────────────────────────────────────

export function detectRangeChange(
  block: { range: CellRange | null; columns: ColumnMapping[] },
  currentSheet: { getRange: (a1: string) => { getValues: () => unknown[][] } },
): { rangeMatch: boolean; storedRowCount: number; storedColCount: number; currentRowCount: number; currentColCount: number } {
  if (!block.range) {
    return { rangeMatch: true, storedRowCount: 0, storedColCount: 0, currentRowCount: 0, currentColCount: 0 }
  }

  const storedRows = block.range.endRow - block.range.startRow + 1
  const storedCols = block.range.endCol - block.range.startCol + 1

  try {
    const range = currentSheet.getRange(block.range.a1Notation)
    const values = range.getValues() as unknown[][]
    const currentRows = values.length
    const currentCols = values.length > 0 ? (values[0] as unknown[]).length : 0
    return {
      rangeMatch: storedRows === currentRows && storedCols === currentCols,
      storedRowCount: storedRows,
      storedColCount: storedCols,
      currentRowCount: currentRows,
      currentColCount: currentCols,
    }
  } catch (_e) {
    return {
      rangeMatch: true,
      storedRowCount: storedRows,
      storedColCount: storedCols,
      currentRowCount: storedRows,
      currentColCount: storedCols,
    }
  }
}

export function generateRangeIssues(
  result: ReturnType<typeof detectRangeChange>,
  blockLabel: string,
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = []

  if (result.rangeMatch) return issues

  if (result.currentRowCount !== result.storedRowCount) {
    issues.push({
      type: 'row-shifted' as const,
      severity: 'warning' as const,
      message: `Block "${blockLabel}": Row count changed from ${result.storedRowCount} to ${result.currentRowCount}.`,
      detail: {
        storedRowCount: result.storedRowCount,
        currentRowCount: result.currentRowCount,
      },
    })
  }

  if (result.currentColCount !== result.storedColCount) {
    issues.push({
      type: 'column-shifted' as const,
      severity: 'warning' as const,
      message: `Block "${blockLabel}": Column count changed from ${result.storedColCount} to ${result.currentColCount}.`,
      detail: {
        storedColCount: result.storedColCount,
        currentColCount: result.currentColCount,
      },
    })
  }

  return issues
}

export function suggestRangeReselectFix(
  block: {
    range: CellRange | null
    headerRows: number[]
    columns: ColumnMapping[]
  },
  currentSheet: { getRange: (a1: string) => { getValues: () => unknown[][] } },
  currentRowCount: number,
  currentColCount: number,
): SuggestedFix | null {
  if (!block.range) return null

  // Read current header values from the sheet for name matching
  let newHeaders: string[] = []
  if (block.headerRows.length > 0 && currentRowCount > 0) {
    try {
      // Read the first header row to get column names
      const headerA1 = `${colToA1(block.range.startCol)}${block.range.startRow + 1}:${colToA1(block.range.startCol + currentColCount - 1)}${block.range.startRow + 1}`
      const headerRange = currentSheet.getRange(headerA1)
      const headerValues = headerRange.getValues() as unknown[][]
      if (headerValues.length > 0) {
        newHeaders = (headerValues[0] as unknown[]).map(v => String(v ?? ''))
      }
    } catch (_e) { /* keep empty headers */ }
  }

  const remappedColumns = remapColumns(block.columns, newHeaders, currentColCount)

  return {
    type: 'range-reselect' as const,
    description: `Re-select range with remapped columns (${currentRowCount} rows × ${currentColCount} cols).`,
    autoApply: false,
    data: {
      newRange: {
        startRow: block.range.startRow,
        startCol: block.range.startCol,
        endRow: block.range.startRow + currentRowCount - 1,
        endCol: block.range.startCol + currentColCount - 1,
      },
      remappedColumns,
    },
  }
}

// ── Column Rearrangement ──────────────────────────────────────────────────

function sanitizeForMatch(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase().trim()
}

export function detectColumnRearrangement(
  block: { columns: ColumnMapping[] },
  currentHeaders: string[],
): { columnsReordered: boolean; insertionDetected: boolean; deletionDetected: boolean; shiftDetected: boolean } {
  const configHeaders = block.columns
    .filter(c => !c.skip)
    .map(c => sanitizeForMatch(c.key || c.suggestedKey))
  const currentSanitized = currentHeaders.map(h => sanitizeForMatch(h))

  let insertionDetected = false
  let deletionDetected = false
  let shiftDetected = false

  for (const configH of configHeaders) {
    if (!configH) continue
    if (!currentSanitized.some(h => h === configH)) {
      deletionDetected = true
      break
    }
  }

  for (const currentH of currentSanitized) {
    if (!currentH) continue
    if (!configHeaders.some(h => h === currentH)) {
      insertionDetected = true
      break
    }
  }

  for (let i = 0; i < Math.min(configHeaders.length, currentSanitized.length); i++) {
    const configH = configHeaders[i]
    if (!configH) continue
    const currentIdx = currentSanitized.findIndex(h => h === configH)
    if (currentIdx !== -1 && currentIdx !== i) {
      shiftDetected = true
      break
    }
  }

  const columnsReordered = shiftDetected || insertionDetected || deletionDetected

  return { columnsReordered, insertionDetected, deletionDetected, shiftDetected }
}

export function suggestColumnReorder(
  block: {
    columns: ColumnMapping[]
    headerRows: number[]
    range: CellRange | null
  },
  currentSheet: { getRange: (a1: string) => { getValues: () => unknown[][] } },
): SuggestedFix | null {
  if (!block.range || block.headerRows.length === 0) return null

  let currentHeaders: string[] = []
  try {
    const firstHeaderRow = block.range.startRow
    const a1 = `${colToA1(block.range.startCol)}${firstHeaderRow + 1}:${colToA1(block.range.endCol)}${firstHeaderRow + 1}`
    const range = currentSheet.getRange(a1)
    const values = range.getValues() as unknown[][]
    if (values.length > 0) {
      currentHeaders = (values[0] as unknown[]).map(v => String(v ?? ''))
    }
  } catch (_e) { /* can't read headers */ }

  if (currentHeaders.length === 0) return null

  const remappedColumns = remapColumns(block.columns, currentHeaders, currentHeaders.length)

  return {
    type: 'column-reorder' as const,
    description: `Re-map column order to match current sheet layout (${currentHeaders.length} columns).`,
    autoApply: false,
    data: { remappedColumns },
  }
}

// ── Report Generation ────────────────────────────────────────────────────────

export function generateReconciliationReport(
  blocks: Array<{
    id: string
    label: string
    range: { startRow: number; startCol: number; endRow: number; endCol: number; a1Notation: string } | null
    activeSheet: string | null
    headerRows: number[]
    columns: Array<{
      colIndex: number
      colLetter: string
      suggestedKey: string
      key: string
      type: string
      valueMap: Array<{ from: string; to: unknown }>
      skip: boolean
    }>
    headerSnapshot?: string[][] | string[]
    dataSnapshot?: unknown[][] | null
    rowCount?: number
  }>,
  univerAPI: any  // FUniver
): ReconciliationReport[] {
  const reports: ReconciliationReport[] = []

  const workbook = univerAPI?.getActiveWorkbook?.()
  const availableSheets: string[] = workbook
    ? (workbook.getSheets?.() || []).map((s: any) => s.getSheetName?.() || '')
    : []

  for (const block of blocks) {
    if (!block.range) continue // skip blocks without range

    try {
      const issues: ReconciliationIssue[] = []
      const fixes: SuggestedFix[] = []

      // 1. Sheet detection
      const sheetResult = detectSheetMismatch(block.activeSheet, availableSheets)
      issues.push(...generateSheetIssues(sheetResult, block.label, block.activeSheet))

      if (!sheetResult.exists) {
        fixes.push({
          type: 'sheet-remap' as const,
          description: 'Remap to an available sheet',
          autoApply: false,
          data: { suggestion: sheetResult.suggestion },
        })
      }

       // 2. If sheet exists, do range reselection check
      if (sheetResult.exists) {
        try {
          const sheetName = block.activeSheet || availableSheets[0] || ''
          const sheet = workbook.getSheetByName?.(sheetName) || workbook.getActiveSheet?.()

          if (sheet) {
            // Range dimension check
            const rangeResult = detectRangeChange(
              { range: block.range, columns: block.columns as ColumnMapping[] },
              sheet,
            )
            issues.push(...generateRangeIssues(rangeResult, block.label))

            if (!rangeResult.rangeMatch) {
              const reselectFix = suggestRangeReselectFix(
                { range: block.range, headerRows: block.headerRows, columns: block.columns as ColumnMapping[] },
                sheet,
                rangeResult.currentRowCount,
                rangeResult.currentColCount,
              )
              if (reselectFix) fixes.push(reselectFix)
            }
          }

          if (sheet && block.headerRows.length > 0 && block.headerSnapshot) {
            // Normalize headerSnapshot — accept string[] or string[][]
            const normalizedSnapshot: string[][] = Array.isArray(block.headerSnapshot[0])
              ? block.headerSnapshot as string[][]
              : [block.headerSnapshot as string[]]

            // Row shift detection
            const rowResult = detectRowShift(block.range as any, normalizedSnapshot, sheet, block.headerRows.length)
            issues.push(...generateRowShiftIssues(rowResult, block.label))

            if (rowResult.found && rowResult.newStartRow !== undefined) {
              fixes.push({
                type: 'row-adjust' as const,
                description: rowResult.shift !== 0
                  ? `Adjust range by ${rowResult.shift} rows`
                  : 'Range is correct',
                autoApply: rowResult.shift !== 0,
                data: {
                  newStartRow: rowResult.newStartRow,
                  newEndRow: rowResult.newEndRow,
                  shift: rowResult.shift,
                },
              })
            }

            // Column detection — read all header rows
            const headerRow = rowResult.found && rowResult.newStartRow !== undefined
              ? rowResult.newStartRow
              : block.range.startRow
            const currentHeaderRows: string[][] = []
            for (let r = 0; r < block.headerRows.length; r++) {
              const a1 = `${colToA1(block.range.startCol)}${headerRow + r + 1}:${colToA1(block.range.endCol)}${headerRow + r + 1}`
              const hr = sheet.getRange(a1)
              const vals = hr.getValues() as unknown[][]
              currentHeaderRows.push(vals.length > 0 ? (vals[0] as unknown[]).map(String) : [])
            }

            if (currentHeaderRows.length > 0) {
              const colResult = detectColumnChanges(normalizedSnapshot, currentHeaderRows)
              issues.push(...generateColumnIssues(colResult, block.label))

              // Generate column shift fixes
              for (const [savedIdx, currentIdx] of colResult.matched) {
                if (savedIdx !== currentIdx) {
                  fixes.push({
                    type: 'column-remap' as const,
                    description: `Relink column from index ${savedIdx} to ${currentIdx}`,
                    autoApply: true,
                    data: { columnIndex: savedIdx, newIndex: currentIdx },
                  })
                }
              }

              // Removed columns
              for (const idx of colResult.removed) {
                fixes.push({
                  type: 'column-remove' as const,
                  description: `Remove column at index ${idx}`,
                  autoApply: true,
                  data: { columnIndex: idx },
                })
              }
            }
          }

          // Value map conflict detection
          if (sheet) {
            for (const col of block.columns) {
              if (col.type !== 'valueMapping' || col.valueMap.length === 0) continue
              if (col.valueMap.length > 200) continue // skip detailed conflict detection for very large maps
              try {
                const colA1 = `${colToA1(col.colIndex)}${block.range!.startRow + 1}:${colToA1(col.colIndex)}${block.range!.endRow + 1}`
                const colRange = sheet.getRange(colA1)
                const values = colRange.getValues() as unknown[][]
                const flatValues = values.map(row => String(row[0])).filter(v => v !== 'undefined' && v !== 'null')
                const conflicts = detectValueMapConflicts(
                  { type: col.type, valueMap: col.valueMap },
                  flatValues,
                )
                issues.push(...generateValueMapIssues(conflicts, col.suggestedKey || col.colLetter))
              } catch (_e) { /* skip unreadable columns */ }
            }
          }

          // 3. Content snapshot diff
          if (block.dataSnapshot && sheet) {
            try {
              const dataA1 = `${colToA1(block.range!.startCol)}${block.range!.startRow + 1}:${colToA1(block.range!.endCol)}${block.range!.endRow + 1}`
              const dataRange = sheet.getRange(dataA1)
              const currentValues = dataRange.getValues() as unknown[][]

              const diff = compareContentSnapshot(block.dataSnapshot, currentValues)

              if (diff.changedCells.length > 0) {
                const MAX_REPORTED = 50
                const reportedCells = diff.changedCells.slice(0, MAX_REPORTED)

                for (const cell of reportedCells) {
                  const colLetter = colToA1(cell.col)
                  const rowNumber = block.range!.startRow + cell.row + 1
                  issues.push({
                    type: 'content-changed' as const,
                    severity: 'warning' as const,
                    message: `Block "${block.label}": Cell ${colLetter}${rowNumber} changed from "${String(cell.oldValue ?? '')}" to "${String(cell.newValue ?? '')}".`,
                    detail: { row: cell.row, col: cell.col, oldValue: cell.oldValue, newValue: cell.newValue },
                  })
                }

                if (diff.changedCells.length > MAX_REPORTED) {
                  issues.push({
                    type: 'content-changed' as const,
                    severity: 'info' as const,
                    message: `Block "${block.label}": ... and ${diff.changedCells.length - MAX_REPORTED} more cell changes.`,
                    detail: { truncatedCount: diff.changedCells.length - MAX_REPORTED },
                  })
                }

                fixes.push({
                  type: 'content-update' as const,
                  description: `${diff.changedCells.length} cell(s) changed across ${diff.changedRowCount} row(s) and ${diff.changedColCount} column(s). Re-parse to update snapshot.`,
                  autoApply: false,
                  data: {
                    changedCellCount: diff.changedCells.length,
                    changedRowCount: diff.changedRowCount,
                    changedColCount: diff.changedColCount,
                  },
                })
              }
            } catch (_e) { /* skip blocks where data range access fails */ }
          }
        } catch (_e) { /* skip blocks where sheet access fails */ }
      }

      // Determine status
      let status: ReconciliationReport['status'] = 'ok'
      if (issues.length === 0) {
        status = 'ok'
      } else {
        const hasSheetIssue = issues.some(i => i.type === 'sheet-missing')
        const hasColumnIssue = issues.some(i => ['column-added', 'column-removed', 'column-shifted'].includes(i.type))
        const hasRowIssue = issues.some(i => i.type === 'row-shifted')

        if (hasSheetIssue) {
          status = 'sheet-missing'
        } else if (hasRowIssue) {
          status = 'rows-mismatch'
        } else if (hasColumnIssue) {
          status = 'columns-mismatch'
        } else {
          status = 'ok'
        }
      }

      reports.push({
        blockId: block.id,
        label: block.label,
        status,
        issues,
        suggestedFixes: fixes,
      })
    } catch (err) {
      console.warn(`Reconciliation failed for block "${block.label}":`, err)
    }
  }

  return reports
}

// ── Unified Entry Point ────────────────────────────────────────────────────

export async function runReconciliation(
  block: BlockConfig,
  api: any,  // FUniver
  availableSheets: string[],
): Promise<ReconciliationReport> {
  const issues: ReconciliationIssue[] = []
  const fixes: SuggestedFix[] = []

  // Step 1: Sheet detection
  const sheetResult = detectSheetMismatch(block.activeSheet, availableSheets)
  issues.push(...generateSheetIssues(sheetResult, block.label, block.activeSheet))

  if (!sheetResult.exists) {
    fixes.push({
      type: 'sheet-remap' as const,
      description: 'Remap to an available sheet',
      autoApply: false,
      data: { suggestion: sheetResult.suggestion },
    })

    return {
      blockId: block.id,
      label: block.label,
      status: 'sheet-missing',
      issues,
      suggestedFixes: fixes,
    }
  }

  // Step 2: Range + Content (requires sheet access)
  try {
    const workbook = api?.getActiveWorkbook?.()
    if (!workbook) {
      return {
        blockId: block.id,
        label: block.label,
        status: 'ok',
        issues,
        suggestedFixes: fixes,
      }
    }

    const sheetName = block.activeSheet || availableSheets[0] || ''
    const sheet = workbook.getSheetByName?.(sheetName) || workbook.getActiveSheet?.()
    if (!sheet) {
      return {
        blockId: block.id,
        label: block.label,
        status: 'ok',
        issues,
        suggestedFixes: fixes,
      }
    }

    if (block.range) {
      if (block.headerRows.length > 0 && block.headerSnapshot) {
        const normalizedSnapshot: string[][] = Array.isArray(block.headerSnapshot[0])
          ? block.headerSnapshot as string[][]
          : [block.headerSnapshot as string[]]
        const rowResult = detectRowShift(block.range, normalizedSnapshot, sheet, block.headerRows.length)
        issues.push(...generateRowShiftIssues(rowResult, block.label))

        if (rowResult.found && rowResult.shift && rowResult.newStartRow !== undefined && rowResult.newEndRow !== undefined) {
          fixes.push({
            type: 'row-adjust' as const,
            description: `Adjust range by ${rowResult.shift} rows`,
            autoApply: false,
            data: {
              newStartRow: rowResult.newStartRow,
              newEndRow: rowResult.newEndRow,
              shift: rowResult.shift,
            },
          })
        }
      }

      // Range dimension check
      const rangeResult = detectRangeChange(
        { range: block.range, columns: block.columns },
        sheet,
      )
      issues.push(...generateRangeIssues(rangeResult, block.label))

      if (!rangeResult.rangeMatch) {
        const reselectFix = suggestRangeReselectFix(
          { range: block.range, headerRows: block.headerRows, columns: block.columns },
          sheet,
          rangeResult.currentRowCount,
          rangeResult.currentColCount,
        )
        if (reselectFix) fixes.push(reselectFix)
      }

      // Content snapshot diff
      if (block.dataSnapshot) {
        try {
          const dataA1 = `${colToA1(block.range.startCol)}${block.range.startRow + 1}:${colToA1(block.range.endCol)}${block.range.endRow + 1}`
          const dataRange = sheet.getRange(dataA1)
          const currentValues = dataRange.getValues() as unknown[][]
          const diff = compareContentSnapshot(block.dataSnapshot, currentValues)

          if (diff.changedCells.length > 0) {
            const MAX_REPORTED = 50
            for (const cell of diff.changedCells.slice(0, MAX_REPORTED)) {
              const colLetter = colToA1(cell.col)
              const rowNumber = block.range.startRow + cell.row + 1
              issues.push({
                type: 'content-changed' as const,
                severity: 'warning' as const,
                message: `Block "${block.label}": Cell ${colLetter}${rowNumber} changed from "${String(cell.oldValue ?? '')}" to "${String(cell.newValue ?? '')}".`,
                detail: { row: cell.row, col: cell.col, oldValue: cell.oldValue, newValue: cell.newValue },
              })
            }
            if (diff.changedCells.length > MAX_REPORTED) {
              issues.push({
                type: 'content-changed' as const,
                severity: 'info' as const,
                message: `Block "${block.label}": ... and ${diff.changedCells.length - MAX_REPORTED} more cell changes.`,
                detail: { truncatedCount: diff.changedCells.length - MAX_REPORTED },
              })
            }
            fixes.push({
              type: 'content-update' as const,
              description: `${diff.changedCells.length} cell(s) changed across ${diff.changedRowCount} row(s) and ${diff.changedColCount} column(s). Re-parse to update snapshot.`,
              autoApply: false,
              data: {
                changedCellCount: diff.changedCells.length,
                changedRowCount: diff.changedRowCount,
                changedColCount: diff.changedColCount,
              },
            })
          }
        } catch (_e) { /* skip content diff on error */ }
      }

      for (const col of block.columns) {
        if (col.type !== 'valueMapping' || col.valueMap.length === 0 || col.valueMap.length > 200) continue
        try {
          const colA1 = `${colToA1(col.colIndex)}${block.range.startRow + 1}:${colToA1(col.colIndex)}${block.range.endRow + 1}`
          const values = sheet.getRange(colA1).getValues() as unknown[][]
          const currentValues = values
            .map(row => String(row[0]))
            .filter(value => value !== 'undefined' && value !== 'null')
          const conflicts = detectValueMapConflicts({ type: col.type, valueMap: col.valueMap }, currentValues)
          issues.push(...generateValueMapIssues(conflicts, col.suggestedKey || col.colLetter))
        } catch (_e) { /* skip unreadable columns */ }
      }
    }

    // Step 3: Column rearrangement
    if (block.range && block.columns.length > 0) {
      try {
        const firstHeaderRow = block.range.startRow
        const headerA1 = `${colToA1(block.range.startCol)}${firstHeaderRow + 1}:${colToA1(block.range.endCol)}${firstHeaderRow + 1}`
        const headerRange = sheet.getRange(headerA1)
        const headerValues = headerRange.getValues() as unknown[][]
        const currentHeaders = headerValues.length > 0
          ? (headerValues[0] as unknown[]).map(v => String(v ?? ''))
          : []

        if (currentHeaders.length > 0) {
          const rearrangement = detectColumnRearrangement(
            { columns: block.columns },
            currentHeaders,
          )

          if (rearrangement.columnsReordered) {
            issues.push({
              type: 'column-shifted' as const,
              severity: 'warning' as const,
              message: `Block "${block.label}": Column layout differs from saved config.${rearrangement.insertionDetected ? ' New columns detected.' : ''}${rearrangement.deletionDetected ? ' Columns removed.' : ''}${rearrangement.shiftDetected ? ' Columns shifted.' : ''}`,
              detail: rearrangement,
            })

            const reorderFix = suggestColumnReorder(
              { columns: block.columns, headerRows: block.headerRows, range: block.range },
              sheet,
            )
            if (reorderFix) fixes.push(reorderFix)
          }
        }
      } catch (_e) { /* skip column rearrangement on error */ }
    }
  } catch (_e) { /* skip sheet-dependent steps on error */ }

  // Determine status
  let status: ReconciliationReport['status'] = 'ok'
  if (issues.length > 0) {
    const hasSheetIssue = issues.some(i => i.type === 'sheet-missing')
    const hasColumnIssue = issues.some(i => ['column-added', 'column-removed', 'column-shifted'].includes(i.type))
    const hasRowIssue = issues.some(i => i.type === 'row-shifted')

    if (hasSheetIssue) {
      status = 'sheet-missing'
    } else if (hasRowIssue) {
      status = 'rows-mismatch'
    } else if (hasColumnIssue) {
      status = 'columns-mismatch'
    }
  }

  return {
    blockId: block.id,
    label: block.label,
    status,
    issues,
    suggestedFixes: fixes,
  }
}
