import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { loadExcelJsWorkbook } from '../services/exceljsWorkbook'
import { createUniverWorkbookReader, fillMergedCellData } from '../services/workbook'
import type { CellRange } from '../types'

const range = (a1Notation: string, startRow: number, startCol: number, endRow: number, endCol: number): CellRange => ({
  a1Notation, startRow, startCol, endRow, endCol,
})

describe('workbook cell metadata', () => {
  it('reads full and partial strikethrough from ExcelJS workbooks', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    sheet.getCell('A1').value = 'deleted'
    sheet.getCell('A1').font = { strike: true }
    sheet.getCell('A2').value = {
      richText: [
        { text: 'old', font: { strike: true } },
        { text: 'new', font: { strike: false } },
      ],
    }
    sheet.getCell('A3').value = {
      richText: [
        { text: 'old', font: { strike: true } },
        { text: 'value', font: { strike: true } },
      ],
    }

    const loaded = await loadExcelJsWorkbook(await workbook.xlsx.writeBuffer())
    expect(loaded.getSheet('Data')!.getCells!(range('A1:A3', 0, 0, 2, 0))).toEqual([
      [{ value: 'deleted', fullyStruck: true }],
      [{ value: 'oldnew', fullyStruck: false }],
      [{ value: 'oldvalue', fullyStruck: true }],
    ])
  })

  it('reads composed cell strikethrough from Univer', () => {
    const targetRange = {
      getValues: () => [['deleted'], ['active']],
      getCellStyles: () => [[{ strikethrough: { show: true } }], [null]],
    }
    const sheet = {
      getSheetName: () => 'Data',
      getRange: () => targetRange,
      getMergedRanges: () => [],
    }
    const workbook = {
      getSheets: () => [sheet],
      getActiveSheet: () => sheet,
      getSheetByName: () => sheet,
    }
    expect(createUniverWorkbookReader(workbook).getSheet('Data')!.getCells!(range('A1:A2', 0, 0, 1, 0))).toEqual([
      [{ value: 'deleted', fullyStruck: true }],
      [{ value: 'active', fullyStruck: false }],
    ])
  })

  it('requires every visible rich-text run to be struck through in Univer', () => {
    const richText = (text: string, shows: boolean[]) => ({
      toPlainText: () => text,
      getTextRuns: () => shows.map((show, index) => ({ st: index, ed: index + 1, ts: { strikethrough: { show } } })),
    })
    const targetRange = {
      getValues: () => [[richText('ab', [true, true])], [richText('ab', [true, false])]],
      getCellStyles: () => [[null], [null]],
    }
    const sheet = { getSheetName: () => 'Data', getRange: () => targetRange, getMergedRanges: () => [] }
    const workbook = { getSheets: () => [sheet], getActiveSheet: () => sheet, getSheetByName: () => sheet }
    expect(createUniverWorkbookReader(workbook).getSheet('Data')!.getCells!(range('A1:A2', 0, 0, 1, 0))).toEqual([
      [{ value: 'ab', fullyStruck: true }],
      [{ value: 'ab', fullyStruck: false }],
    ])
  })

  it('propagates merged-cell values and strikethrough metadata', () => {
    const cells = [[{ value: 'deleted', fullyStruck: true }, { value: null, fullyStruck: false }]]
    expect(fillMergedCellData(cells, range('A1:B1', 0, 0, 0, 1), [range('A1:B1', 0, 0, 0, 1)])).toEqual([
      [{ value: 'deleted', fullyStruck: true }, { value: 'deleted', fullyStruck: true }],
    ])
  })
})
