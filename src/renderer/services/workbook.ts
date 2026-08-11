import type { CellRange } from '../types'

export interface WorkbookSheet {
  name: string
  getCells?(range: CellRange): WorkbookCell[][]
  getValues(range: CellRange): unknown[][]
  getValuesByA1(a1Notation: string): unknown[][]
  getMergedRanges(): CellRange[]
}

export interface WorkbookCell {
  value: unknown
  fullyStruck: boolean
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

export function fillMergedCellData(cells: WorkbookCell[][], range: CellRange, mergedRanges: CellRange[]): WorkbookCell[][] {
  const filled = cells.map(row => row.map(cell => ({ ...cell })))
  for (const merged of mergedRanges) {
    if (!intersects(range, merged)) continue
    const topLeft = filled[merged.startRow - range.startRow]?.[merged.startCol - range.startCol]
    if (!topLeft) continue
    for (let row = Math.max(range.startRow, merged.startRow); row <= Math.min(range.endRow, merged.endRow); row++) {
      for (let col = Math.max(range.startCol, merged.startCol); col <= Math.min(range.endCol, merged.endCol); col++) {
        if (row === merged.startRow && col === merged.startCol) continue
        const target = filled[row - range.startRow]
        const index = col - range.startCol
        if (target && (target[index]?.value == null || target[index]?.value === '')) target[index] = { ...topLeft }
      }
    }
  }
  return filled
}

function isRichTextValue(value: unknown): value is { toPlainText(): string; getTextRuns(): Array<{ st: number; ed: number; ts: { strikethrough?: { show: boolean } } | null }> } {
  return Boolean(value && typeof value === 'object'
    && typeof (value as { toPlainText?: unknown }).toPlainText === 'function'
    && typeof (value as { getTextRuns?: unknown }).getTextRuns === 'function')
}

function univerCellFullyStruck(value: unknown, style: { strikethrough?: { show: boolean } } | null | undefined): boolean {
  const cellStruck = style?.strikethrough?.show === true
  if (!isRichTextValue(value)) return cellStruck
  const text = value.toPlainText()
  const visible = text.split('').map(character => character.trim() !== '')
  if (!visible.some(Boolean)) return false
  const struck = visible.map(() => cellStruck)
  for (const run of value.getTextRuns()) {
    const runStruck = run.ts?.strikethrough?.show ?? cellStruck
    for (let index = Math.max(0, run.st); index < Math.min(struck.length, run.ed); index++) struck[index] = runStruck
  }
  return visible.every((isVisible, index) => !isVisible || struck[index])
}

export function createUniverWorkbookReader(workbook: any): WorkbookReader {
  const toRange = (range: any): CellRange => ({
    startRow: range.getRow(), startCol: range.getColumn(), endRow: range.getLastRow(), endCol: range.getLastColumn(), a1Notation: '',
  })
  const wrap = (sheet: any): WorkbookSheet => ({
    name: sheet.getSheetName?.() ?? '',
    getCells: (range) => {
      const target = sheet.getRange(range.a1Notation)
      const values = target.getValues(true) as unknown[][]
      const styles = target.getCellStyles() as Array<Array<{ strikethrough?: { show: boolean } } | null>>
      return values.map((row, rowIndex) => row.map((value, colIndex) => ({
        value: isRichTextValue(value) ? value.toPlainText() : value,
        fullyStruck: univerCellFullyStruck(value, styles[rowIndex]?.[colIndex]),
      })))
    },
    getValues: (range) => sheet.getRange(range.a1Notation).getValues() as unknown[][],
    getValuesByA1: (a1Notation) => sheet.getRange(a1Notation).getValues() as unknown[][],
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
