import ExcelJS from 'exceljs'
import { HorizontalAlign, WrapStrategy } from '@univerjs/core'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData, deriveOutlineGroups } from '../services/xlsx-converter'

describe('XLSX workbook conversion', () => {
  it('preserves themed fills and multiline cell text for Univer', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    const cell = sheet.getCell('A1')
    cell.value = 'first line\nsecond line'
    cell.alignment = { horizontal: 'centerContinuous', wrapText: true }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { theme: 4, tint: 0.4 } as unknown as ExcelJS.Color,
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const converted = await convertXlsxToWorkbookData(buffer as ArrayBuffer, 'themed.xlsx')
    const data = converted.workbookData.sheets.Data!.cellData![0]![0]!
    const style = converted.workbookData.styles![data.s as string]!

    expect(style.bg?.rgb).toMatch(/^#[0-9a-f]{6}$/i)
    expect(style.bg?.rgb).not.toBe('#FFFFFF')
    expect(style.tb).toBe(WrapStrategy.WRAP)
    expect(style.ht).toBe(HorizontalAlign.CENTER)
    expect(data.v).toBe('first line\rsecond line')
    expect((data.p as { body: { dataStream: string; paragraphs: Array<{ startIndex: number }>; sectionBreaks: Array<{ startIndex: number }> } }).body).toEqual({
      dataStream: 'first line\rsecond line\r\n',
      paragraphs: [{ startIndex: 10 }, { startIndex: 22 }],
      sectionBreaks: [{ startIndex: 23 }],
      textRuns: expect.any(Array),
    })
  })

  it('captures frozen panes and the collapsed Excel outline state', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }]
    sheet.getCell('B2').value = 'outlined row and column'
    sheet.getCell('C3').value = 'manually hidden row and column'
    sheet.getRow(2).outlineLevel = 1
    sheet.getRow(2).hidden = true
    sheet.getRow(3).hidden = true
    sheet.getColumn(2).outlineLevel = 1
    sheet.getColumn(2).hidden = true
    sheet.getColumn(3).hidden = true

    const buffer = await workbook.xlsx.writeBuffer()
    const converted = await convertXlsxToWorkbookData(buffer as ArrayBuffer, 'outlined.xlsx')
    const data = converted.workbookData.sheets.Data!

    expect(converted.sheetDisplaySettings.Data).toEqual({
      freeze: { startRow: 1, startColumn: 2, xSplit: 2, ySplit: 1 },
      outlinedHiddenRows: [1],
      outlinedHiddenColumns: [1],
      outlineGroups: [
        { id: 'row:1:1:1', axis: 'row', start: 1, end: 1, level: 1, initialCollapsed: true },
        { id: 'column:1:1:1', axis: 'column', start: 1, end: 1, level: 1, initialCollapsed: true },
      ],
    })
    expect(data.rowData![1]).toMatchObject({ hd: 1 })
    expect(data.rowData![2]).toMatchObject({ hd: 1 })
    expect(data.columnData![1]).toMatchObject({ hd: 1 })
    expect(data.columnData![2]).toMatchObject({ hd: 1 })
  })

  it('derives independently controllable nested outline groups', () => {
    expect(deriveOutlineGroups('row', [0, 1, 2, 2, 1, 0], [2, 3])).toEqual([
      { id: 'row:1:1:4', axis: 'row', start: 1, end: 4, level: 1, initialCollapsed: false },
      { id: 'row:2:2:3', axis: 'row', start: 2, end: 3, level: 2, initialCollapsed: true },
    ])
  })
})
