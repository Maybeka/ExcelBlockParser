import type { CellRange } from '../types'

export interface WorkbookSheet {
  name: string
  getValues(range: CellRange): unknown[][]
  getMergedRanges(): CellRange[]
}

export interface WorkbookReader {
  sheetNames(): string[]
  getActiveSheet(): WorkbookSheet | null
  getSheet(name: string): WorkbookSheet | null
}

function intersects(a: CellRange, b: CellRange): boolean {
  return a.startRow <= b.endRow && a.endRow >= b.startRow
    && a.startCol <= b.endCol && a.endCol >= b.startCol
}

export function fillMergedCells(values: unknown[][], range: CellRange, mergedRanges: CellRange[]): unknown[][] {
  const filled = values.map(row => [...row])
  for (const merged of mergedRanges) {
    if (!intersects(range, merged)) continue
    const topLeft = filled[merged.startRow - range.startRow]?.[merged.startCol - range.startCol]
    for (let row = Math.max(range.startRow, merged.startRow); row <= Math.min(range.endRow, merged.endRow); row++) {
      for (let col = Math.max(range.startCol, merged.startCol); col <= Math.min(range.endCol, merged.endCol); col++) {
        if (row === merged.startRow && col === merged.startCol) continue
        const target = filled[row - range.startRow]
        if (target && (target[col - range.startCol] == null || target[col - range.startCol] === '')) target[col - range.startCol] = topLeft
      }
    }
  }
  return filled
}

export function createUniverWorkbookReader(workbook: any): WorkbookReader {
  const toRange = (range: any): CellRange => ({
    startRow: range.getRow(), startCol: range.getColumn(), endRow: range.getLastRow(), endCol: range.getLastColumn(), a1Notation: '',
  })
  const wrap = (sheet: any): WorkbookSheet => ({
    name: sheet.getSheetName?.() ?? '',
    getValues: (range) => sheet.getRange(range.a1Notation).getValues() as unknown[][],
    getMergedRanges: () => {
      try { return (sheet.getMergedRanges?.() ?? []).map(toRange) } catch { return [] }
    },
  })
  return {
    sheetNames: () => workbook.getSheets?.().map((sheet: any) => sheet.getSheetName()) ?? [],
    getActiveSheet: () => { const sheet = workbook.getActiveSheet?.(); return sheet ? wrap(sheet) : null },
    getSheet: (name) => { const sheet = workbook.getSheetByName?.(name); return sheet ? wrap(sheet) : null },
  }
}
