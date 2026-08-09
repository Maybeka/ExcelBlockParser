import ExcelJS from 'exceljs'
import type { CellRange } from '../types'
import type { WorkbookReader, WorkbookSheet } from './workbook'

function columnLetter(index: number): string {
  let result = ''; let n = index + 1
  while (n > 0) { const remainder = (n - 1) % 26; result = String.fromCharCode(65 + remainder) + result; n = Math.floor((n - 1) / 26) }
  return result
}

function makeSheet(sheet: ExcelJS.Worksheet): WorkbookSheet {
  const valuesByCoordinates = (startRow: number, startCol: number, endRow: number, endCol: number): unknown[][] => {
    const values: unknown[][] = []
    for (let row = startRow; row <= endRow; row++) {
      const result: unknown[] = []
      for (let col = startCol; col <= endCol; col++) result.push(sheet.getCell(row + 1, col + 1).value ?? null)
      values.push(result)
    }
    return values
  }
  return {
    name: sheet.name,
    getValues: (range: CellRange) => valuesByCoordinates(range.startRow, range.startCol, range.endRow, range.endCol),
    getValuesByA1: (a1Notation: string) => {
      const [start, end = start] = a1Notation.split(':')
      const startCell = sheet.getCell(start)
      const endCell = sheet.getCell(end)
      return valuesByCoordinates(startCell.row - 1, startCell.col - 1, endCell.row - 1, endCell.col - 1)
    },
    getMergedRanges: () => Object.keys((sheet as any)._merges ?? {}).map(a1 => {
      const match = a1.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
      if (!match) return { startRow: 0, startCol: 0, endRow: 0, endCol: 0, a1Notation: a1 }
      const col = (letter: string) => [...letter].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1
      return { startRow: Number(match[2]) - 1, startCol: col(match[1]), endRow: Number(match[4]) - 1, endCol: col(match[3]), a1Notation: a1 }
    }),
  }
}

export async function loadExcelJsWorkbook(input: ArrayBuffer | Uint8Array): Promise<WorkbookReader> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(input instanceof Uint8Array ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer : input)
  return {
    sheetNames: () => workbook.worksheets.map(sheet => sheet.name),
    getActiveSheet: () => workbook.worksheets[0] ? makeSheet(workbook.worksheets[0]) : null,
    getSheet: (name) => { const sheet = workbook.getWorksheet(name); return sheet ? makeSheet(sheet) : null },
  }
}
