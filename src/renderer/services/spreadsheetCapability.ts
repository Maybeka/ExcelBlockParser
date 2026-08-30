import type { CellRange } from '../types'
import { createUniverWorkbookReader, type WorkbookReader } from './workbook'

export interface SpreadsheetCapability {
  sheetNames(): string[]
  activeSheetName(): string | null
  setActiveSheet(sheetName: string): boolean
  readRange(sheetName: string | null, range: CellRange): unknown[][] | null
  scrollTo(sheetName: string | null, row: number, column: number): boolean
  focusRange(sheetName: string | null, range: CellRange): boolean
  workbookReader(): WorkbookReader | null
}

export function createUnavailableSpreadsheetCapability(sheetNames: string[] = []): SpreadsheetCapability {
  return {
    sheetNames: () => sheetNames,
    activeSheetName: () => null,
    setActiveSheet: () => false,
    readRange: () => null,
    scrollTo: () => false,
    focusRange: () => false,
    workbookReader: () => null,
  }
}

/** The only renderer adapter that exposes Univer objects to workbook capabilities. */
export function createUniverSpreadsheetCapability(api: any, fallbackSheetNames: string[] = []): SpreadsheetCapability {
  const workbook = () => api?.getActiveWorkbook?.() ?? null
  const sheet = (sheetName: string | null) => {
    const activeWorkbook = workbook()
    if (!activeWorkbook) return null
    return sheetName ? activeWorkbook.getSheetByName?.(sheetName) ?? null : activeWorkbook.getActiveSheet?.() ?? null
  }

  return {
    sheetNames: () => {
      const sheets = workbook()?.getSheets?.()
      return sheets ? sheets.map((item: any) => item.getSheetName?.() ?? '').filter(Boolean) : fallbackSheetNames
    },
    activeSheetName: () => workbook()?.getActiveSheet?.()?.getSheetName?.() ?? null,
    setActiveSheet: (sheetName) => {
      const activeWorkbook = workbook()
      if (!activeWorkbook || !activeWorkbook.getSheetByName?.(sheetName)) return false
      activeWorkbook.setActiveSheet(sheetName)
      return true
    },
    readRange: (sheetName, range) => {
      const target = sheet(sheetName)
      if (!target) return null
      try { return target.getRange(range.a1Notation).getValues() as unknown[][] } catch { return null }
    },
    scrollTo: (sheetName, row, column) => {
      const target = sheet(sheetName)
      if (!target) return false
      target.scrollToCell(Math.max(0, row), Math.max(0, column))
      return true
    },
    focusRange: (sheetName, range) => {
      if (sheetName && !workbook()?.getSheetByName?.(sheetName)) return false
      if (sheetName) workbook()?.setActiveSheet(sheetName)
      return sheet(sheetName)?.scrollToCell(Math.max(0, range.startRow - 3), Math.max(0, range.startCol - 1)) !== undefined
    },
    workbookReader: () => {
      const activeWorkbook = workbook()
      return activeWorkbook ? createUniverWorkbookReader(activeWorkbook) : null
    },
  }
}
